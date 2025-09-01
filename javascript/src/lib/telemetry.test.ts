import { describe, it, expect, vi } from 'vitest'
import { createTelemetry } from './telemetry'

// Hoisted mocks
const { mockIndex } = vi.hoisted(() => ({
    mockIndex: vi.fn(async () => ({})),
}))

vi.mock('@/lib/os-client', () => ({
    osClientFromEnv: () => ({ index: mockIndex })
}))

describe('telemetry', () => {
    it('records durations, meta, citations and flushes one doc', async () => {
        const tel = createTelemetry('what about ibuprofen in pregnancy?')
        tel.start('retrieve')
        tel.end('retrieve')
        tel.start('select')
        tel.end('select')
        tel.addMeta({ strategy: { type: 'hybrid' }, model: 'gpt-4o-mini' })
        tel.setCitations([{ chunk_id: 'c1', section: 'warnings', label_id: 'L1' }])
        tel.done(true)
        await tel.flush()

    expect(mockIndex).toHaveBeenCalledTimes(1)
    const calls = (mockIndex as any).mock.calls as any[]
    expect(calls.length).toBe(1)
    const arg = calls[0][0]
    expect(arg.index).toBe('ask-metrics')
    const body = arg.body as any
        expect(body.id).toBeTruthy()
        expect(body.q).toContain('ibuprofen')
        expect(typeof body.time).toBe('string')
        expect(body.status).toBe('ok')
        expect(typeof body.durations.retrieve).toBe('number')
        expect(typeof body.durations.total).toBe('number')
        expect(body.meta.model).toBe('gpt-4o-mini')
        expect(body.meta.strategy).toEqual({ type: 'hybrid' })
        expect(Array.isArray(body.citations)).toBe(true)
        expect(body.citations[0].chunk_id).toBe('c1')
    })
})
