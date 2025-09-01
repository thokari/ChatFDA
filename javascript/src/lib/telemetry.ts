import { osClientFromEnv } from '@/lib/os-client'

type Phase = 'retrieve' | 'select' | 'answer' | 'total'

type TelemetryDoc = {
    id: string
    q: string
    time: string
    durations: Partial<Record<Phase | string, number>>
    meta?: Record<string, any> | undefined
    citations?: Array<{ chunk_id?: string; section?: string; label_id?: string }> | undefined
    status: 'ok' | 'error'
    error?: { message: string } | undefined
}

function now() { return Date.now() }
function newId() {
    try { return (globalThis as any).crypto?.randomUUID() as string } catch { }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function createTelemetry(q: string) {
    const id = newId()
    const time = new Date().toISOString()
    const t0 = now()
    const starts = new Map<string, number>()
    const durations: Record<string, number> = {}
    const meta: Record<string, any> = {}
    const citations: Array<{ chunk_id?: string; section?: string; label_id?: string }> = []
    let status: 'ok' | 'error' = 'ok'
    let error: { message: string } | undefined

    function start(phase: Phase | string) {
        if (!starts.has(phase)) starts.set(phase, now())
    }
    function end(phase: Phase | string) {
        const s = starts.get(phase)
        if (s) durations[phase] = now() - s
    }
    function addMeta(m: Record<string, any>) {
        Object.assign(meta, m)
    }
    function setCitations(items: Array<{ chunk_id?: string; section?: string; label_id?: string }>) {
        citations.splice(0, citations.length, ...items)
    }
    function done(ok: boolean, err?: any) {
        end('total')
        status = ok ? 'ok' : 'error'
        if (!ok && err) error = { message: String(err?.message || err) }
    }
    function toDoc(): TelemetryDoc {
        return {
            id,
            q,
            time,
            durations,
            meta: Object.keys(meta).length ? meta : undefined,
            citations: citations.length ? citations : undefined,
            status,
            error,
        }
    }
    async function flush(index = 'ask-metrics') {
        const client = osClientFromEnv()
        const body = toDoc()
        try {
            await client.index({ index, body })
        } catch { /* swallow */ }
    }

    // start total timer by default
    start('total')
    return { id, start, end, addMeta, setCitations, done, flush, toDoc }
}
