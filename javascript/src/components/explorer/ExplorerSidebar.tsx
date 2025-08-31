"use client"

import { useEffect, useState } from "react"

type Bucket = { key: string; doc_count: number }

export default function ExplorerSidebar() {
    const [items, setItems] = useState<Bucket[]>([])
    const [after, setAfter] = useState<any>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    // always use labels; no index selector
    const [field, setField] = useState<"generic" | "substance">("generic")
    // Always group by first alpha token

    // Build a group key by splitting on non-alphanumerics and picking
    // the first token that starts with a letter; fallback to first token.
    function groupKeyFromLabel(label: string): string {
        const s = String(label || "").toUpperCase()
        const tokens = s.split(/[^A-Z0-9]+/).filter(Boolean)
        const firstAlpha = tokens.find(t => /^[A-Z]/.test(t))
        return firstAlpha || tokens[0] || ""
    }

    async function fetchAll(fld: "generic" | "substance") {
        setLoading(true)
        setError(null)
        setItems([])
        setAfter(null)
        let nextAfter: any = undefined
        let merged: Bucket[] = []
        let page = 0
        const seen = new Set<string>()
        let canceled = false
        try {
            // cancellation guard if field changes/unmounts
            const abort = { value: false }
            // attach to closure for cleanup
            ;(fetchAll as any)._abort = abort
            do {
                const params = new URLSearchParams()
                params.set("size", "100")
                params.set("field", fld)
                if (nextAfter) params.set("after", JSON.stringify(nextAfter))
                const res = await fetch(`/api/explorer/generics?${params.toString()}`)
                if (!res.ok) throw new Error(`HTTP ${res.status}`)
                const data = await res.json()
                merged = merged.concat(data.buckets as Bucket[])
                const ak = data.afterKey || null
                if (ak) {
                    const key = JSON.stringify(ak)
                    if (seen.has(key)) break // prevent loops
                    seen.add(key)
                }
                nextAfter = ak
                page++
                if ((fetchAll as any)._abort?.value) { canceled = true; break }
            } while (nextAfter && page < 100)

            if (!canceled) {
                merged.sort((a, b) => {
                    const aw = groupKeyFromLabel(a.key)
                    const bw = groupKeyFromLabel(b.key)
                    return aw.localeCompare(bw, undefined, { sensitivity: "base" })
                })
                setItems(merged)
                setAfter(null)
            }
        } catch (e: any) {
            if (!canceled) setError(String(e?.message || e))
        } finally {
            if (!canceled) setLoading(false)
        }
    }

    useEffect(() => {
    // cancel any in-flight loop
    if ((fetchAll as any)._abort) (fetchAll as any)._abort.value = true
    fetchAll(field)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [field])

    return (
    <aside className="sticky top-20 h-[calc(100vh-6rem)] overflow-auto border-r border-gray-200 pr-3 dark:border-gray-800" style={{ scrollbarGutter: 'stable' }}>
            <div className="mb-1 flex items-center justify-between px-3">
                <div className="text-[10px] uppercase tracking-wide text-gray-600 dark:text-gray-400">Drug label explorer</div>
                <select
                    className="rounded border border-gray-300 bg-white px-1 py-0.5 text-[11px] text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                    value={field}
                    onChange={(e) => setField(e.target.value as any)}
                    title="Field"
                >
                    <option value="generic">generic_name</option>
                    <option value="substance">substance_name</option>
                </select>
            </div>
            {/* always grouped */}
            {error && (
                <div className="mx-3 mb-2 rounded border border-rose-200 bg-rose-50 p-2 text-rose-700 dark:border-rose-900/50 dark:bg-rose-900/20 dark:text-rose-300">
                    {error}
                </div>
            )}
            {!loading && !error && items.length === 0 && (
                <div className="mx-3 mb-2 rounded border border-dashed border-gray-300 p-2 text-[11px] text-gray-600 dark:border-gray-700 dark:text-gray-300">
                    No results. Please verify indexing completed for labels.
                </div>
            )}
            <ul className="space-y-1 px-3 text-xs">
                {Object.entries(
                    items.reduce((acc: Record<string, number>, b) => {
                        const k = groupKeyFromLabel(b.key)
                        acc[k] = (acc[k] || 0) + b.doc_count
                        return acc
                    }, {})
                )
                    // sort by count desc, tie-break by key asc
                    .sort(([ka, ca], [kb, cb]) => (cb as number) - (ca as number) || (ka as string).localeCompare(kb as string))
                    .map(([k, count]) => (
                        <li key={k} className="flex items-center justify-between">
                            <span className="truncate" title={k}>{k}</span>
                            <span className="ml-2 shrink-0 rounded border border-gray-300 bg-white px-1 py-0 text-[10px] leading-5 text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
                                {count as number}
                            </span>
                        </li>
                    ))}
            </ul>
            {/* Auto-loads all pages; no manual pager */}
        </aside>
    )
}
