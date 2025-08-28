import { readFileSync } from "node:fs"
import { describe, it, expect } from "vitest"
import {
    chunkSections,
    ALLOWLIST,
    DEFAULT_MIN_SECTION_LEN,
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
                !k.endsWith("_table") &&
                txt.length >= DEFAULT_MIN_SECTION_LEN
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
})
