import pRetry, { AbortError } from "p-retry"
import { createLogger } from "../utils/log"

const log = createLogger("fda")

export interface FdaSearchOpts {
    ingredient?: string    // openfda.generic_name or substance_name
    route?: string         // e.g. ORAL
    limit: number          // 1..1000
    skip: number           // 0, 1*limit, 2*limit, ...
    updatedSince?: string  // YYYYMMDD
    timeoutMs?: number     // default 15000
    retries?: number       // default 3
}

export interface FdaPage<T = any> {
    results: T[]
    total: number            // from meta.results.total (if provided)
    skip: number             // from meta.results.skip (or echo of input)
    limit: number            // effective limit
    nextSkip: number | null  // null when done
    rawMeta?: any
}

export async function fetchFdaLabels(opts: FdaSearchOpts): Promise<FdaPage> {
    const limit = clamp(opts.limit, 1, 1000)
    const skip = Math.max(0, opts.skip)
    const url = `https://api.fda.gov/drug/label.json?${buildQuery({
        limit,
        skip,
        ...(opts.ingredient ? { ingredient: opts.ingredient } : {}),
        ...(opts.route ? { route: opts.route } : {}),
        ...(opts.updatedSince ? { updatedSince: opts.updatedSince } : {}),
    })}`

    const url_pretty = prettyUrl(url)
    const search_pretty = urlSearch(url)

    log.debug("request", {
        url,
        url_pretty,
        search: search_pretty,
        ingredient: opts.ingredient,
        route: opts.route,
        limit,
        skip,
        updatedSince: opts.updatedSince
    })

    const payload = await fetchJsonWithRetry(url, {
        timeoutMs: opts.timeoutMs ?? 15_000,
        retries: opts.retries ?? 3,
    })

    const results = (payload?.results ?? []) as any[]
    const meta = payload?.meta?.results ?? {}
    const total = Number(meta.total ?? 0)

    const parsedSkip = Number(meta.skip)
    const reportedSkip = Number.isFinite(parsedSkip) ? parsedSkip : skip

    const nextSkip = results.length < limit ? null : reportedSkip + limit

    log.debug("response", { total, reportedSkip, count: results.length, nextSkip })

    return {
        results,
        total,
        skip: reportedSkip,
        limit,
        nextSkip,
        rawMeta: payload?.meta,
    }
}

function buildQuery(o: { ingredient?: string, route?: string, updatedSince?: string, limit: number, skip: number }): string {
    const terms: string[] = []
    if (o.ingredient) {
        const q = `"${o.ingredient}"` // quote to handle spaces
        terms.push(`(openfda.generic_name:${q} OR openfda.substance_name:${q})`)
    }
    if (o.route) terms.push(`openfda.route:"${o.route}"`)
    if (o.updatedSince) terms.push(`effective_time:[${o.updatedSince} TO *]`)

    const params = new URLSearchParams()
    if (terms.length) params.set("search", terms.join(" AND "))
    params.set("limit", String(o.limit))
    params.set("skip", String(o.skip))
    params.set("sort", "effective_time:desc")
    return params.toString()
}

async function fetchJsonWithRetry(url: string, opts: { timeoutMs: number, retries: number }) {
    const { timeoutMs, retries } = opts

    return pRetry(async () => {
        const ac = new AbortController()
        const to = setTimeout(() => ac.abort(), timeoutMs)
        try {
            const res = await fetch(url, { signal: ac.signal })
            if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
                const retryAfter = res.headers.get("retry-after")
                const meta = { url, url_pretty: prettyUrl(url), search: urlSearch(url), status: res.status }
                if (retryAfter) {
                    const seconds = Number(retryAfter)
                    if (Number.isFinite(seconds) && seconds > 0) {
                        log.warn("retry-after", { ...meta, seconds })
                        await delay(seconds * 1000)
                    }
                } else {
                    log.warn("retryable", meta)
                }
                throw new Error(`Retryable HTTP ${res.status}`)
            }
            if (!res.ok) {
                const text = await res.text().catch(() => "")
                const body = text.slice(0, 500)
                log.error("http_error", { url_pretty: prettyUrl(url), search: urlSearch(url), status: res.status, body })
                throw new AbortError(`HTTP ${res.status}: ${body}`)
            }
            return await res.json()
        } catch (err: any) {
            log.warn("network_error", { url_pretty: prettyUrl(url), search: urlSearch(url), error: String(err?.message || err) })
            throw err
        } finally {
            clearTimeout(to)
        }
    }, { retries })
}

function prettyUrl(u: string): string {
    try { return decodeURI(u) } catch { return u }
}

function urlSearch(u: string): string | undefined {
    try {
        const qs = new URL(u).searchParams.get("search")
        if (!qs) return undefined
        // Ensure spaces are shown (decode + convert '+')
        return decodeURIComponent(qs).replace(/\+/g, " ")
    } catch {
        return undefined
    }
}

function delay(ms: number) {
    return new Promise((r) => setTimeout(r, ms))
}

function clamp(n: number, min: number, max: number) {
    return Math.max(min, Math.min(max, n))
}
