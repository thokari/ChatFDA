import { ChatOpenAI } from "@langchain/openai"
import { z } from "zod"
import { fileURLToPath } from "node:url"
import { readFile } from "node:fs/promises"
import type { RetrieveHit } from "../retriever"
import { createLogger } from "@/utils/log"

export type Citation = {
    chunk_id: string
    section?: string
    text: string
}

export type SelectorOptions = {
    model?: string
    temperature?: number
}

const log = createLogger("selector")

// Minimal candidate shape we feed to the model (reduce tokens)
type Candidate = {
    chunk_id: string
    section?: string
    text: string
}

export async function selectCitations(
    question: string,
    hits: RetrieveHit[],
    opts: SelectorOptions = {}
): Promise<{ citations: Citation[] }> {
    const model = opts.model ?? "gpt-4o-mini"
    const temperature = opts.temperature ?? 0.1
    const candidates: Candidate[] = hits.map(h => ({
        chunk_id: h._source?.chunk_id ?? h._id,
        section: h._source?.section,
        text: String(h._source?.text ?? ""),
    }))

    // Fast exit
    if (!question || candidates.length === 0) {
        return { citations: [] }
    }

    try {
        const chat = new ChatOpenAI({ model, temperature })
        // Structured output schema
        const schema = z.object({
            citations: z.array(z.object({
                chunk_id: z.string(),
                section: z.string().optional(),
                text: z.string().min(1)
            }))
        })
        const structured = (chat as any).withStructuredOutput
            ? (chat as any).withStructuredOutput(schema)
            : null

        const sys = await getSelectorPrompt()
        const userPayload = {
            question,
            // keep candidate payload lean
            candidates: candidates.map(c => ({ chunk_id: c.chunk_id, section: c.section, text: c.text }))
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
            const section = typeof (it as any).section === "string" ? String((it as any).section).trim() : undefined
            const cite: Citation = { chunk_id, text }
            if (section) cite.section = section
            cites.push(cite)
        }
        cites = postValidate(cites, candidates)
        if (log.isDebug()) log.debug("selector.llm", { asked: candidates.length, picked: cites.length })
        return { citations: cites }
    } catch (err: any) {
        log.warn("selector error", { error: String(err?.message || err) })
        return { citations: [] }
    }
}

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

function postValidate(cites: Citation[], cands: Candidate[]): Citation[] {
    // Keep only citations that reference existing candidates and backfill section
    const candById = new Map(cands.map(c => [c.chunk_id, c]))
    const out: Citation[] = []
    for (const c of cites) {
        const src = candById.get(c.chunk_id)
        if (!src) continue
        const cite: Citation = { chunk_id: c.chunk_id, text: c.text }
        if (c.section) cite.section = c.section
        out.push(cite)
    }
    return out
}
