import { RecursiveCharacterTextSplitter } from "langchain/text_splitter"

// Tunables
export const DEFAULT_MIN_SECTION_LEN = 120 // ignore very short fields
export const DEFAULT_INCLUDE_TABLES = false

// Curated allowlist of common prose sections (extend as needed)
export const ALLOWLIST = new Set<string>([
  "boxed_warning",
  "warnings","warnings_and_cautions",
  "contraindications",
  "indications_and_usage",
  "dosage_and_administration","dosage_forms_and_strengths",
  "adverse_reactions",
  "precautions","general_precautions",
  "drug_interactions",
  "use_in_specific_populations","pregnancy","pediatric_use","geriatric_use","nursing_mothers",
  "clinical_pharmacology","mechanism_of_action","pharmacodynamics","pharmacokinetics",
  "overdosage",
  "clinical_studies",
  "how_supplied","storage_and_handling",
  "information_for_patients","patient_medication_information","spl_medguide","instructions_for_use",
  "description","purpose","spl_unclassified_section"
])

// Optional excludes (non-prose metadata)
export const EXCLUDE = new Set<string>([
  "id","set_id","effective_time","version","openfda",
  "spl_id","spl_set_id","product_ndc","package_ndc","upc","unii",
  "is_original_packager","product_type","route","active_ingredient","inactive_ingredient",
])

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 800,
  chunkOverlap: 120,
})

export type ChunkSectionsOptions = {
  includeTables?: boolean   // include *_table sections
  minSectionLen?: number    // ignore fields shorter than this after join
  extraAllow?: string[]     // force-include these fields if present
  extraBlock?: string[]     // force-exclude these fields
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
  // Heuristic fallback for unexpected prose sections
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

  const out: Array<{ section: string; text: string; idx: number }> = []

  for (const [name, val] of Object.entries(doc)) {
    const text = fieldText(val)
    if (!text) continue
    if (!shouldIncludeField(name, text, opts)) continue

    // Normalize a bit
    const normalized = text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim()
    if (normalized.length < opts.minSectionLen) continue

    const chunks = await splitter.splitText(normalized)
    chunks.forEach((c, i) => out.push({ section: name, text: c, idx: i }))
  }

  return out
}
