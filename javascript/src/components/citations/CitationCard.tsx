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
    set_id?: string
    label_id?: string
    chunk_id?: string
    openfda?: {
      brand_name?: string[]
      manufacturer_name?: string[]
      route?: string[]
      generic_name?: string[]
      product_ndc?: string[]
      application_number?: string[]
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
  const date = src.effective_time_date || src.effective_time
  const text = src.text ?? ""

  const [expanded, setExpanded] = React.useState(false)
  const maxChars = 300
  const isTruncated = text.length > maxChars
  const shown = expanded ? text : (isTruncated ? text.slice(0, maxChars) + "…" : text)

  function copyExcerpt() {
    if (text) navigator.clipboard?.writeText(text).catch(() => {})
  }

  return (
    <article className="rounded-xl border bg-white shadow-sm p-4 space-y-3">
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold">{brand}</h3>
        {mfg && <span className="text-xs text-gray-600">• {mfg}</span>}
        {route && <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">{route}</span>}
      </header>

      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gray-100">
          <span className="font-medium">{section}</span>
        </span>
        {date && <span className="px-2 py-0.5 rounded bg-gray-50">Effective {date}</span>}
      </div>

      <div className="rounded-lg border bg-gray-50">
        <div className="px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap">
          {shown}
        </div>
        <div className="flex items-center justify-between px-3 py-2">
          <div className="flex gap-2">
            {isTruncated && (
              <button
                className="text-xs text-blue-600 hover:underline"
                onClick={() => setExpanded(v => !v)}
                aria-expanded={expanded}
              >
                {expanded ? "Show less" : "Show more"}
              </button>
            )}
            <button className="text-xs text-gray-600 hover:underline" onClick={copyExcerpt}>
              Copy excerpt
            </button>
          </div>
        </div>
      </div>
    </article>
  )
}