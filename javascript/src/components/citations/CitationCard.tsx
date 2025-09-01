"use client"
import React from "react"

export type CitationHit = {
    _id: string
    _score?: number
    _source: {
        display_name?: string
        section?: string
        text?: string
        effective_time_date?: string
        effective_time?: string
        label_id?: string
        chunk_id?: string
        openfda?: {
            brand_name?: string[]
            manufacturer_name?: string[]
            route?: string[]
            generic_name?: string[]
            product_ndc?: string[]
            application_number?: string[]
            product_type?: string[]
            substance_name?: string[]
        }
    }
}

function humanizeSection(s?: string) {
    if (!s) return "unknown section"
    return s.replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase())
}

function first(a?: string[]) {
    return Array.isArray(a) && a.length ? a[0] : undefined
}

export function CitationCard({ hit }: { hit: CitationHit }) {
    const src = hit._source ?? {}
    const brand = first(src.openfda?.brand_name) || first(src.openfda?.generic_name) || "Unknown"
    const mfg = first(src.openfda?.manufacturer_name)
    const route = first(src.openfda?.route)
    const section = humanizeSection(src.section)
    const substance = (src.openfda?.substance_name || []).join(", ")
    const date = src.effective_time_date || src.effective_time
    const rawText = src.text ?? ""
    const rxOtc = (() => {
        const pt = first(src.openfda?.product_type)?.toLowerCase() || ""
        if (pt.includes("otc")) return "OTC"
        if (pt.includes("prescription")) return "PRESCRIPTION"
        return undefined
    })()

    const [expanded, setExpanded] = React.useState(false)
    const maxChars = 400
    const isTruncated = rawText.length > maxChars
    const shown = expanded ? rawText : (isTruncated ? rawText.slice(0, maxChars) + "…" : rawText)

    function copyExcerpt() {
        if (rawText) navigator.clipboard?.writeText(rawText).catch(() => { })
    }

    return (
        <article className="rounded-lg border bg-white shadow-sm p-3 space-y-2">
            <header className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-sky-900">{brand}</h3>
                {substance && (
                    <span className="text-[10px] px-2 py-0.5 rounded bg-gray-50 text-gray-700 border border-gray-100">
                        {substance}
                    </span>
                )}
                <div className="ml-auto flex items-center gap-1">
                    {rxOtc && (
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-100">
                            {rxOtc}
                        </span>
                    )}
                    {route && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                            {route}
                        </span>
                    )}
                </div>
            </header>

            <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-sky-50 text-sky-800 text-[11px]">
                    <span className="font-medium">{section}</span>
                </span>
                {date && (
                    <span className="text-[10px] px-2 py-0.5 rounded bg-gray-50 text-gray-700 border border-gray-100">
                        {date}
                    </span>
                )}
                {mfg && (
                    <span className="text-[10px] px-2 py-0.5 rounded bg-gray-50 text-gray-700 border border-gray-100">
                        {mfg}
                    </span>
                )}
            </div>

            <div className="text-[13px] leading-relaxed whitespace-pre-wrap text-slate-800 border-l-4 border-sky-200 bg-sky-100/50 px-3 py-2">
                {shown}
            </div>
            <div className="flex items-center gap-3 pl-1">
                {isTruncated && (
                    <button
                        className="text-[11px] text-sky-700 hover:underline"
                        onClick={() => setExpanded(v => !v)}
                        aria-expanded={expanded}
                    >
                        {expanded ? "Show less" : "Show more"}
                    </button>
                )}
                <button className="text-[11px] text-gray-600 hover:underline" onClick={copyExcerpt}>
                    Copy excerpt
                </button>
            </div>
        </article>
    )
}
