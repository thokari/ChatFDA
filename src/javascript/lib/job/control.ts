import type { OsLike } from "../types.js"

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
        // @ts-ignore
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
    console.log(`Created job ${jobId}`)
    return body
}

export async function updateJob(os: OsLike, jobId: string, partial: Partial<JobDoc>) {
    await os.update({ index: "ingest-jobs", id: jobId, body: { doc: partial }, refresh: "true" })
    console.log(`Updated ${jobId}`)
}

export async function setStatus(os: OsLike, jobId: string, status: JobStatus) {
    await updateJob(os, jobId, { status, last_heartbeat: new Date().toISOString() })
    await logEvent(os, jobId, "INFO", "JOB", `Status -> ${status}`)
    console.log(`Job ${jobId} status set to ${status}`)
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
}

export function makeJobId(p: JobParams) {
    const d = new Date().toISOString().slice(0, 10)
    const ing = (p.ingredient || "all").toLowerCase()
    const route = (p.route || "ALL").toUpperCase()
    const since = p.updatedSince ? `_${p.updatedSince}` : ""
    return `job_${d}_${ing}_${route}${since}_L${p.limit}`
}
