import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createMockOsClient } from '@/utils/mock-os-client.js'
import crypto from 'node:crypto'

// Mock functions for dependencies
const fetchFdaLabelsMock = vi.fn()
const chunkSectionsMock = vi.fn()
const embedDocumentsMock = vi.fn()

// Mock functions for control module
const getJobMock = vi.fn()
const updateJobMock = vi.fn()
const heartbeatMock = vi.fn()
const logEventMock = vi.fn()
const setStatusMock = vi.fn()

// Only mock the control module since we're injecting everything else
vi.mock('./control.js', () => ({
    getJob: getJobMock,
    updateJob: updateJobMock,
    heartbeat: heartbeatMock,
    logEvent: logEventMock,
    setStatus: setStatusMock
}))

function createMockEmbedder() {
    return {
        embedDocuments: embedDocumentsMock.mockImplementation(async (texts: string[]) =>
            texts.map(() => Array(1536).fill(0.01))
        )
    }
}

function runningJob(id: string) {
    return {
        job_id: id,
        created_at: '2025-08-26T12:00:00Z',
        params: { ingredient: 'ibuprofen', route: 'ORAL', limit: 100 },
        cursor: { skip: 0 },
        counters: { labels_seen: 0, chunks_considered: 0, chunks_embedded: 0, errors: 0 },
        status: 'RUNNING',
        last_heartbeat: '2025-08-26T12:00:00Z'
    }
}

function emptyPage() {
    return {
        results: [],
        total: 0,
        skip: 0,
        limit: 100,
        nextSkip: null
    }
}

function pageWithLabel() {
    return {
        results: [{
            id: 'L1',
            effective_time: '20240101',
            openfda: {
                generic_name: ['IBUPROFEN'],
                manufacturer_name: ['X'],
                route: ['ORAL'],
                product_type: ['HUMAN OTC DRUG'],
                substance_name: ['IBUPROFEN']
            }
        }],
        total: 1,
        skip: 0,
        limit: 100,
        nextSkip: null
    }
}

describe('runner', () => {
    let mockOs: ReturnType<typeof createMockOsClient>
    let mockEmbedder: ReturnType<typeof createMockEmbedder>

    beforeEach(() => {
        vi.resetModules()
        vi.clearAllMocks()
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2025-08-26T12:00:00Z'))
        fetchFdaLabelsMock.mockReset()
        chunkSectionsMock.mockReset()
        embedDocumentsMock.mockReset()
        getJobMock.mockReset()
        updateJobMock.mockReset()
        heartbeatMock.mockReset()
        logEventMock.mockReset()
        setStatusMock.mockReset()
        mockOs = createMockOsClient()
        mockEmbedder = createMockEmbedder()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('completes when no labels are returned', async () => {
        getJobMock.mockResolvedValueOnce(runningJob('job_0'))
        fetchFdaLabelsMock.mockResolvedValueOnce(emptyPage())

        const { runJob } = await import('./runner.js')

        await runJob('job_0', {
            os: mockOs,
            fetcher: fetchFdaLabelsMock,
            chunker: chunkSectionsMock,
            embedder: mockEmbedder
        })

        expect(mockOs.bulk).not.toHaveBeenCalled()
        expect(setStatusMock).toHaveBeenCalledWith(mockOs, 'job_0', 'COMPLETED')
    })

    it('indexes labels and chunks, advances cursor', async () => {
        // First call to getJob - initial job state
        getJobMock.mockResolvedValueOnce(runningJob('job_1'))

        // First page with one label
        fetchFdaLabelsMock.mockResolvedValueOnce(pageWithLabel())

        // Chunking returns one chunk
        chunkSectionsMock.mockResolvedValueOnce([
            { section: 'warnings', text: 'do not exceed dose', idx: 0 }
        ])

        // No existing chunks
        mockOs.mget.mockResolvedValueOnce({ body: { docs: [] } })

        // Second call to getJob - after processing first page
        getJobMock.mockResolvedValueOnce({
            ...runningJob('job_1'),
            counters: { labels_seen: 1, chunks_considered: 1, chunks_embedded: 1, errors: 0 }
        })

        // Second page is empty to end the loop
        fetchFdaLabelsMock.mockResolvedValueOnce(emptyPage())

        const { runJob } = await import('./runner.js')

        await runJob('job_1', {
            os: mockOs,
            fetcher: fetchFdaLabelsMock,
            chunker: chunkSectionsMock,
            embedder: mockEmbedder
        })

        // Should have called bulk twice: once for labels, once for chunks
        expect(mockOs.bulk).toHaveBeenCalledTimes(2)

        // First bulk call should be for labels
        const firstBulkCall = mockOs.bulk.mock.calls[0]?.[0]
        expect(firstBulkCall).toBeDefined()
        expect(firstBulkCall.body).toContain('"drug-labels"')
        expect(firstBulkCall.body).toContain('"L1"')
        expect(firstBulkCall.body).toContain('IBUPROFEN')

        // Second bulk call should be for chunks
        const secondBulkCall = mockOs.bulk.mock.calls[1]?.[0]
        expect(secondBulkCall).toBeDefined()
        expect(secondBulkCall.body).toContain('"drug-chunks"')
        expect(secondBulkCall.body).toContain('L1#warnings#0')
        expect(secondBulkCall.body).toContain('do not exceed dose')

        // Should have called embedDocuments for the chunk
        expect(embedDocumentsMock).toHaveBeenCalledWith(['[Section: Warnings] do not exceed dose'])

        // Should have updated the job
        expect(updateJobMock).toHaveBeenCalled()

        // Should have completed when no more labels
        expect(setStatusMock).toHaveBeenCalledWith(mockOs, 'job_1', 'COMPLETED')
    })

    it('skips unchanged chunks when hash matches existing', async () => {
        // Job state
        getJobMock.mockResolvedValueOnce(runningJob('job_2'))

        // First page with 1 label
        fetchFdaLabelsMock.mockResolvedValueOnce(pageWithLabel())

        // Chunker returns 1 chunk
        const section = 'warnings'
        const text = 'do not exceed dose'
        const hash = crypto.createHash('sha256').update(`${section}\n${text}`).digest('hex')
        const chunkId = `L1#${section}#0`
        chunkSectionsMock.mockResolvedValueOnce([{ section, text, idx: 0 }])

        // mget returns existing chunk with same hash (unchanged)
        mockOs.mget.mockResolvedValueOnce({
            body: {
                docs: [
                    {
                        found: true,
                        _id: chunkId,
                        _source: {
                            hash,
                            // presence of embedding => dedupe will skip re-embedding/re-indexing
                            embedding: Array(1536).fill(0.01),
                        },
                    },
                ],
            },
        })
        // Fresh read after update not strictly needed; keep RUNNING doc
        getJobMock.mockResolvedValueOnce(runningJob('job_2'))

        // End-of-feed
        fetchFdaLabelsMock.mockResolvedValueOnce(emptyPage())

        const { runJob } = await import('./runner.js')

        await runJob('job_2', {
            os: mockOs,
            fetcher: fetchFdaLabelsMock,
            chunker: chunkSectionsMock,
            embedder: mockEmbedder
        })

        // Should only bulk once for labels, not for chunks (since chunk was unchanged)
        expect(mockOs.bulk).toHaveBeenCalledTimes(1)

        const bulkCall = mockOs.bulk.mock.calls[0]?.[0]
        expect(bulkCall).toBeDefined()
        const body = bulkCall?.body as string
        expect(body).toContain('"drug-labels"')
        expect(body).toContain('"L1"')

        // No chunk bulk
        const bulkBodies = mockOs.bulk.mock.calls.map(c => c[0]?.body as string)
        expect(bulkBodies.some(b => b?.includes('"drug-chunks"'))).toBe(false)

        // Completed
        expect(setStatusMock).toHaveBeenCalledWith(mockOs, 'job_2', 'COMPLETED')
    })
})
