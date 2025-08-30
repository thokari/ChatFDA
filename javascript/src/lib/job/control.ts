import type { OsLike } from "../types.js"
import { readFileSync } from "node:fs"
import { resolve as resolvePath } from "node:path"
import { createLogger } from "../../utils/log"

const log = createLogger("control")

export type JobStatus = "PENDING" | "RUNNING" | "PAUSED" | "FAILED" | "COMPLETED"

export interface JobParams {
    ingredient?: string
    route?: string
    updatedSince?: string // YYYYMMDD
    limit: number         // 1..1000
    total_expected?: number
}

// Job documents (maps to opensearch/ingest-jobs.json)
export interface JobDoc {
    job_id: string
    created_at: string
    params: JobParams
    status: JobStatus
    last_heartbeat: string
    cursor: { skip: number }
    counters: {
        labels_seen: number
        chunks_considered: number
        chunks_embedded: number
        errors: number
    }
}

// Event documents (maps to opensearch/ingest-events.json)
export interface EventDoc {
    created_at: string
    job_id: string
    level: "INFO" | "WARN" | "ERROR"
    phase: "JOB" | "FETCH" | "EMBED" | "INDEX" | "OTHER"
    message: string
    // optional extras
    label_id?: string
    chunk_id?: string
    meta?: any
}

export async function getJob(os: OsLike, jobId: string): Promise<JobDoc | null> {
    try {
        const res = await os.get({ index: "ingest-jobs", id: jobId })
        return res.body?._source ?? (res as any)._source ?? null
    } catch (e: any) {
        if (e?.meta?.statusCode === 404) return null
        throw e
    }
}

export async function createJob(os: OsLike, jobId: string, params: JobParams): Promise<JobDoc> {
    const now = new Date().toISOString()
    const body: JobDoc = {
        job_id: jobId,
        created_at: now,
        params,
        cursor: { skip: 0 },
        counters: { labels_seen: 0, chunks_considered: 0, chunks_embedded: 0, errors: 0 },
        status: "RUNNING",
        last_heartbeat: now,
    }
    await os.index({ index: "ingest-jobs", id: jobId, body, refresh: "true" })
    log.info(`Created job ${jobId}`)
    return body
}

export async function updateJob(os: OsLike, jobId: string, partial: Partial<JobDoc>) {
    await os.update({ index: "ingest-jobs", id: jobId, body: { doc: partial }, refresh: "true" })
    log.debug(`Updated ${jobId}`)
}

export async function setStatus(os: OsLike, jobId: string, status: JobStatus) {
    await updateJob(os, jobId, { status, last_heartbeat: new Date().toISOString() })
    await logEvent(os, jobId, "INFO", "JOB", `Status -> ${status}`)
    log.info(`Job ${jobId} status set to ${status}`)
}

export async function heartbeat(os: OsLike, jobId: string) {
    await updateJob(os, jobId, { last_heartbeat: new Date().toISOString() })
}

export async function logEvent(
    os: OsLike,
    jobId: string,
    level: "INFO" | "WARN" | "ERROR",
    phase: "JOB" | "FETCH" | "EMBED" | "INDEX" | "OTHER",
    message: string,
    meta: any = {}
) {
    const doc: EventDoc = {
        created_at: new Date().toISOString(),
        job_id: jobId,
        level,
        phase,
        message,
        meta,
    }
    await os.index({ index: "ingest-events", body: doc, refresh: "false" })
    // keep external log noise minimal; rely on events index
    if (level === "ERROR") log.error(`[event] ${phase} ${message}`)
}

export function makeJobId(p: JobParams) {
    const d = new Date().toISOString().slice(0, 10)
    const ing = (p.ingredient || "all").toLowerCase()
    const route = (p.route || "ALL").toUpperCase()
    const since = p.updatedSince ? `_${p.updatedSince}` : ""
    return `job_${d}_${ing}_${route}${since}_L${p.limit}`
}

export function encOpenFdaValue(v: string): string {
    const trimmed = String(v || "").trim()
    const needsQuotes = /\s/.test(trimmed)
    return encodeURIComponent(needsQuotes ? `"${trimmed}"` : trimmed)
}

export function buildOpenFdaSearch(opts: { ingredient?: string; route?: string; updatedSince?: string }) {
    const parts: string[] = []
    if (opts.ingredient) parts.push(`openfda.substance_name:${encOpenFdaValue(opts.ingredient)}`)
    if (opts.route) parts.push(`openfda.route:${encOpenFdaValue(opts.route)}`)
    if (opts.updatedSince) parts.push(`effective_time:[${encodeURIComponent(opts.updatedSince)}+TO+*]`)
    return parts.join("+AND+")
}

export async function openFdaPreflight(opts: { ingredient: string; route: string; updatedSince?: string }) {
    const search = buildOpenFdaSearch(opts)
    const url = `https://api.fda.gov/drug/label.json?search=${search}&limit=1`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`openFDA preflight failed: HTTP ${res.status}`)
    const json: any = await res.json()
    const total = Number(json?.meta?.results?.total || 0)
    const sampleId: string | undefined = json?.results?.[0]?.id
    return { total, sampleId }
}

export async function preflightTotal(opts: { ingredient: string; route: string; updatedSince?: string }) {
    const { total } = await openFdaPreflight(opts)
    return total
}

export function parseSeedsCsv(filePath: string): Array<{ ingredient: string; route: string }> {
    const abs = resolvePath(process.cwd(), filePath)
    const txt = readFileSync(abs, "utf-8")
    const lines = txt.split(/\r?\n/).filter((l) => l.trim().length > 0)
    if (lines.length === 0) return []
    const header = lines[0]!.split(",").map((h) => h.trim().toLowerCase())
    const idxIng = header.indexOf("ingredient")
    const idxRoute = header.indexOf("route")
    if (idxIng === -1 || idxRoute === -1) {
        throw new Error(`CSV must have "ingredient,route" header: ${filePath}`)
    }
    const rows: Array<{ ingredient: string; route: string }> = []
    if (lines.length < 1) {
        throw new Error(`CSV is empty: ${filePath}`)
    }
    for (let i = 1; i < lines.length; i++) {
        const raw = lines[i]!.trim()
        if (!raw || raw.startsWith("#")) continue
        const cols = raw.split(",")
        const ingredient = (cols[idxIng] || "").trim()
        const route = (cols[idxRoute] || "").trim()
        if (ingredient && route) rows.push({ ingredient, route })
    }
    return rows
}

export async function ensureJob(os: OsLike, params: JobParams): Promise<{ jobId: string; existed: boolean }> {
    const jobId = makeJobId(params)
    const existing = await getJob(os, jobId)
    if (existing) {
        await setStatus(os, jobId, "RUNNING")
        return { jobId, existed: true }
    } else {
        await createJob(os, jobId, params)
        await logEvent(os, jobId, "INFO", "JOB", "Started", params)
        return { jobId, existed: false }
    }
}
