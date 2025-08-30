import { ChatOpenAI } from "@langchain/openai"
import { z } from "zod"
import { fileURLToPath } from "node:url"
import { readFile } from "node:fs/promises"
import type { RetrieveHit } from "../retriever"
import { createLogger } from "../../utils/log"

export type Citation = { chunk_id: string; text: string }

export type SelectorOptions = {
    model?: string
    temperature?: number
    maxCitations?: number // default 3
    maxChars?: number // per quote, default 600
    preferDistinctLabels?: boolean // default true by set_id
}

const log = createLogger("selector")

// Minimal candidate shape we feed to the model (reduce tokens)
type Candidate = { chunk_id: string; set_id?: string; section?: string; text: string }

export async function selectCitations(
    question: string,
    hits: RetrieveHit[],
    opts: SelectorOptions = {}
): Promise<{ citations: Citation[]; used: { model: string; method: "llm" | "fallback" } }> {
    const model = opts.model ?? "gpt-4o-mini"
    const temperature = opts.temperature ?? 0.1
    const maxCitations = clamp(opts.maxCitations ?? 3, 0, 5)
    const maxChars = clamp(opts.maxChars ?? 600, 100, 1200)
    const preferDistinct = opts.preferDistinctLabels ?? true

    const candidates: Candidate[] = hits.map(h => ({
        chunk_id: h._source?.chunk_id ?? h._id,
        set_id: h._source?.set_id ?? h._source?.label_id,
        section: h._source?.section,
        text: String(h._source?.text ?? ""),
    }))

    // Fast exit
    if (!question || candidates.length === 0 || maxCitations === 0) {
        return { citations: [], used: { model, method: "fallback" } }
    }

        try {
            const chat = new ChatOpenAI({ model, temperature })
            // Structured output schema
            const schema = z.object({
                citations: z.array(z.object({
                    chunk_id: z.string(),
                    text: z.string().min(1)
                })).max(maxCitations)
            })
            const structured = (chat as any).withStructuredOutput
                ? (chat as any).withStructuredOutput(schema)
                : null

            const sys = await getSelectorPrompt()
            const userPayload = {
                question,
                constraints: { maxCitations, maxChars, preferDistinct },
                // keep candidate payload lean
                candidates: candidates.map(c => ({ chunk_id: c.chunk_id, set_id: c.set_id, section: c.section, text: c.text }))
            }

            let parsed: any
            if (structured) {
                parsed = await structured.invoke([
                    { role: "system", content: sys },
                    { role: "user", content: JSON.stringify(userPayload) }
                ])
            } else {
                // Fallback to plain invoke and parse
                const res = await chat.invoke([
                    { role: "system", content: sys },
                    { role: "user", content: JSON.stringify(userPayload) }
                ])
                parsed = toPlainJson(res)
            }

            const raw = Array.isArray(parsed?.citations) ? parsed.citations : []
            let cites: Citation[] = []
            for (const it of raw) {
                if (!it || typeof it !== "object") continue
                const chunk_id = String((it as any).chunk_id ?? "").trim()
                let text = String((it as any).text ?? "").trim()
                if (!chunk_id || !text) continue
                if (text.length > maxChars) text = trimToMaxChars(text, maxChars)
                cites.push({ chunk_id, text })
                if (cites.length >= maxCitations) break
            }

            cites = postValidate(cites, candidates, { maxCitations, maxChars, preferDistinct })
            if (log.isDebug()) log.debug("selector.llm", { asked: candidates.length, picked: cites.length })
            return { citations: cites, used: { model, method: "llm" } }
        } catch (err: any) {
        log.warn("selector.fallback", { error: String(err?.message || err) })
        const cites = fallbackSelect(question, candidates, { maxCitations, maxChars, preferDistinct })
        return { citations: cites, used: { model, method: "fallback" } }
    }
}

    // External prompt loader (selector-prompt.md next to this file)
    const selectorPromptPath = fileURLToPath(new URL("./selector-prompt.md", import.meta.url))
    let selectorPromptCache: string | undefined
    async function getSelectorPrompt(): Promise<string> {
        if (selectorPromptCache) return selectorPromptCache
        const text = await readFile(selectorPromptPath, "utf8")
        selectorPromptCache = text
        return text
        
    }

function toPlainJson(res: any): any {
    const content = (res?.content ?? res) as any
    if (typeof content === "string") {
        try { return JSON.parse(content) } catch { return {} }
    }
    if (Array.isArray(content)) {
        const txt = content.map((p: any) => (typeof p === "string" ? p : p?.text ?? "")).join("")
        try { return JSON.parse(txt) } catch { return {} }
    }
    try { return JSON.parse(String(content)) } catch { return {} }
}

function postValidate(cites: Citation[], cands: Candidate[], opts: { maxCitations: number; maxChars: number; preferDistinct: boolean }): Citation[] {
    // Keep only citations that reference existing candidates
    const candById = new Map(cands.map(c => [c.chunk_id, c]))
    const out: Citation[] = []
    const seenSet: Record<string, number> = {}
    for (const c of cites) {
        const src = candById.get(c.chunk_id)
        if (!src) continue
        if (opts.preferDistinct) {
            const sid = src.set_id ?? src.chunk_id
            const n = seenSet[sid] ?? 0
            if (n > 0) continue
            seenSet[sid] = 1
        }
        const text = c.text.length > opts.maxChars ? trimToMaxChars(c.text, opts.maxChars) : c.text
        out.push({ chunk_id: c.chunk_id, text })
        if (out.length >= opts.maxCitations) break
    }
    return out
}

function fallbackSelect(question: string, cands: Candidate[], opts: { maxCitations: number; maxChars: number; preferDistinct: boolean }): Citation[] {
    const out: Citation[] = []
    const seenSet: Record<string, number> = {}
    for (const c of cands) {
        if (opts.preferDistinct) {
            const sid = c.set_id ?? c.chunk_id
            const n = seenSet[sid] ?? 0
            if (n > 0) continue
            seenSet[sid] = 1
        }
        const quote = trimToSentences(c.text, opts.maxChars)
        if (!quote) continue
        out.push({ chunk_id: c.chunk_id, text: quote })
        if (out.length >= opts.maxCitations) break
    }
    return out
}

function trimToSentences(text: string, maxChars: number): string | null {
    const clean = String(text ?? "").trim()
    if (!clean) return null
    if (clean.length <= maxChars) return clean
    // Naive sentence split; keep first 1–3 sentences within limit
    const parts = clean.split(/(?<=[\.\!\?])\s+/)
    const kept: string[] = []
    let total = 0
    for (const s of parts) {
        const add = kept.length === 0 ? s : " " + s
        if (total + add.length > maxChars) break
        kept.push(s)
        total += add.length
    }
    return kept.join(" ") || clean.slice(0, maxChars)
}

function trimToMaxChars(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text
    // Try to cut at sentence boundary before the limit
    const prefix = text.slice(0, maxChars)
    const lastPunct = Math.max(prefix.lastIndexOf("."), prefix.lastIndexOf("!"), prefix.lastIndexOf("?"))
    if (lastPunct > 40) return prefix.slice(0, lastPunct + 1)
    return prefix
}

function clamp(n: number, min: number, max: number) {
    return Math.max(min, Math.min(max, n))
}
