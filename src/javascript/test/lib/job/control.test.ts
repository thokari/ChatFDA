import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
    makeJobId,
    createJob,
    getJob,
    updateJob,
    setStatus,
    heartbeat,
    logEvent,
    type JobParams
} from '../../../lib/job/control.js'

function fakeClient() {
    return {
        index: vi.fn<(arg: any) => Promise<any>>(async (_arg) => ({})),
        update: vi.fn<(arg: any) => Promise<any>>(async (_arg) => ({})),
        get: vi.fn<(arg: any) => Promise<any>>(async (_arg) => ({ body: { _source: { job_id: 'job_x' } } })),
        bulk: vi.fn<(arg: any) => Promise<any>>(async (_arg) => ({ body: { errors: false, items: [] } })),
        mget: vi.fn<(arg: any) => Promise<any>>(async (_arg) => ({ body: { docs: [] } }))
    }
}

describe('control', () => {
    beforeEach(() => vi.setSystemTime(new Date('2025-08-26T12:00:00Z')))
    afterEach(() => vi.useRealTimers())

    it('makeJobId formats deterministically and normalizes case', () => {
        const p: JobParams = { ingredient: 'IbUProFen', route: 'oral', updatedSince: '20200101', limit: 100 }
        expect(makeJobId(p)).toBe('job_2025-08-26_ibuprofen_ORAL_20200101_L100')
    })

    it('createJob writes a RUNNING job with zeroed counters and correct timestamps', async () => {
        const os = fakeClient()
        const params: JobParams = { ingredient: 'ibo', route: 'ORAL', limit: 50 }
        const doc = await createJob(os as any, 'job_1', params)

        expect(os.index).toHaveBeenCalled()
        const call = os.index.mock.calls.at(0)?.[0]
        expect(call).toBeDefined()
        if (!call) throw new Error('os.index not called')

        // new assertions: id, refresh, cursor
        expect(call.index).toBe('ingest-jobs')
        expect(call.id).toBe('job_1')
        expect(call.refresh).toBe('true')
        expect(call.body.cursor).toEqual({ skip: 0 })

        // status + counters
        expect(call.body.status).toBe('RUNNING')
        expect(call.body.counters).toEqual({
            labels_seen: 0, chunks_considered: 0, chunks_embedded: 0, errors: 0
        })

        // timestamps equal to fixed time and consistent
        expect(call.body.created_at).toBe('2025-08-26T12:00:00.000Z')
        expect(call.body.last_heartbeat).toBe('2025-08-26T12:00:00.000Z')

        // returned doc echo
        expect(doc.job_id).toBe('job_1')
        expect(doc.params.limit).toBe(50)
    })

    it('getJob returns null on 404', async () => {
        const os = fakeClient()
        os.get.mockRejectedValueOnce({ meta: { statusCode: 404 } })
        const res = await getJob(os as any, 'missing')
        expect(res).toBeNull()
    })

    it('getJob propagates non-404 errors', async () => {
        const os = fakeClient()
        const err = Object.assign(new Error('boom'), { meta: { statusCode: 500 } })
        os.get.mockRejectedValueOnce(err)
        await expect(getJob(os as any, 'bad')).rejects.toThrow('boom')
    })

    it('updateJob performs partial update with refresh', async () => {
        const os = fakeClient()
        await updateJob(os as any, 'job_2', { status: 'PAUSED' })
        expect(os.update).toHaveBeenCalledTimes(1)
        const call = os.update.mock.calls[0]?.[0]
        expect(call).toBeDefined()
        if (!call) throw new Error('os.update not called')

        expect(call.index).toBe('ingest-jobs')
        expect(call.id).toBe('job_2')
        expect(call.refresh).toBe('true')
        expect(call.body.doc.status).toBe('PAUSED')
    })

    it('setStatus updates status, touches heartbeat, and logs an event', async () => {
        const os = fakeClient()
        await setStatus(os as any, 'job_3', 'PAUSED')

        // update called with status + last_heartbeat
        expect(os.update).toHaveBeenCalledTimes(1)
        const upd = os.update.mock.calls[0]?.[0]
        expect(upd).toBeDefined()
        if (!upd) throw new Error('os.update not called')
        expect(upd.index).toBe('ingest-jobs')
        expect(upd.id).toBe('job_3')
        expect(typeof upd.body.doc.last_heartbeat).toBe('string')
        expect(upd.body.doc.status).toBe('PAUSED')

        // event written with expected fields
        expect(os.index).toHaveBeenCalledTimes(1)
        const evt = os.index.mock.calls[0]?.[0]
        expect(evt).toBeDefined()
        if (!evt) throw new Error('os.index not called')
        expect(evt.index).toBe('ingest-events')
        expect(evt.body.job_id).toBe('job_3')
        expect(evt.body.level).toBe('INFO')
        expect(evt.body.phase).toBe('JOB')
        expect(evt.body.message).toContain('Status -> PAUSED')
        expect(typeof evt.body.created_at).toBe('string')
    })

    it('heartbeat updates only last_heartbeat on the job doc', async () => {
        const os = fakeClient()
        await heartbeat(os as any, 'job_4')

        expect(os.update).toHaveBeenCalledTimes(1)
        const call = os.update.mock.calls[0]?.[0]
        expect(call).toBeDefined()
        if (!call) throw new Error('os.update not called')

        // new assertions: correct index/id, and doc has only last_heartbeat (we can’t
        // strictly assert “only”, but we at least check presence and shape)
        expect(call.index).toBe('ingest-jobs')
        expect(call.id).toBe('job_4')
        expect(typeof call.body.doc.last_heartbeat).toBe('string')
    })

    it('logEvent writes full event payload to ingest-events', async () => {
        const os = fakeClient()
        await logEvent(os as any, 'job_5', 'INFO', 'JOB', 'hello', { a: 1 })

        expect(os.index).toHaveBeenCalledTimes(1)
        const call = os.index.mock.calls[0]?.[0]
        expect(call).toBeDefined()
        if (!call) throw new Error('os.index not called')

        expect(call.index).toBe('ingest-events')
        expect(call.body.job_id).toBe('job_5')
        expect(call.body.level).toBe('INFO')
        expect(call.body.phase).toBe('JOB')
        expect(call.body.message).toBe('hello')
        expect(call.body.meta).toEqual({ a: 1 })
        expect(typeof call.body.created_at).toBe('string')
    })
})
