import React from "react"
import { CitationCard, type CitationHit } from "./CitationCard"

export function CitationList({ hits }: { hits: CitationHit[] }) {
  if (!hits?.length) return null
  return (
    <div className="mt-2 grid grid-cols-1 lg:grid-cols-2 gap-4">
      {hits.map((h, i) => (
        <CitationCard key={h._id || h._source?.chunk_id || i} hit={h} />
      ))}
    </div>
  )
}