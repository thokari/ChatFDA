#!/usr/bin/env ts-node
import "dotenv/config"
import fs from "node:fs/promises"
import { retrieveWithInfo } from "../lib/retriever.js"
import type { RetrieveOptions } from "../lib/retriever.js"
import { osClientFromEnv } from "../lib/os-client.js"

function getArg(args: string[], flag: string) {
    const i = args.indexOf(flag)
    return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined
}

function hasFlag(args: string[], flag: string) {
    return args.includes(flag)
}

async function main() {
    const tMain0 = Date.now()
    const args = process.argv.slice(2)
    if (args.length === 0) {
        console.error("Usage: scripts/retrieve.ts <query> [--topK 20] [--route ORAL] [--ingredient CLOZAPINE] [--strategy knn|knn_query|script|text|auto] [--noHighlight] [--maxPerLabel 1] [--index drug-chunks] [--qvec /path/to/vector.json] [--diag]")
        process.exit(1)
    }
    const [query] = args as [string, ...string[]]
    const topK = parseInt(getArg(args, "--topK") ?? "20", 10)
    const strategy = (getArg(args, "--strategy") ?? "auto") as any
    const index = getArg(args, "--index") ?? (process.env.INDEX_CHUNKS || "drug-chunks")
    const highlight = !hasFlag(args, "--noHighlight")
    const diag = hasFlag(args, "--diag")

    const filter: Record<string, string> = {}
    const route = getArg(args, "--route")
    const ingredient = getArg(args, "--ingredient")
    if (route) filter["openfda.route"] = route
    if (ingredient) filter["openfda.substance_name"] = ingredient

    // Optional: provide a precomputed query vector to skip embedding (timing/debug)
    let queryVector: number[] | undefined
    const qvecPath = getArg(args, "--qvec")
    if (qvecPath) {
        const raw = await fs.readFile(qvecPath, "utf-8")
        const parsed = JSON.parse(raw)
        queryVector = Array.isArray(parsed?.vector) ? parsed.vector
            : (Array.isArray(parsed) ? parsed : undefined)
        if (!Array.isArray(queryVector)) {
            throw new Error(`--qvec ${qvecPath}: expected a JSON array or { "vector": [...] }`)
        }
    }

    const tCall0 = Date.now()
    const opts: RetrieveOptions = { topK, filter, highlight, strategy, index }
    if (queryVector) opts.queryVector = queryVector
    const { hits, strategy: used } = await retrieveWithInfo(query, opts)
    const callMs = Date.now() - tCall0
    console.log(`Strategy used: ${used}  hits=${hits.length}`)
    if (hits.length === 0) {
        try {
            const os = osClientFromEnv()
            // Count docs matching just the filters (to validate field/values)
            const filterOnly = Object.entries(filter).map(([k, v]) => ({ term: { [k]: v } }))
            const countRes = await os.count({
                index,
                body: { query: { bool: { filter: filterOnly } } }
            } as any)
            const count = (countRes as any).body?.count ?? (countRes as any).count
            console.log(`Filter-only match count: ${count}`)
            if ((count ?? 0) === 0 || diag) {
                // Run quick diagnostics to show what values are present
                const aggRes = await os.search({
                    index,
                    body: {
                        size: 0,
                        aggs: {
                            routes: { terms: { field: "openfda.route", size: 20 } },
                            subs: { terms: { field: "openfda.substance_name", size: 20 } },
                            has_route: { filter: { exists: { field: "openfda.route" } } },
                            has_sub: { filter: { exists: { field: "openfda.substance_name" } } },
                        }
                    }
                } as any)
                const aggBody = (aggRes as any).body ?? aggRes
                console.log("Diag aggregations:", JSON.stringify({
                    routes: aggBody.aggregations?.routes?.buckets,
                    subs: aggBody.aggregations?.subs?.buckets,
                    exists: {
                        route: aggBody.aggregations?.has_route?.doc_count,
                        substance_name: aggBody.aggregations?.has_sub?.doc_count,
                    }
                }, null, 2))
            }
        } catch (e) {
            // ignore diag failures
        }
    }

    for (const h of hits) {
        const s = h._source
        const hl = h.highlight?.text?.join(" … ")
        console.log(JSON.stringify({
            id: h._id,
            score: Number(h._score?.toFixed?.(3) ?? h._score),
            section: s.section,
            label_id: s.label_id,
            snippet: (hl && hl.length > 0) ? hl.slice(0, 800) : (s.text?.slice(0, 800) ?? "")
        }, null, 2))
    }

    if (process.env.DEBUG_RETRIEVER === "1") {
        const totalMs = Date.now() - tMain0
        console.error(`[retrieve.ts] retrieverMs=${callMs}ms totalMs=${totalMs}ms`)
    }
}

main().catch(err => {
    try {
        const anyErr: any = err
        if (anyErr?.body) {
            console.error("OpenSearch error:", JSON.stringify(anyErr.body, null, 2))
        } else if (anyErr?.response?.data) {
            console.error("HTTP error:", JSON.stringify(anyErr.response.data, null, 2))
        } else if (anyErr?.stack) {
            console.error(anyErr.stack)
        } else {
            console.error(JSON.stringify(anyErr, null, 2))
        }
    } catch {
        console.error(String(err))
    }
    process.exit(1)
})