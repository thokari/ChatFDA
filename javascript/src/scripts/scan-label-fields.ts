// This script scans drug label documents from the open FDA API
// to find fields that often contain long text that looks like prose.

// Run with: node --loader ts-node/esm scripts/scan-label-fields.ts
const EXCLUDE_TOP = new Set([
    "id", "set_id", "effective_time", "version", "openfda", "spl_id", "spl_set_id",
    "upc", "package_ndc", "product_ndc", "is_original_packager", "unii", "product_type", "route"
])
const EXCLUDE_PREFIXES = ["openfda"] // skip nested under these
const MIN_LEN = 50
const MIN_FREQ = 10

type Tally = { count: number; totalLen: number }
const fields = new Map<string, Tally>()

function isStringArray(a: unknown[]): a is string[] {
    return a.every(x => typeof x === "string")
}

function joinStrings(v: unknown, p: string): string {
    if (typeof v === "string") return v
    if (Array.isArray(v) && isStringArray(v)) {
        if (v.length > 1) {
            console.log(`  [${p}]: array of ${v.length} strings`)
        }
        return v.join("\n\n")
    }
    return ""
}

function looksLikeProse(text: string): boolean {
    if (text.length < MIN_LEN) return false
    const letters = (text.match(/[A-Za-z]/g) ?? []).length
    const spaces = (text.match(/\s/g) ?? []).length
    const ratio = letters / Math.max(1, text.length)
    return spaces > 0 && ratio > 0.4
}

function consider(path: string, text: string) {
    if (!looksLikeProse(text)) return
    const t = fields.get(path) ?? { count: 0, totalLen: 0 }
    t.count += 1
    t.totalLen += text.length
    fields.set(path, t)
}

function shouldSkipPath(path: string): boolean {
    if (EXCLUDE_TOP.has(path)) return true
    return EXCLUDE_PREFIXES.some(p => path === p || path.startsWith(p + "."))
}

function walk(node: any, path = ""): void {
    if (node == null) return
    if (shouldSkipPath(path)) return

    // 1) Strings
    if (typeof node === "string") {
        const text = node
        if (text) consider(path, text)
        return
    }

    // 2) Arrays
    if (Array.isArray(node)) {
        if (isStringArray(node)) {
            const text = joinStrings(node, path)
            if (text) consider(path, text)
            return
        }
        // Array of objects or mixed: recurse into items (same path)
        for (const item of node) walk(item, path)
        return
    }

    // 3) Plain object: recurse into keys
    if (typeof node === "object") {
        for (const [k, v] of Object.entries(node)) {
            const childPath = path ? `${path}.${k}` : k
            if (!path && EXCLUDE_TOP.has(k)) continue
            walk(v, childPath)
        }
        return
    }
}

async function fetchPage(skip: number, limit = 100) {
    const url = new URL("https://api.fda.gov/drug/label.json")
    url.searchParams.set("limit", String(limit))
    url.searchParams.set("skip", String(skip))
    const res = await fetch(url.toString())
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json() as Promise<{ results?: any[] }>
}

; (async () => {
    const pages = 20 // ~2000 docs
    let skip = 0
    for (let i = 0; i < pages; i++) {
        const data = await fetchPage(skip)
        const results = data.results ?? []
        for (const r of results) walk(r)
        skip += results.length
        if (results.length === 0) break
        console.log(`Scanned ${skip} docs`)
    }

    const out = [...fields.entries()]
        .map(([field, t]) => ({ field, freq: t.count, avgLen: Math.round(t.totalLen / t.count) }))
        .filter(x => x.freq >= MIN_FREQ)
        .sort((a, b) => b.freq - a.freq)

    const nested = out.filter(x => x.field.includes("."))
    const topLevel = out.filter(x => !x.field.includes("."))
    console.log("Top-level fields:", topLevel.length, "Nested fields:", nested.length)
    // Optionally print top 10 nested
    console.log("Nested sample:", JSON.stringify(nested.slice(0, 10), null, 2))
    console.log(JSON.stringify(out, null, 2))
})()