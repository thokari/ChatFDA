import { describe, it, expect } from 'vitest'

// Run only when explicitly enabled to avoid hitting OS/LLM during unit test runs
const RUN_INT = process.env.RUN_INT === '1'

const maybeDescribe = RUN_INT ? describe : describe.skip

maybeDescribe('integration: OpenSearch retrieval', () => {
    const queries = [
        'boxed warning for ibuprofen',
        'dosage and administration for amoxicillin',
        'contraindications pregnancy aspirin',
    ]

    it('text search: returns hits and prints a few fields', async () => {
        const { retrieveWithInfo } = await import('./retriever.js')
        for (const q of queries) {
            const { hits, strategy } = await retrieveWithInfo(q, {
                strategy: 'text',
                highlight: false,
                topK: 10,
            })

            // Minimal assertion: does not throw and returns an array
            expect(Array.isArray(hits)).toBe(true)

            // Log a compact view for manual inspection
            const sample = hits.slice(0, 5).map(h => ({
                id: h._id,
                score: h._score,
                label_id: h._source?.label_id,
                section: h._source?.section,
                text: (h.highlight?.text?.[0] ?? h._source?.text ?? ''),
            }))
            // eslint-disable-next-line no-console
            console.log(`[text] q="${q}" strategy=${strategy} n=${hits.length}`, sample)
        }
    })

    it('hybrid search (if OPENAI key present): returns fused hits and logs results', async () => {
        if (!process.env.OPENAI_API_KEY) {
            // eslint-disable-next-line no-console
            console.log('[hybrid] skipped: no OPENAI_API_KEY in env')
            return
        }
        const { retrieveHybrid } = await import('./retriever.js')
        for (const q of queries) {
            const { hits, info } = await retrieveHybrid(q, {
                topK: 10,
                textK: 50,
                annK: 50,
                highlight: false,
            })

            expect(Array.isArray(hits)).toBe(true)

            const sample = hits.slice(0, 5).map(h => ({
                id: h._id,
                label_id: h._source?.label_id,
                section: h._source?.section,
                text: (h.highlight?.text?.[0] ?? h._source?.text ?? ''),
            }))
            // eslint-disable-next-line no-console
            console.log(`[hybrid] q="${q}" text=${info.textCount} ann=${info.annCount}`, sample)
        }
    })
})

