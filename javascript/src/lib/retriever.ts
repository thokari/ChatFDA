
import { OpenAIEmbeddings } from "@langchain/openai"
import type { Embedder, OsLike } from "./types"
import { osClientFromEnv } from "./os-client"
import { createLogger } from "../utils/log"
import { CHUNK_SIZE } from "./chunking"

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
    queryVector?: number[] | undefined
}

export type RetrieveHit = { _id: string; _score: number; _source: any; highlight?: any }

const log = createLogger("retriever")

export type HybridOptions = RetrieveOptions & {
    textK?: number
    annK?: number
    rrfC?: number
    window?: number
}

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
            log.debug("request", { index, strategy: name, body })
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

// Hybrid retrieval: run text BM25 and ANN in parallel, fuse via RRF. No per-label limiting.
export async function retrieveHybrid(
    query: string,
    opts: HybridOptions = {}
): Promise<{ hits: RetrieveHit[]; info: { strategy: "hybrid"; textCount: number; annCount: number; embedded: boolean } }> {
    const os = opts.os ?? osClientFromEnv()
    const index = opts.index ?? (process.env.INDEX_CHUNKS || "drug-chunks")
    const topK = opts.topK ?? DEFAULT_TOPK
    const textK = opts.textK ?? Math.max(200, topK * 10)
    const annK = opts.annK ?? Math.max(200, topK * 10)
    const cap = opts.cap ?? topK
    const rrfC = opts.rrfC ?? 60
    const window = opts.window ?? Math.max(textK, annK)
    const _source = opts.sourceFields ?? ["chunk_id", "label_id", "section", "text", "openfda"]

    // Embed once or use provided
    let vec: number[] | undefined
    let embedded = false
    if (opts.queryVector && Array.isArray(opts.queryVector) && opts.queryVector.length) {
        vec = opts.queryVector
    } else {
        const embedder: Embedder = opts.embedder ?? (new OpenAIEmbeddings({ model: "text-embedding-3-small" }) as any)
        vec = (await embedder.embedDocuments([query]))[0]!
        if (!vec) throw new Error("Failed to embed query")
        embedded = true
    }

    const highlight = opts.highlight
        ? { fields: { text: { fragment_size: CHUNK_SIZE, number_of_fragments: 1, no_match_size: CHUNK_SIZE } } }
        : undefined

    const sourceFilter = { includes: _source, excludes: ["embedding"] }

    // Build requests
    const textBody = {
        size: textK,
        query: withFilter(opts.filter, { match: { text: query } }),
        _source: sourceFilter,
        highlight,
    }
    const annBody = {
        size: annK,
        knn: {
            field: "embedding",
            query_vector: vec,
            k: annK,
            num_candidates: opts.numCandidates ?? Math.max(500, annK * 2),
            filter: toKnnFilter(opts.filter),
        },
        _source: sourceFilter,
        highlight,
    }

    // Execute in parallel
    const [textRes, annRes] = await Promise.allSettled([
        os.search({ index, body: textBody }),
        os.search({ index, body: annBody }),
    ])

    const getHits = (res: any): RetrieveHit[] => {
        const bodyAny: any = (res as any).body ?? res
        return bodyAny?.hits?.hits ?? res?.hits?.hits ?? []
    }

    const textHits = textRes.status === "fulfilled" ? getHits(textRes.value) : []
    const annHits = annRes.status === "fulfilled" ? getHits(annRes.value) : []

    const fused = rrfFuse([textHits, annHits], rrfC, Math.max(window, cap))
    const finalHits = fused.slice(0, cap)

    return { hits: finalHits, info: { strategy: "hybrid", textCount: textHits.length, annCount: annHits.length, embedded } }
}

// Safe dot product for two vectors
function dotProduct(a: number[] | undefined, b: number[] | undefined): number {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0
    let sum = 0
    for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!
    return sum
}

// RRF fusion for multiple ranked lists. Returns unique hits by _id, keeping first seen _source/highlight.
export function rrfFuse(lists: RetrieveHit[][], c: number = 60, max: number = DEFAULT_TOPK): RetrieveHit[] {
    const scoreById = new Map<string, number>()
    const exemplarById = new Map<string, RetrieveHit>()
    for (const list of lists) {
        for (let i = 0; i < list.length; i++) {
            const h = list[i]!
            const id = h._id
            const add = 1 / (c + (i + 1))
            scoreById.set(id, (scoreById.get(id) ?? 0) + add)
            if (!exemplarById.has(id)) exemplarById.set(id, h)
        }
    }
    const fused = Array.from(scoreById.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, max)
        .map(([id]) => exemplarById.get(id)!)
    return fused
}

/**
 * Max Marginal Relevance (MMR) diversity selection.
 * Selects top-k items balancing query relevance and intra-set diversity.
 *
 * @param candidates Array of { id, qSim, embedding } where:
 *   - id: string (unique doc id)
 *   - qSim: number (query similarity, e.g. dot/cosine)
 *   - embedding: number[] (L2-normalized vector)
 * @param k Number of items to select
 * @param lambda Tradeoff between relevance (lambda) and diversity (1-lambda), 0.5-0.8 typical
 * @returns Array of selected candidates (same shape as input)
 */
export function mmrDiversify(
    candidates: { id: string; qSim: number; embedding: number[] }[],
    k: number,
    lambda = 0.7
) {
    const selected: typeof candidates = []
    const remain = [...candidates]
    while (selected.length < k && remain.length) {
        if (selected.length === 0) {
            // pick highest query similarity first
            remain.sort((a, b) => b.qSim - a.qSim)
            selected.push(remain.shift()!)
            continue
        }
        let bestIdx = 0
        let bestScore = -Infinity
        for (let i = 0; i < remain.length; i++) {
            const d = remain[i]!
            let maxSimToSelected = -Infinity
            for (const s of selected) {
                // cosine since normalized
                const e = d.embedding!; const f = s.embedding!
                const dot = dotProduct(e, f)
                if (dot > maxSimToSelected) maxSimToSelected = dot
            }
            const mmr = lambda * d.qSim - (1 - lambda) * maxSimToSelected
            if (mmr > bestScore) { bestScore = mmr; bestIdx = i }
        }
        selected.push(remain.splice(bestIdx, 1)[0]!)
    }
    return selected
}

function toKnnFilter(filter?: Record<string, any>) {
    if (!filter || Object.keys(filter).length === 0) return undefined
    return Object.entries(filter).map(([k, v]) => ({ term: { [k]: v } }))
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
