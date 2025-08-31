import { NextRequest, NextResponse } from "next/server"
import { osClientFromEnv } from "@/lib/os-client"

// GET /api/explorer/generics?size=100&after={...}
export async function GET(req: NextRequest) {
    const client = osClientFromEnv()
    const { searchParams } = new URL(req.url)
    const size = Math.max(1, Math.min(500, Number(searchParams.get("size")) || 100))
    const fieldParam = (searchParams.get("field") || "generic").toLowerCase()
    const labelsIndex = process.env.INDEX_LABELS || "drug-labels"

    type AggBucket = { key: { generic_name: string }, doc_count: number }
    type AggResult = {
        index: string
        size: number
        buckets: AggBucket[]
        afterKey: any
        totalHits: number | null
        kind: "composite" | "terms"
    }

    let after: any = undefined
    const afterParam = searchParams.get("after")
    if (afterParam) {
        try {
            after = JSON.parse(afterParam)
        } catch (_) {
            // ignore invalid after; treat as first page
        }
    }

    const field = fieldParam === "substance" ? "openfda.substance_name" : "openfda.generic_name"

    async function runComposite(index: string): Promise<AggResult> {
        const body: any = {
            size: 0,
            aggs: {
                generic_names: {
                    composite: {
                        size,
                        sources: [
                            {
                                generic_name: {
                                    terms: { field },
                                },
                            },
                        ],
                    },
                },
            },
        }
        if (after) body.aggs.generic_names.composite.after = after
    const resp = await client.search({ index, body })
    const raw: any = (resp as any).body ?? resp
    const agg = raw.aggregations?.generic_names
    const buckets: AggBucket[] = (agg?.buckets || []) as AggBucket[]
    const afterKey = agg?.after_key || null
    return { index, size, buckets, afterKey, totalHits: (raw.hits?.total?.value ?? null) as number | null, kind: "composite" as const }
    }

    async function runTerms(index: string): Promise<AggResult> {
        const body: any = {
            size: 0,
            aggs: {
                generic_names: {
                    terms: { field, size },
                },
            },
        }
    const resp = await client.search({ index, body })
    const raw: any = (resp as any).body ?? resp
    const agg = raw.aggregations?.generic_names
        const buckets: AggBucket[] = (agg?.buckets || []).map((b: any) => ({ key: { generic_name: b.key }, doc_count: b.doc_count }))
    return { index, size, buckets, afterKey: null, totalHits: (raw.hits?.total?.value ?? null) as number | null, kind: "terms" as const }
    }

    // Always use labels; try composite first, then terms as fallback on labels only
    let result: AggResult = await runComposite(labelsIndex)
    if (!result.buckets.length) {
        const termsLabels = await runTerms(labelsIndex)
        if (termsLabels.buckets.length) result = termsLabels
    }

    // Diagnostics: how many docs have the field in each index
    async function existsCount(index: string) {
        try {
            const r = await client.count({ index, body: { query: { exists: { field } } } })
            const body: any = (r as any).body ?? r
            return body.count ?? null
        } catch {
            return null
        }
    }
    const diag = { labels: await existsCount(labelsIndex) }

    return NextResponse.json({
    index: result.index,
        size: result.size,
        buckets: result.buckets.map((b: any) => ({ key: b.key.generic_name, doc_count: b.doc_count })),
        afterKey: result.afterKey || null,
    totalHits: result.totalHits,
    aggKind: (result as any).kind,
    diag,
    field,
    })
}
