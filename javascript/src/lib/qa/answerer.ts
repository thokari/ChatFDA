import { ChatOpenAI } from "@langchain/openai"
import type { RetrieveHit } from "../retriever.js"
import { fileURLToPath } from "node:url"
import { createLogger } from "@/utils/log"
import { readFile, stat as statAsync } from "node:fs/promises"

const log = createLogger("answerer")

export type AnswerOptions = {
    model?: string
    temperature?: number
    maxContextChars?: number
    maxPerLabel?: number
}

const promptFilePath = fileURLToPath(new URL("./answerer-prompt.md", import.meta.url))
let promptCache: string

async function getSystemPrompt(): Promise<string> {
    const st = await statAsync(promptFilePath)
    if (promptCache) {
        return promptCache
    }
    const text = await readFile(promptFilePath, "utf8")
    promptCache = text
    return text
}

export function buildContext(hits: RetrieveHit[], opts: AnswerOptions = {}): string {
    const maxPerLabel = opts.maxPerLabel ?? 1

    // Group by label (use label_id; set_id is not reliable)
    const byLabel = new Map<string, RetrieveHit[]>()
    for (const h of hits) {
        const k = h._source?.label_id ?? h._id
        const arr = byLabel.get(k) ?? []
        if (arr.length < maxPerLabel) arr.push(h)
        byLabel.set(k, arr)
    }

    const blocks: string[] = []
    for (const arr of byLabel.values()) {
        for (const h of arr) {
            // Include full _source as JSON (retriever already excludes vectors)
            const src = h._source ?? {}
            blocks.push(JSON.stringify(src, null, 2))
        }
    }

    let ctx = blocks.join("\n\n---\n\n")
    const maxChars = opts.maxContextChars ?? 12000
    if (ctx.length > maxChars) ctx = ctx.slice(0, maxChars)
    return ctx
}

function toPlainText(content: any): string {
    if (typeof content === "string") return content
    if (Array.isArray(content)) return content.map((c) => (typeof c === "string" ? c : c?.text ?? "")).join("\n").trim()
    const v = (content as any)?.content
    return typeof v === "string" ? v : JSON.stringify(v ?? content)
}

export async function answerQuestion(
    query: string,
    hits: RetrieveHit[],
    opts: AnswerOptions = {}
): Promise<{ answer: string; citations: RetrieveHit[]; used: { model: string } }> {
    const model = opts.model ?? "gpt-4o-mini"
    const temperature = opts.temperature ?? 0.2

    if (!hits || hits.length === 0) {
        const fallback = "I couldn’t find relevant label excerpts for that question. Try specifying the drug name, route, and what you want to know (e.g., dosing, warnings, pregnancy)."
        return { answer: fallback, citations: [], used: { model } }
    }

    const ctx = buildContext(hits, opts)

    const chat = new ChatOpenAI({ model, temperature })
    const res = await chat.invoke([
        { role: "system", content: await getSystemPrompt() },
        { role: "user", content: `Question:\n${query}\n\nExcerpts (full chunk _source):\n${JSON.stringify(ctx, null, 2)}` }
    ])

    return { answer: toPlainText(res), citations: hits, used: { model } }
}

// Streamed answering for SSE/Web streams
export async function answerQuestionStream(
    query: string,
    hits: RetrieveHit[],
    opts: AnswerOptions = {}
): Promise<{ model: string; stream: AsyncIterable<string> }> {
    const model = opts.model ?? "gpt-4o-mini"
    const temperature = opts.temperature ?? 0.2

    const ctx = buildContext(hits, opts)
    const chat = new ChatOpenAI({ model, temperature })
    log.debug("hits used in query", hits)
    const s = await chat.stream([
        { role: "system", content: await getSystemPrompt() },
        { role: "user", content: `Question:\n${query}\n\nExcerpts (full chunk _source):\n${JSON.stringify(ctx, null, 2)}` }
    ])

    async function* iter() {
        for await (const chunk of s as any) {
            // LangChain returns AIMessageChunk with .content which may be string or array
            const c: any = (chunk && (chunk.content ?? chunk))
            if (typeof c === "string") {
                if (c) yield c
            } else if (Array.isArray(c)) {
                const txt = c.map((p: any) => (typeof p === "string" ? p : p?.text ?? "")).join("")
                if (txt) yield txt
            } else if (typeof c?.toString === "function") {
                const txt = c.toString()
                if (txt) yield txt
            } else if (typeof chunk?.toString === "function") {
                const txt = chunk.toString()
                if (txt) yield txt
            }
        }
    }

    return { model, stream: iter() }
}
