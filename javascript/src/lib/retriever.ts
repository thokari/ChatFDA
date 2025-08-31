import { OpenAIEmbeddings } from "@langchain/openai"
import type { Embedder, OsLike } from "./types"
import { osClientFromEnv } from "./os-client"
import { createLogger } from "../utils/log"

export const DEFAULT_TOPK = 12

export type RetrieveOptions = {
    os?: OsLike
    embedder?: Embedder
    index?: string
    topK?: number
    cap?: number
    numCandidates?: number
    filter?: Record<string, string | number | boolean>
    sourceFields?: string[]
    highlight?: boolean
    strategy?: "auto" | "knn" | "knn_query" | "script" | "text"
    maxPerLabel?: number // e.g., 1 to avoid repeats per label
    queryVector?: number[] | undefined // optional: bypass embedding for timing/debug
}

export type RetrieveHit = { _id: string; _score: number; _source: any; highlight?: any }

const log = createLogger("retriever")

export async function retrieveWithInfo(
    query: string,
    opts: RetrieveOptions = {}
): Promise<{ hits: RetrieveHit[]; strategy: string }> {
    const t0 = Date.now()
    const os = opts.os ?? osClientFromEnv()
    const index = opts.index ?? (process.env.INDEX_CHUNKS || "drug-chunks")
    const topK = opts.topK ?? DEFAULT_TOPK
    const cap = opts.cap ?? topK
    const numCandidates = opts.numCandidates ?? Math.max(500, topK * 50)
    const _source = opts.sourceFields ?? ["chunk_id", "label_id", "section", "text", "openfda"]

    const want = opts.strategy ?? "auto"
    const allow = (n: string) => want === "auto" || want === n

    // embed once
    let vec: number[] | undefined
    let embedMs = 0
    if (opts.queryVector && Array.isArray(opts.queryVector) && opts.queryVector.length) {
        vec = opts.queryVector
    } else {
        const tEmb0 = Date.now()
        const embedder: Embedder = opts.embedder ?? (new OpenAIEmbeddings({ model: "text-embedding-3-small" }) as any)
        vec = (await embedder.embedDocuments([query]))[0]!
        embedMs = Date.now() - tEmb0
        if (!vec) throw new Error("Failed to embed query")
    }

    const highlight = opts.highlight
        ? { fields: { text: { fragment_size: 800, number_of_fragments: 1, no_match_size: 800 } } }
        : undefined

    const strategies: Array<{ name: string; body: any }> = []

    const sourceFilter = { includes: _source, excludes: ["embedding"] }
    // Prefer query-level kNN first; supports your cluster and returns hits
    if (allow("knn_query")) strategies.push({
        name: "knn_query",
        body: {
            size: topK,
            query: knnQueryWithFilter(vec, topK, opts.filter),
            _source: sourceFilter,
            highlight,
        }
    })

    // Top-level kNN (kept for newer clusters)
    if (allow("knn")) strategies.push({
        name: "knn",
        body: {
            size: topK,
            knn: {
                field: "embedding",
                query_vector: vec,
                k: topK,
                num_candidates: numCandidates,
                filter: toKnnFilter(opts.filter),
            },
            _source: sourceFilter,
            highlight,
        }
    })

    // Script-score fallback (may not be supported for knn_vector on your cluster)
    if (allow("script")) strategies.push({
        name: "script",
        body: {
            size: topK,
            query: {
                script_score: {
                    query: withFilter(opts.filter),
                    script: { source: "cosineSimilarity(params.q, 'embedding') + 1.0", params: { q: vec } },
                },
            },
            _source: sourceFilter,
            highlight,
        }
    })

    // Text fallback
    if (allow("text")) strategies.push({
        name: "text",
        body: {
            size: topK,
            query: withFilter(opts.filter, { match: { text: query } }),
            _source: sourceFilter,
            highlight,
        }
    })

    for (const { name, body } of strategies) {
        try {
            if (log.isDebug()) {
                log.debug("request", { index, strategy: name, body })
            }
            const tSearch0 = Date.now()
            const res = await os.search({ index, body })
            const searchMs = Date.now() - tSearch0
            const bodyAny: any = (res as any).body ?? res
            const hits = bodyAny?.hits?.hits ?? res?.hits?.hits
            const osTook = bodyAny?.took
            if (Array.isArray(hits)) {
                const tPost0 = Date.now()
                const before = hits.length
                const capped = hits.slice(0, cap)
                const postMs = Date.now() - tPost0
                if (log.isDebug()) {
                    const totalMs = Date.now() - t0
                    log.debug("done", { strategy: name, embedMs, searchMs, osTook: osTook ?? "-", postMs, rawHits: before, returned: capped.length, topK, totalMs })
                }
                return { hits: capped, strategy: name }
            }
        } catch (e) {
            log.warn("strategy failed", { strategy: name, error: String(e) })
            if ((opts.strategy && opts.strategy !== "auto") && strategies.length === 1) throw e
        }
    }
    return { hits: [], strategy: want }
}

// Helpers
function toKnnFilter(filter?: Record<string, any>) {
    if (!filter || Object.keys(filter).length === 0) return undefined
    return Object.entries(filter).map(([k, v]) => ({ term: { [k]: v } }))
}

function toFilter(filter?: Record<string, any>) {
    if (!filter || Object.keys(filter).length === 0) return undefined
    const terms = Object.entries(filter).map(([k, v]) => ({ term: { [k]: v } }))
    return { bool: { filter: terms } }
}

function withFilter(filter?: Record<string, any>, baseQuery?: any) {
    if (!filter || Object.keys(filter).length === 0) return baseQuery ?? { match_all: {} }
    const terms = Object.entries(filter).map(([k, v]) => ({ term: { [k]: v } }))
    return baseQuery ? { bool: { must: [baseQuery], filter: terms } } : { bool: { filter: terms } }
}

// Build a knn query that optionally combines filters via bool (no num_candidates on this OS)
function knnQueryWithFilter(vec: number[], k: number, filter?: Record<string, any>) {
    const knn = { knn: { embedding: { vector: vec, k } } }
    if (!filter || Object.keys(filter).length === 0) return knn
    const terms = Object.entries(filter).map(([k, v]) => ({ term: { [k]: v } }))
    return { bool: { must: [knn], filter: terms } }
}
