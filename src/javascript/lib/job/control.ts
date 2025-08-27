import { Client } from "@opensearch-project/opensearch"

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

export function osClientFromEnv(): Client {
    const node = process.env.OS_HOST || "https://localhost:9200"
    const username = process.env.OS_USER || "admin"
    const password = process.env.OS_PASS || ""
    return new Client({
        node,
        auth: { username, password },
        ssl: { rejectUnauthorized: false }, // dev only (self-signed)
    })
}

export async function getJob(os: Client, jobId: string): Promise<JobDoc | null> {
    try {
        const res = await os.get({ index: "ingest-jobs", id: jobId })
        // @ts-ignore
        return res.body?._source ?? (res as any)._source ?? null
    } catch (e: any) {
        if (e?.meta?.statusCode === 404) return null
        throw e
    }
}

export async function createJob(os: Client, jobId: string, params: JobParams): Promise<JobDoc> {
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

export async function updateJob(os: Client, jobId: string, partial: Partial<JobDoc>) {
    await os.update({ index: "ingest-jobs", id: jobId, body: { doc: partial }, refresh: "true" })
    console.log(`Updated ${jobId}`)
}

export async function setStatus(os: Client, jobId: string, status: JobStatus) {
    await updateJob(os, jobId, { status, last_heartbeat: new Date().toISOString() })
    await logEvent(os, jobId, "INFO", "JOB", `Status -> ${status}`)
    console.log(`Job ${jobId} status set to ${status}`)
}

export async function heartbeat(os: Client, jobId: string) {
    await updateJob(os, jobId, { last_heartbeat: new Date().toISOString() })
}

export async function logEvent(
    os: Client,
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
