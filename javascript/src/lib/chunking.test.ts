import { readFileSync } from "node:fs"
import { describe, it, expect } from "vitest"
import {
    chunkSections,
    ALLOWLIST,
    embeddingTextForChunk,
} from "./chunking.js"

type Doc = Record<string, unknown>

function loadSample(): Doc {
    const url = new URL("../../../samples/boxed_warning_sample.json", import.meta.url)
    const json = JSON.parse(readFileSync(url, "utf-8"))
    return (json.results?.[0] as Doc) ?? {}
}

function textFor(val: unknown): string {
    if (typeof val === "string") return val
    if (Array.isArray(val) && val.every(x => typeof x === "string")) {
        return (val as string[]).join("\n\n")
    }
    return ""
}

describe("chunkSections", () => {
    const doc = loadSample()

    it("chunks all present allowlisted sections (non-tables) in the sample", async () => {
        const chunks = await chunkSections(doc)
        const sections = new Set(chunks.map(c => c.section))

        const expected = Object.entries(doc)
            .map(([k, v]) => [k, textFor(v)] as const)
            .filter(([k, txt]) =>
                ALLOWLIST.has(k) &&
                !k.endsWith("_table")
            )
            .map(([k]) => k)

        expect(expected.length).toBeGreaterThan(0)
        for (const k of expected) {
            expect(sections.has(k)).toBe(true)
        }

        // metadata must not be chunked
        for (const m of ["id", "set_id", "effective_time", "version", "openfda"]) {
            expect(sections.has(m)).toBe(false)
        }

        // tables excluded by default
        const tableKeys = Object.keys(doc).filter(k => k.endsWith("_table"))
        for (const t of tableKeys) {
            expect(sections.has(t)).toBe(false)
        }
    })

    it("includes *_table sections when includeTables=true", async () => {
        const chunks = await chunkSections(doc, { includeTables: true })
        const sections = new Set(chunks.map(c => c.section))
        const tableKeys = Object.keys(doc).filter(k => k.endsWith("_table"))
        // Only assert if tables exist in this sample
        if (tableKeys.length > 0) {
            expect(tableKeys.some(k => sections.has(k))).toBe(true)
        }
    })

    it("embeddingTextForChunk prefixes humanized section name only for embeddings (no tags)", () => {
        const text = "Sample content"
        const out = embeddingTextForChunk(text, {
            section: "pediatric_use",
            chunk_seq: 1,
            chunk_total: 1,
            is_first: true,
            is_last: true,
        })
        expect(out).toBe("[] [Section: Pediatric Use] Sample content")
    })

    it("embeddingTextForChunk includes optional tags before the section", () => {
        const text = "do not exceed dose"
        const out = embeddingTextForChunk(text, {
            section: "warnings",
            chunk_seq: 1,
            chunk_total: 1,
            is_first: true,
            is_last: true,
        }, ["Drug: ibuprofen", "Route: oral"])
        expect(out).toBe("[Drug: ibuprofen] [Route: oral] [Section: Warnings] do not exceed dose")
    })

    it("chunkSections keeps stored chunk text verbatim (no embedding prefix)", async () => {
        const chunks = await chunkSections({ pediatric_use: "Sample content" })
        expect(chunks.length).toBe(1)
    const first = chunks[0]!
    expect(first.section).toBe("pediatric_use")
    expect(first.text).toBe("Sample content")
    })
})
