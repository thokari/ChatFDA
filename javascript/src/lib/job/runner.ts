#!/usr/bin/env ts-node
import "dotenv/config"
import crypto from "node:crypto"
import pRetry from "p-retry"
import { embeddingTextForChunk } from "@/lib/chunking"
import { OpenAIEmbeddings } from "@langchain/openai"
import type { Chunker, Embedder, Fetcher, OsLike } from "../types.js"
import { fetchFdaLabels } from "../fda-api.js"
import { chunkSections } from "../chunking.js"
import { osClientFromEnv } from "../os-client.js"
import { getJob, updateJob, heartbeat, logEvent, setStatus } from "./control.js"
import { createLogger } from "@/utils/log"

type Deps = {
    os?: OsLike
    fetcher?: Fetcher
    chunker?: Chunker
    embedder?: Embedder
}

const LABELS_INDEX = process.env.INDEX_LABELS || "drug-labels"
const CHUNKS_INDEX = process.env.INDEX_CHUNKS || "drug-chunks"

const log = createLogger("runner")

export async function runJob(jobId: string, deps: Deps = {}) {
    // Narrow to OsLike once; OpenSearch Client is structurally compatible for the methods we use
    const os: OsLike = deps.os ?? osClientFromEnv()
    const fetcher = deps.fetcher ?? fetchFdaLabels
    const chunker = deps.chunker ?? chunkSections
    const embedder = deps.embedder ?? new OpenAIEmbeddings({ model: "text-embedding-3-small" })

    let job = await getJob(os as any, jobId)
    if (!job) throw new Error(`Job ${jobId} not found`)
    if (job.status !== "RUNNING") {
        log.info(`Job ${jobId} status is ${job.status} nothing to do.`)
        return
    }

    const { ingredient, route, updatedSince, limit } = job.params
    log.info(`[job] ${jobId} running: ingredient=${ingredient ?? "-"} route=${route ?? "-"} limit=${limit} updatedSince=${updatedSince ?? "-"}`)

    while (true) {
        const tLoop0 = Date.now()
        await heartbeat(os as any, jobId)

        const skip = job.cursor.skip
        await logEvent(os as any, jobId, "INFO", "FETCH", `Fetching limit=${limit} skip=${skip}`, { limit, skip })
        const tFetch0 = Date.now()

        const base = { limit, skip } as const
        const filters = {
            ...(ingredient !== undefined ? { ingredient } : {}),
            ...(route !== undefined ? { route } : {}),
            ...(updatedSince !== undefined ? { updatedSince } : {}),
        }

        const page = await pRetry(
            () => fetcher({ ...base, ...filters, retries: 0 } as any),
            { retries: 3 }
        )
        const tFetchMs = Date.now() - tFetch0

        // set total_expected on first page if not provided
        if (job.params.total_expected == null) {
            const total =
                // try common shapes
                (page as any)?.total ??
                (page as any)?.meta?.results?.total ??
                (page as any)?.resultsTotal
            if (typeof total === "number") {
                job.params.total_expected = total
                await updateJob(os as any, jobId, { params: job.params })
                log.info(`[plan] total_expected=${total}`)
            }
        }

        const labels = page.results
        log.info(`[fetch] got ${labels.length} labels in ${tFetchMs}ms (nextSkip=${page.nextSkip ?? "null"})`)
        if (!labels.length) {
            await setStatus(os as any, jobId, "COMPLETED")
            log.info(`Job ${jobId} completed. labels_seen=${job.counters.labels_seen}`)
            return
        }

        // Upsert labels
        const tLabels0 = Date.now()
        const labelLines: string[] = []
    for (const l of labels) {
            labelLines.push(JSON.stringify({ index: { _index: LABELS_INDEX, _id: l.id } }))
            labelLines.push(JSON.stringify(l))
        }
        log.debug(`[index] preparing ${labelLines.length / 2} labels for bulk upsert (lines=${labelLines.length})`)
        await bulk(os, labelLines, jobId, "labels")
        log.debug(`[index] upserted ${labels.length} labels in ${Date.now() - tLabels0}ms`)

        // Build chunks with content hash
        const chunks: any[] = []
        let totalSecChunks = 0
        const tChunk0 = Date.now()
    for (const l of labels) {
            const labelId = l.id
            const eff = l.effective_time || null
            const effNum = typeof eff === "string" ? parseInt(eff, 10) : (typeof eff === "number" ? eff : NaN)
            const effNumSafe = Number.isFinite(effNum) ? effNum : null
            const effStr = String(effNumSafe ?? "")
            const effDate =
                effNumSafe && effStr.length === 8
                    ? `${effStr.slice(0, 4)}-${effStr.slice(4, 6)}-${effStr.slice(6, 8)}`
                    : null
            const secChunks = await chunker(l)
            totalSecChunks += secChunks.length
            for (const c of secChunks) {
                const text = c.text
                const hash = sha256(`${c.section}\n${text}`)
                const ofda = l.openfda ?? {}
                const brand = ofda.brand_name ?? []
                const gen = ofda.generic_name ?? []
                const subs = ofda.substance_name ?? []
                const routeArr = ofda.route ?? []
                const dform = ofda.dosage_form ?? ofda.dosage_forms ?? []
                const app = ofda.application_number ?? []
                const pndc = ofda.product_ndc ?? []
                const pkndc = ofda.package_ndc ?? []
                const strength = ofda.active_ingredient ?? []
                const display_name = [
                    (brand[0] || gen[0] || "").trim(),
                    strength[0] ? `(${strength[0]})` : "",
                    routeArr[0] ? `[${routeArr[0]}]` : "",
                ].filter(Boolean).join(" ")
                chunks.push({
                    chunk_id: `${labelId}#${c.section}#${c.idx}`,
                    label_id: labelId,
                    section: c.section,
                    text,
                    hash,
                    effective_time: eff,
                    effective_time_num: effNumSafe,
                    effective_time_date: effDate,
                    chunk_seq: c.chunk_seq,
                    chunk_total: c.chunk_total,
                    is_first: c.is_first,
                    is_last: c.is_last,
                    openfda: {
                        brand_name: brand,
                        generic_name: gen,
                        manufacturer_name: ofda.manufacturer_name ?? [],
                        route: routeArr,
                        route_lc: routeArr.map((r: string) => r.toLowerCase()),
                        product_type: ofda.product_type ?? [],
                        substance_name: subs,
                        substance_name_lc: subs.map((s: string) => s.toLowerCase()),
                        dosage_form: dform,
                        application_number: app,
                        product_ndc: pndc,
                        package_ndc: pkndc,
                        active_ingredient: strength,
                    },
                    display_name,
                    product_key: `${(gen[0] || brand[0] || "").toLowerCase()}|${(routeArr[0] || "").toLowerCase()}|${(dform[0] || "").toLowerCase()}`,
                })
            }
        }
        log.debug(`[chunk] built ${chunks.length} chunks from ${labels.length} labels (secChunks=${totalSecChunks}) in ${Date.now() - tChunk0}ms`)

        job.counters.labels_seen += labels.length
        // Derive unique labels processed from the paging cursor
        const seenUnique = Math.max(job.counters.labels_seen ?? 0, skip + labels.length)
        const totalPlanned = typeof job.params.total_expected === "number" ? job.params.total_expected : undefined
        job.counters.labels_seen = totalPlanned ? Math.min(seenUnique, totalPlanned) : seenUnique
        job.counters.chunks_considered += chunks.length

        // Skip unchanged chunks via mget(hash compare)
        const ids = chunks.map(c => c.chunk_id)
        const tMget0 = Date.now()
        const existing = await mget(os, CHUNKS_INDEX, ids)
        const existingMap = new Map(existing.map(d => [d._id, d._source?.hash]))
        const todo = chunks.filter(c => existingMap.get(c.chunk_id) !== c.hash)
        log.debug(`[dedupe] existing=${existing.length} todo=${todo.length} skipped=${chunks.length - todo.length} (mget ${Date.now() - tMget0}ms)`)

        // Embed + upsert in small batches
        const B = 64
        if (todo.length) {
            log.info(`[embed] ${todo.length} chunks in ~${Math.ceil(todo.length / B)} batches of <=${B}`)
        } else {
            log.info(`[embed] nothing to embed (all chunks up-to-date)`)
        }
        for (let i = 0; i < todo.length; i += B) {
            const batch = todo.slice(i, i + B)
            const tEmb0 = Date.now()
            const vecs = await pRetry(
                () => embedder.embedDocuments(batch.map(b => {
                    const tags: string[] = []
                    const subs = (b.openfda?.substance_name_lc ?? b.openfda?.substance_name ?? []) as string[]
                    const gen = (b.openfda?.generic_name ?? []) as string[]
                    const brand = (b.openfda?.brand_name ?? []) as string[]
                    const route = (b.openfda?.route_lc ?? b.openfda?.route ?? []) as string[]
                    const drug = (subs[0] || gen[0] || brand[0])?.toString()?.toLowerCase()
                    if (drug) tags.push(`Drug: ${drug}`)
                    if (route[0]) tags.push(`Route: ${route[0]}`)
                    return embeddingTextForChunk(b.text, {
                        section: b.section,
                        chunk_seq: b.chunk_seq,
                        chunk_total: b.chunk_total,
                        is_first: b.is_first,
                        is_last: b.is_last,
                    }, tags)
                })),
                { retries: 5 }
            )
            const embMs = Date.now() - tEmb0
            logEmbedBatch(i, i + batch.length - 1, batch.length, embMs)

            const tBulk0 = Date.now()
            const lines: string[] = []
            for (let j = 0; j < batch.length; j++) {
                batch[j].embedding = vecs[j]
                lines.push(JSON.stringify({ index: { _index: CHUNKS_INDEX, _id: batch[j].chunk_id } }))
                lines.push(JSON.stringify(batch[j]))
            }
            log.debug(`[index] preparing ${batch.length} chunks for bulk upsert (lines=${lines.length})`)
            await bulk(os, lines, jobId, `chunks ${i}-${i + batch.length}`)
            log.debug(`[index] upserted ${batch.length} chunks in ${Date.now() - tBulk0}ms`)
            job.counters.chunks_embedded += batch.length

            // Live progress within this page
            const done = Math.min(i + batch.length, todo.length)
            logProgress(done, todo.length, "chunks")
        }

        // Progress + rough ETA for this loop
        const loopMs = Date.now() - tLoop0
        const total = job.params.total_expected
        if (typeof total === "number" && total > 0) {
            const pct = ((job.counters.labels_seen / total) * 100).toFixed(1)
            log.info(`[progress] ${job.counters.labels_seen}/${total} labels (${pct}%)`)
        } else {
            log.info(`[progress] labels_seen=${job.counters.labels_seen} (loop ${loopMs}ms)`)
        }

        // End-of-feed check and cursor advance
        const endOfFeed = (page as any)?.nextSkip == null || labels.length < limit
        if (endOfFeed) {
            await setStatus(os as any, jobId, "COMPLETED")
            log.info(`[done] reached end of feed. labels_seen=${job.counters.labels_seen}`)
            return
        }

        job.cursor.skip = (page as any)?.nextSkip ?? (job.cursor.skip + labels.length)
        await updateJob(os as any, jobId, {
            cursor: job.cursor,
            counters: job.counters,
            last_heartbeat: new Date().toISOString(),
        })

        // Re-read status in case someone paused it
        const fresh = await getJob(os as any, jobId)
        if (!fresh || fresh.status !== "RUNNING") {
            console.log(`Job ${jobId} stopped with status ${fresh?.status}`)
            return
        }
        job = fresh
    }
}

// --- OpenSearch helpers  ---

async function bulk(os: OsLike, lines: string[], jobId: string, label: string) {
    if (!lines.length) return
    log.debug(`[bulk] -> os.bulk label=${label} lines=${lines.length}`)
    const res = await os.bulk({ body: lines.join("\n") + "\n" })
    const body: any = (res as any).body ?? res
    log.debug(`[bulk] <- os.bulk label=${label} errors=${!!body?.errors} items=${body?.items?.length ?? 0}`)
    if (body.errors) {
        const firstErr = body.items?.find((it: any) => it.index?.error)?.index?.error
        await logEvent(os as any, jobId, "ERROR", "INDEX", `bulk ${label} failed`, { firstErr })
        throw new Error(`bulk ${label} had errors`)
    }
}

async function mget(os: OsLike, index: string, ids: string[]) {
    const out: any[] = []
    for (let i = 0; i < ids.length; i += 500) {
        const res = await os.mget({ index, body: { ids: ids.slice(i, i + 500) } })
        const body: any = (res as any).body ?? res
        for (const d of body.docs || []) if (d.found) out.push(d)
    }
    return out
}

function sha256(s: string) {
    return crypto.createHash("sha256").update(s).digest("hex")
}

type ChunkItem = {
    section: string
    text: string
    chunk_seq: number
    chunk_total: number
    is_first: boolean
    is_last: boolean
    chunk_id: string // stable id you generate e.g., `${label_id}#${section}#${i}`
}

// Helper: build embed inputs with section prefix
function buildEmbedInputs(chunks: ChunkItem[]) {
    return chunks.map(c =>
        embeddingTextForChunk(c.text, {
            section: c.section,
            chunk_seq: c.chunk_seq,
            chunk_total: c.chunk_total,
            is_first: c.is_first,
            is_last: c.is_last
        })
    )
}

// Helper: construct stored chunk doc by merging label-level fields + chunk fields
function buildChunkDoc(label: any, c: ChunkItem) {
    const src = label ?? {}
    // Optional convenience fields
    const generic = (src.openfda?.generic_name?.[0] ?? src.openfda?.substance_name_lc?.[0] ?? src.openfda?.substance_name?.[0] ?? "").toString()
    const route = (src.openfda?.route_lc?.[0] ?? src.openfda?.route?.[0] ?? "").toString()
    const display_name = src.display_name ?? (generic && route ? `${generic} [${route.toUpperCase()}]` : undefined)
    const effective_time_num = typeof src.effective_time_num === "number"
        ? src.effective_time_num
        : /^\d{8}$/.test(src.effective_time) ? Number(src.effective_time) : undefined

    return {
        // keep all original label fields (dynamic mapping will capture them)
        ...src,
        // chunk body
        text: c.text,
        section: c.section,
        chunk_id: c.chunk_id,
        chunk_seq: c.chunk_seq,
        chunk_total: c.chunk_total,
        is_first: c.is_first,
        is_last: c.is_last,
        // convenience/normalized
        display_name,
        effective_time_num
    }
}

export async function indexChunksBatch(os: any, embedder: { embedDocuments: (docs: string[]) => Promise<number[][]> }, labelSource: any, chunks: ChunkItem[]) {
    if (!chunks.length) return

    // 1) Build embedding inputs (with section prefix)
    const embedInputs = buildEmbedInputs(chunks)

    // 2) Get vectors (retry for transient failures)
    const vectors = await pRetry(() => embedder.embedDocuments(embedInputs), {
        retries: 3,
        minTimeout: 500
    })

    // 3) Build bulk body (store full dynamic docs + vector)
    const body: any[] = []
    for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i]
        if (!c) continue; // Skip undefined entries
        const vector = vectors[i]
        const doc = buildChunkDoc(labelSource, c)
        body.push({ index: { _index: "drug-chunks", _id: c.chunk_id } })
        body.push({
            ...doc,
            embedding: vector // write directly to "embedding"
        })
    }

    // 4) Bulk index
    await os.bulk({ refresh: false, body })
}

function logEmbedBatch(start: number, end: number, size: number, ms: number) {
    const rate = ms > 0 ? +(size / (ms / 1000)).toFixed(1) : 0
    log.info(`[embed] batch ${start}-${end} size=${size} took ${ms}ms (${rate}/s)`)
}

function logProgress(done: number, total: number, label: string) {
    const pct = Math.floor((done / Math.max(1, total)) * 100)
    log.info(`[progress] ${label} ${done}/${total} (${pct}%)`)
}
