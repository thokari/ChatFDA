import { RecursiveCharacterTextSplitter } from "langchain/text_splitter"

// Tunables
export const DEFAULT_MIN_SECTION_LEN = 120 // ignore very short fields
export const DEFAULT_INCLUDE_TABLES = false
export const CHUNK_SIZE = 2000
export const CHUNK_OVERLAP = 200

// Curated allowlist of common prose sections (extend as needed)
export const ALLOWLIST = new Set<string>([
    "boxed_warning",
    "warnings", "warnings_and_cautions",
    "contraindications",
    "indications_and_usage",
    "dosage_and_administration", "dosage_forms_and_strengths",
    "adverse_reactions",
    "precautions", "general_precautions",
    "drug_interactions",
    "use_in_specific_populations", "pregnancy", "pediatric_use", "geriatric_use", "nursing_mothers",
    "clinical_pharmacology", "mechanism_of_action", "pharmacodynamics", "pharmacokinetics",
    "overdosage",
    "clinical_studies",
    "how_supplied", "storage_and_handling",
    "information_for_patients", "patient_medication_information", "spl_medguide", "instructions_for_use",
    "description", "purpose", "spl_unclassified_section"
])

// Optional excludes (non-prose metadata)
export const EXCLUDE = new Set<string>([
    "id", "set_id", "effective_time", "version", "openfda",
    "spl_id", "spl_set_id", "product_ndc", "package_ndc", "upc", "unii",
    "is_original_packager", "product_type", "route", "active_ingredient", "inactive_ingredient",
])

const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP,
})

export type ChunkSectionsOptions = {
    includeTables?: boolean
    minSectionLen?: number
    extraAllow?: string[]
    extraBlock?: string[]
}

export type ChunkMeta = {
    section: string
    chunk_seq: number
    chunk_total: number
    is_first?: boolean
    is_last?: boolean
}

export type StoredChunk = {
    text: string               // verbatim
    section: string            // e.g., "dosage_and_administration"
    display_name?: string
    effective_time?: string
    effective_time_num?: number
    chunk_seq: number
    chunk_total: number
    is_first: boolean
    is_last: boolean
}

function isStringArray(a: unknown[]): a is string[] {
    return a.every(x => typeof x === "string")
}

function fieldText(val: unknown): string {
    if (typeof val === "string") return val
    if (Array.isArray(val) && isStringArray(val)) return val.join("\n\n")
    return ""
}

function shouldIncludeField(name: string, text: string, opts: Required<ChunkSectionsOptions>): boolean {
    if (EXCLUDE.has(name)) return false
    if (!opts.includeTables && name.endsWith("_table")) return false
    if (opts.extraBlock.includes(name)) return false
    if (opts.extraAllow.includes(name)) return text.length >= opts.minSectionLen
    if (ALLOWLIST.has(name)) return text.length >= opts.minSectionLen
    // Fallback for unexpected prose sections
    return text.length >= opts.minSectionLen
}

export async function chunkSections(
    doc: Record<string, any>,
    options: ChunkSectionsOptions = {}
) {
    const opts: Required<ChunkSectionsOptions> = {
        includeTables: options.includeTables ?? DEFAULT_INCLUDE_TABLES,
        minSectionLen: options.minSectionLen ?? DEFAULT_MIN_SECTION_LEN,
        extraAllow: options.extraAllow ?? [],
        extraBlock: options.extraBlock ?? [],
    }

    const out: Array<{ section: string; text: string; idx: number; chunk_seq: number; chunk_total: number; is_first: boolean; is_last: boolean }> = []

    for (const [name, val] of Object.entries(doc)) {
        const text = fieldText(val)
        if (!text) continue
        if (!shouldIncludeField(name, text, opts)) continue

    // Preserve verbatim content from API for both storage and embedding
    const preserved = text
    if (preserved.length < opts.minSectionLen) continue

    const chunks = await splitter.splitText(preserved)
    const total = chunks.length
    chunks.forEach((c, i) => out.push({ section: name, text: c, idx: i, chunk_seq: i + 1, chunk_total: total, is_first: i === 0, is_last: i === total - 1 }))
    }

    return out
}

/**
 * Embedding-only prefix for section; stored text stays verbatim.
 */
export function embeddingTextForChunk(text: string, meta: ChunkMeta) {
    const sec = humanizeSection(meta.section)
    return `[Section: ${sec}] ${text}`
}

export function humanizeSection(section?: string): string {
    return (section ?? "").replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase())
}
