import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockOsClient, MockOsClient } from '@/utils/mock-os-client.js'

describe('retriever', () => {
    let mockOs: MockOsClient
    let mockEmbedder: { embedDocuments: typeof mockEmbedDocuments }
    const filter = { brand_name: 'Advil', route: 'ORAL' }

    // Hoisted mocks to satisfy Vitest's mock factory hoisting
    const { mockEmbedDocuments } = vi.hoisted(() => ({
        mockEmbedDocuments: vi.fn(),
    }))

    vi.mock('@langchain/openai', () => ({
        OpenAIEmbeddings: vi.fn().mockImplementation(() => ({
            embedDocuments: mockEmbedDocuments,
        })),
    }))

    const { mockOsClientFromEnv } = vi.hoisted(() => ({
        mockOsClientFromEnv: vi.fn(),
    }))

    vi.mock('./os-client.js', () => ({
        osClientFromEnv: mockOsClientFromEnv,
    }))

    function createMockHits(count: number = 2) {
        return Array.from({ length: count }, (_, i) => ({
            _id: `doc_${i}`,
            _score: 0.8 - (i * 0.1),
            _source: {
                chunk_id: `chunk_${i}`,
                label_id: `label_${i}`,
                section: 'warnings',
                text: `This is chunk ${i} content`,
                openfda: {
                    brand_name: [`Brand${i}`],
                    generic_name: [`Generic${i}`],
                    route: ['ORAL']
                }
            },
            highlight: {
                text: [`This is <em>chunk</em> ${i} content`]
            }
        }))
    }

    function makeHits(prefix: string, count: number): any[] {
        return Array.from({ length: count }, (_, i) => ({
            _id: `${prefix}_${i}`,
            _score: 1 - i * 0.01,
            _source: {
                chunk_id: `${prefix}_chunk_${i}`,
                label_id: `${prefix}_label_${Math.floor(i / 2)}`,
                section: 'warnings',
                text: `content ${prefix} ${i}`,
                openfda: { brand_name: [`Brand${i}`], generic_name: [`Generic${i}`], route: ['ORAL'] },
            },
            highlight: { text: [`<em>${prefix}</em> ${i}`] },
        }))
    }

    beforeEach(() => {
        vi.clearAllMocks()
        mockOs = createMockOsClient()
        mockEmbedder = { embedDocuments: mockEmbedDocuments }
        mockOsClientFromEnv.mockReturnValue(mockOs)
        mockEmbedDocuments.mockResolvedValue([Array(1536).fill(0.01)])
    })

    it('fuses text and ANN via RRF and returns capped results', async () => {
        const textHits = makeHits('t', 5)
        const annHits = makeHits('a', 5)
        annHits[0]._id = textHits[0]._id

        mockOs.search.mockImplementation(async (arg: any) => {
            if (arg.body?.knn) {
                return { body: { hits: { hits: annHits } } }
            }
            return { body: { hits: { hits: textHits } } }
        })

        const { retrieveHybrid } = await import('./retriever.js')
        const { hits, info } = await retrieveHybrid('ibuprofen dosing', {
            os: mockOs,
            topK: 6,
            textK: 5,
            annK: 5,
            rrfC: 60,
            highlight: true,
        })

        expect(info.strategy).toBe('hybrid')
        expect(info.textCount).toBe(5)
        expect(info.annCount).toBe(5)
        expect(hits.length).toBe(6)
        expect(hits[0]!._id).toBe(textHits[0]._id)
        expect(hits[0]!.highlight?.text?.[0]).toContain('<em>')
    })

    it('works when one branch returns empty', async () => {
        mockOs.search.mockImplementation(async (arg: any) => {
            if (arg.body?.knn) {
                return { body: { hits: { hits: [] } } }
            }
            return { body: { hits: { hits: makeHits('t', 3) } } }
        })

        const { retrieveHybrid } = await import('./retriever.js')
        const { hits } = await retrieveHybrid('boxed warning', { os: mockOs, topK: 2, textK: 3, annK: 3 })
        expect(hits.length).toBe(2)
        expect(hits[0]!._id.startsWith('t_')).toBe(true)
    })

    it('uses provided queryVector without embedding call', async () => {
        mockOs.search.mockResolvedValue({ body: { hits: { hits: makeHits('t', 2) } } })

        const queryVector = Array(1536).fill(0.02)
        const { retrieveHybrid } = await import('./retriever.js')

        await retrieveHybrid('any', { os: mockOs, queryVector, topK: 1 })
        expect(mockEmbedDocuments).not.toHaveBeenCalled()
    })

    // --- Comprehensive retriever tests ---
    it('retrieves with filter and checks query', async () => {
        mockOs.search.mockResolvedValue({ body: { hits: { hits: createMockHits(2) } } })
        const { retrieveWithInfo } = await import('./retriever.js')
        await retrieveWithInfo('test query', { os: mockOs, filter })
        const searchCall = mockOs.search.mock.calls[0]?.[0]
        expect(searchCall.body.query.bool.filter).toEqual([
            { term: { brand_name: 'Advil' } },
            { term: { route: 'ORAL' } }
        ])
    })

    it('respects topK parameter', async () => {
        mockOs.search.mockResolvedValue({ body: { hits: { hits: createMockHits(10) } } })
        const { retrieveWithInfo } = await import('./retriever.js')
        const result = await retrieveWithInfo('test query', { os: mockOs, topK: 5 })
        const searchCall = mockOs.search.mock.calls[0]?.[0]
        expect(searchCall.body.size).toBe(5)
        expect(result.hits).toHaveLength(5)
    })

    it('includes highlight when requested', async () => {
        mockOs.search.mockResolvedValue({ body: { hits: { hits: createMockHits(1) } } })
        const { retrieveWithInfo } = await import('./retriever.js')
        await retrieveWithInfo('test query', { os: mockOs, highlight: true })
        const searchCall = mockOs.search.mock.calls[0]?.[0]
        expect(searchCall.body.highlight).toBeDefined()
        expect(searchCall.body.highlight.fields.text).toBeDefined()
        expect(searchCall.body.highlight.fields.text.fragment_size).toBe(800)
    })

    it('respects sourceFields parameter', async () => {
        mockOs.search.mockResolvedValue({ body: { hits: { hits: createMockHits(1) } } })
        const { retrieveWithInfo } = await import('./retriever.js')
        await retrieveWithInfo('test query', { os: mockOs, sourceFields: ['text', 'label_id'] })
        const searchCall = mockOs.search.mock.calls[0]?.[0]
        expect(searchCall.body._source).toEqual({ includes: ['text', 'label_id'], excludes: ['embedding'] })
    })

    it('returns empty results when all strategies fail', async () => {
        mockOs.search.mockRejectedValue(new Error('All strategies failed'))
        const { retrieveWithInfo } = await import('./retriever.js')
        const result = await retrieveWithInfo('test query', { os: mockOs })
        expect(result.hits).toEqual([])
        expect(result.strategy).toBe('auto')
    })

    it('throws error when specific strategy fails', async () => {
        mockOs.search.mockRejectedValue(new Error('knn_query failed'))
        const { retrieveWithInfo } = await import('./retriever.js')
        await expect(
            retrieveWithInfo('test query', { os: mockOs, strategy: 'knn_query' })
        ).rejects.toThrow('knn_query failed')
    })

    it('uses environment variables for defaults', async () => {
        const originalEnv = process.env
        process.env = {
            ...originalEnv,
            INDEX_CHUNKS: 'custom-chunks-index'
        }
        mockOs.search.mockResolvedValue({ body: { hits: { hits: createMockHits(1) } } })
        const { retrieveWithInfo } = await import('./retriever.js')
        await retrieveWithInfo('test query', { os: mockOs })
        const searchCall = mockOs.search.mock.calls[0]?.[0]
        expect(searchCall.index).toBe('custom-chunks-index')
        process.env = originalEnv
    })
})

