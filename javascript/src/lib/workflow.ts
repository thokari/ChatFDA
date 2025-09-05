import type { RetrieveHit } from '@/lib/retriever'
import { retrieveWithInfo } from '@/lib/retriever'
import { selectCitations } from '@/lib/qa/selector'
import { answerQuestion, answerQuestionStream } from '@/lib/qa/answerer'
import { createTelemetry } from '@/lib/telemetry'

export type AskEvent =
    | { type: 'retrieval'; data: { strategy: any; total: number } }
    | { type: 'citations'; data: RetrieveHit[] }
    | { type: 'meta'; data: { model: string } }
    | { type: 'token'; data: string }
    | { type: 'done'; data: { ok: boolean } }
    | { type: 'error'; data: { message: string } }

export async function* streamAskEvents(q: string): AsyncGenerator<AskEvent, void, unknown> {
    if (!q || typeof q !== 'string') {
        yield { type: 'error', data: { message: 'q is required' } }
        return
    }

    const tel = createTelemetry(q)
    tel.start('retrieve')
    const { hits, strategy } = await retrieveWithInfo(q, { highlight: false, sourceFields: ['*'] })
    tel.end('retrieve')
    tel.addMeta({ strategy })
    yield { type: 'retrieval', data: { strategy, total: hits.length } }

    try {
        const byId = new Map<string, RetrieveHit>()
        for (const h of hits) {
            const cid = String(h._source?.chunk_id ?? h._id)
            byId.set(cid, h)
        }
        tel.start('select')
        const sel = await selectCitations(q, hits)
        tel.end('select')
        const selectedHits = sel.citations
            .map(c => {
                const base = byId.get(c.chunk_id)
                if (!base) return null
                return { ...base, _source: { ...base._source, text: c.text } }
            })
            .filter(Boolean) as RetrieveHit[]
        tel.setCitations(sel.citations.map(c => {
            const base: any = { chunk_id: c.chunk_id }
            if (c.section !== undefined) base.section = c.section
            const lid = (byId.get(c.chunk_id)?._source as any)?.label_id
            if (lid !== undefined) base.label_id = lid
            return base
        }))
        yield { type: 'citations', data: selectedHits }

        tel.start('answer')
        const { stream, model } = await answerQuestionStream(q, selectedHits)
        tel.addMeta({ model })
        yield { type: 'meta', data: { model } }

        for await (const token of stream) {
            yield { type: 'token', data: token }
        }
        tel.end('answer')
        tel.done(true)
        await tel.flush()
        yield { type: 'done', data: { ok: true } }
    } catch (err: any) {
        tel.done(false, err)
        await tel.flush()
        yield { type: 'error', data: { message: err?.message ?? 'failed' } }
    }
}

export async function runAsk(q: string): Promise<{ answer: string; citations: RetrieveHit[]; used: { model: string }; strategy: any }> {
    if (!q || typeof q !== 'string') throw new Error('q is required')
    const tel = createTelemetry(q)
    tel.start('retrieve')
    const { hits, strategy } = await retrieveWithInfo(q, { highlight: false, sourceFields: ['*'] })
    tel.end('retrieve')
    tel.addMeta({ strategy })

    const byId = new Map<string, RetrieveHit>()
    for (const h of hits) {
        const cid = String(h._source?.chunk_id ?? h._id)
        byId.set(cid, h)
    }
    tel.start('select')
    const sel = await selectCitations(q, hits)
    tel.end('select')
    const selectedHits = sel.citations
        .map(c => {
            const base = byId.get(c.chunk_id)
            if (!base) return null
            return { ...base, _source: { ...base._source, text: c.text } }
        })
        .filter(Boolean) as RetrieveHit[]

    tel.start('answer')
    const res = await answerQuestion(q, selectedHits)
    tel.end('answer')
    tel.setCitations(sel.citations.map(c => {
        const base: any = { chunk_id: c.chunk_id }
        if (c.section !== undefined) base.section = c.section
        const lid = (byId.get(c.chunk_id)?._source as any)?.label_id
        if (lid !== undefined) base.label_id = lid
        return base
    }))
    tel.addMeta({ model: res.used?.model })
    tel.done(true)
    await tel.flush()
    return { ...res, strategy }
}
