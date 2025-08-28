import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createMockOsClient, type MockOsClient } from '../utils/mock-os-client.js'

// Mock the OpenAI embeddings
const mockEmbedDocuments = vi.fn()
vi.mock('@langchain/openai', () => ({
    OpenAIEmbeddings: vi.fn().mockImplementation(() => ({
        embedDocuments: mockEmbedDocuments
    }))
}))

// Mock environment client
const mockOsClientFromEnv = vi.fn()
vi.mock('./os-client.js', () => ({
    osClientFromEnv: mockOsClientFromEnv
}))

function createMockHits(count: number = 2) {
    return Array.from({ length: count }, (_, i) => ({
        _id: `doc_${i}`,
        _score: 0.8 - (i * 0.1),
        _source: {
            chunk_id: `chunk_${i}`,
            label_id: `label_${i}`,
            set_id: `set_${i}`,
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

describe('retriever', () => {
    let mockOs: MockOsClient
    let mockEmbedder: { embedDocuments: typeof mockEmbedDocuments }

    beforeEach(() => {
        vi.clearAllMocks()
        mockOs = createMockOsClient()
        mockEmbedder = { embedDocuments: mockEmbedDocuments }
        mockOsClientFromEnv.mockReturnValue(mockOs)

        // Default embedding response
        mockEmbedDocuments.mockResolvedValue([Array(1536).fill(0.01)])
    })

    afterEach(() => {
        vi.clearAllMocks()
    })

    it('uses provided OpenSearch client and embedder', async () => {
        const customOs = createMockOsClient()
        const customEmbedder = { embedDocuments: vi.fn().mockResolvedValue([Array(1536).fill(0.02)]) }

        customOs.search.mockResolvedValue({
            body: { hits: { hits: createMockHits(1) } }
        })

        const { retrieveWithInfo } = await import('./retriever.js')

        const result = await retrieveWithInfo('test query', {
            os: customOs,
            embedder: customEmbedder
        })

        expect(customEmbedder.embedDocuments).toHaveBeenCalledWith(['test query'])
        expect(customOs.search).toHaveBeenCalled()
        expect(mockOsClientFromEnv).not.toHaveBeenCalled()
        expect(result.hits).toHaveLength(1)
    });

    it('falls back to environment client and default embedder', async () => {
        mockOs.search.mockResolvedValue({
            body: { hits: { hits: createMockHits(1) } }
        })

        const { retrieveWithInfo } = await import('./retriever.js')

        await retrieveWithInfo('test query')

        expect(mockOsClientFromEnv).toHaveBeenCalled()
        // The default embedder is a new OpenAIEmbeddings instance, not our mock
        expect(mockOs.search).toHaveBeenCalled()
    });

    it('uses provided query vector without embedding', async () => {
        const queryVector = Array(1536).fill(0.05)
        mockOs.search.mockResolvedValue({
            body: { hits: { hits: createMockHits(1) } }
        })

        const { retrieveWithInfo } = await import('./retriever.js')

        await retrieveWithInfo('test query', {
            os: mockOs,
            queryVector,
            embedder: mockEmbedder
        })

        expect(mockEmbedder.embedDocuments).not.toHaveBeenCalled()
        expect(mockOs.search).toHaveBeenCalled()
    });

    it('tries knn_query strategy first by default', async () => {
        mockOs.search.mockResolvedValue({
            body: { hits: { hits: createMockHits(2) } }
        })

        const { retrieveWithInfo } = await import('./retriever.js')

        const result = await retrieveWithInfo('test query', { os: mockOs })

        expect(result.strategy).toBe('knn_query')
        expect(mockOs.search).toHaveBeenCalledTimes(1)

        const searchCall = mockOs.search.mock.calls[0]?.[0]
        expect(searchCall.body.query.knn).toBeDefined()
        expect(searchCall.body.query.knn.embedding.vector).toHaveLength(1536)
        expect(searchCall.body.query.knn.embedding.k).toBe(10)
    })

    it('falls back to next strategy when first fails', async () => {
        // First call (knn_query) fails
        mockOs.search.mockRejectedValueOnce(new Error('knn_query not supported'))

        // Second call (knn) succeeds
        mockOs.search.mockResolvedValueOnce({
            body: { hits: { hits: createMockHits(1) } }
        })

        const { retrieveWithInfo } = await import('./retriever.js')

        const result = await retrieveWithInfo('test query', { os: mockOs })

        expect(result.strategy).toBe('knn')
        expect(mockOs.search).toHaveBeenCalledTimes(2)

        // Second call should use top-level knn
        const secondCall = mockOs.search.mock.calls[1]?.[0]
        expect(secondCall.body.knn).toBeDefined()
        expect(secondCall.body.knn.field).toBe('embedding')
    })

    it('applies filters correctly', async () => {
        const filter = { brand_name: 'Advil', route: 'ORAL' }
        mockOs.search.mockResolvedValue({
            body: { hits: { hits: createMockHits(1) } }
        })

        const { retrieveWithInfo } = await import('./retriever.js')

        await retrieveWithInfo('test query', { os: mockOs, filter })

        const searchCall = mockOs.search.mock.calls[0]?.[0]
        expect(searchCall.body.query.bool.filter).toEqual([
            { term: { brand_name: 'Advil' } },
            { term: { route: 'ORAL' } }
        ])
    })

    it('respects topK parameter', async () => {
        const topK = 5
        mockOs.search.mockResolvedValue({
            body: { hits: { hits: createMockHits(10) } }
        })

        const { retrieveWithInfo } = await import('./retriever.js')

        const result = await retrieveWithInfo('test query', { os: mockOs, topK })

        const searchCall = mockOs.search.mock.calls[0]?.[0]
        expect(searchCall.body.size).toBe(topK)
        expect(result.hits).toHaveLength(topK)
    })

    it('includes highlight when requested', async () => {
        mockOs.search.mockResolvedValue({
            body: { hits: { hits: createMockHits(1) } }
        })

        const { retrieveWithInfo } = await import('./retriever.js')

        await retrieveWithInfo('test query', { os: mockOs, highlight: true })

        const searchCall = mockOs.search.mock.calls[0]?.[0]
        expect(searchCall.body.highlight).toBeDefined()
        expect(searchCall.body.highlight.fields.text).toBeDefined()
        expect(searchCall.body.highlight.fields.text.fragment_size).toBe(800)
    })

    it('respects sourceFields parameter', async () => {
        const sourceFields = ['text', 'label_id']
        mockOs.search.mockResolvedValue({
            body: { hits: { hits: createMockHits(1) } }
        })

        const { retrieveWithInfo } = await import('./retriever.js')

        await retrieveWithInfo('test query', { os: mockOs, sourceFields })

        const searchCall = mockOs.search.mock.calls[0]?.[0]
        expect(searchCall.body._source).toEqual({includes: sourceFields, excludes: ['embedding']})
    })

    it('deduplicates by label when maxPerLabel is set', async () => {
        const hits = [
            { _id: '1', _score: 0.9, _source: { set_id: 'set_A', text: 'content 1' } },
            { _id: '2', _score: 0.8, _source: { set_id: 'set_A', text: 'content 2' } },
            { _id: '3', _score: 0.7, _source: { set_id: 'set_B', text: 'content 3' } },
            { _id: '4', _score: 0.6, _source: { set_id: 'set_A', text: 'content 4' } }
        ]

        mockOs.search.mockResolvedValue({
            body: { hits: { hits } }
        })

        const { retrieveWithInfo } = await import('./retriever.js')

        const result = await retrieveWithInfo('test query', {
            os: mockOs,
            maxPerLabel: 1
        })

        // Should only return first hit from each set_id
        expect(result.hits).toHaveLength(2)
        expect(result.hits[0]!._source.set_id).toBe('set_A')
        expect(result.hits[1]!._source.set_id).toBe('set_B')
    })

    it('forces specific strategy when requested', async () => {
        mockOs.search.mockResolvedValue({
            body: { hits: { hits: createMockHits(1) } }
        })

        const { retrieveWithInfo } = await import('./retriever.js')

        const result = await retrieveWithInfo('test query', {
            os: mockOs,
            strategy: 'script'
        })

        expect(result.strategy).toBe('script')
        expect(mockOs.search).toHaveBeenCalledTimes(1)

        const searchCall = mockOs.search.mock.calls[0]?.[0]
        expect(searchCall.body.query.script_score).toBeDefined()
        expect(searchCall.body.query.script_score.script.source).toContain('cosineSimilarity')
    })

    it('uses text search strategy', async () => {
        mockOs.search.mockResolvedValue({
            body: { hits: { hits: createMockHits(1) } }
        })

        const { retrieveWithInfo } = await import('./retriever.js')

        const result = await retrieveWithInfo('test query', {
            os: mockOs,
            strategy: 'text'
        })

        expect(result.strategy).toBe('text')

        const searchCall = mockOs.search.mock.calls[0]?.[0]
        expect(searchCall.body.query.match).toBeDefined()
        expect(searchCall.body.query.match.text).toBe('test query')
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

    it('handles different response body structures', async () => {
        // Test when response is nested in .body
        mockOs.search.mockResolvedValue({
            body: {
                hits: { hits: createMockHits(1) },
                took: 15
            }
        })

        const { retrieveWithInfo } = await import('./retriever.js')

        const result = await retrieveWithInfo('test query', { os: mockOs })
        expect(result.hits).toHaveLength(1)
    })

    it('handles response without .body wrapper', async () => {
        // Test when response is direct
        mockOs.search.mockResolvedValue({
            hits: { hits: createMockHits(1) },
            took: 15
        })

        const { retrieveWithInfo } = await import('./retriever.js')

        const result = await retrieveWithInfo('test query', { os: mockOs })
        expect(result.hits).toHaveLength(1)
    })

    it('uses environment variables for defaults', async () => {
        // Mock environment variables
        const originalEnv = process.env
        process.env = {
            ...originalEnv,
            INDEX_CHUNKS: 'custom-chunks-index'
        }

        mockOs.search.mockResolvedValue({
            body: { hits: { hits: createMockHits(1) } }
        })

        const { retrieveWithInfo } = await import('./retriever.js')

        await retrieveWithInfo('test query', { os: mockOs })

        const searchCall = mockOs.search.mock.calls[0]?.[0]
        expect(searchCall.index).toBe('custom-chunks-index')

        // Restore environment
        process.env = originalEnv
    })

    it('throws error when embedding returns empty vector', async () => {
        // Mock embedder that returns empty/null vector
        const badEmbedder = {
            embedDocuments: vi.fn().mockResolvedValue([null])
        }

        const { retrieveWithInfo } = await import('./retriever.js')

        await expect(
            retrieveWithInfo('test query', { os: mockOs, embedder: badEmbedder })
        ).rejects.toThrow('Failed to embed query')
    })

    it('propagates embedding API errors', async () => {
        mockEmbedDocuments.mockRejectedValue(new Error('Embedding API failed'))

        const { retrieveWithInfo } = await import('./retriever.js')

        await expect(
            retrieveWithInfo('test query', { os: mockOs, embedder: mockEmbedder })
        ).rejects.toThrow('Embedding API failed')
    })
})
