import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runAsk, streamAskEvents } from './workflow'

// Mocks
const fakeHits = [
    { _id: '1', _source: { chunk_id: 'c1', text: 'T1', label_id: 'L1' } },
    { _id: '2', _source: { chunk_id: 'c2', text: 'T2', label_id: 'L2' } },
] as any

vi.mock('./retriever', () => ({
    retrieveWithInfo: vi.fn(async () => ({ hits: fakeHits, strategy: { type: 'mock' } }))
}))

vi.mock('./qa/selector', () => ({
    selectCitations: vi.fn(async (_q: string, _h: any[]) => ({
        citations: [
            { chunk_id: 'c1', text: 'S1' },
        ]
    }))
}))

vi.mock('./qa/answerer', () => ({
    answerQuestion: vi.fn(async (_q: string, _hits: any[]) => ({ answer: 'FINAL', citations: _hits, used: { model: 'm' } })),
    answerQuestionStream: vi.fn(async (_q: string, _hits: any[]) => ({ model: 'm', stream: (async function* () { yield 'A'; yield 'B' })() }))
}))

vi.mock('./telemetry', () => ({
    createTelemetry: () => ({ id: 't1', start: () => { }, end: () => { }, addMeta: () => { }, setCitations: () => { }, done: () => { }, flush: async () => { } })
}))

// Import mocked modules to inspect calls
import * as retriever from './retriever'
import * as selector from './qa/selector'
import * as answerer from './qa/answerer'

describe('workflow', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('runAsk returns final answer and strategy', async () => {
        const res = await runAsk('q')
        expect(res.answer).toBe('FINAL')
        expect(Array.isArray(res.citations)).toBe(true)
        expect(res.used.model).toBe('m')
        expect(res.strategy).toEqual({ type: 'mock' })

        // Internal workflow calls
        expect((retriever as any).retrieveWithInfo).toHaveBeenCalledTimes(1)
        expect((selector as any).selectCitations).toHaveBeenCalledTimes(1)
        expect((answerer as any).answerQuestion).toHaveBeenCalledTimes(1)
        expect((answerer as any).answerQuestionStream).not.toHaveBeenCalled()
    })

    it('streamAskEvents yields phases and tokens in order', async () => {
        const evs: any[] = []
        for await (const ev of streamAskEvents('q')) evs.push(ev)
        const types = evs.map(e => e.type)
        expect(types).toEqual(['retrieval', 'citations', 'meta', 'token', 'token', 'done'])
        const meta = evs.find(e => e.type === 'meta')
        expect(meta.data.model).toBe('m')

        // Internal workflow calls
        expect((retriever as any).retrieveWithInfo).toHaveBeenCalledTimes(1)
        expect((selector as any).selectCitations).toHaveBeenCalledTimes(1)
        expect((answerer as any).answerQuestionStream).toHaveBeenCalledTimes(1)
        expect((answerer as any).answerQuestion).not.toHaveBeenCalled()
    })
})
