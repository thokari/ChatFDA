import { ChatOpenAI } from "@langchain/openai"
import type { RetrieveHit } from "../retriever.js"

export type AnswerOptions = {
  model?: string
  temperature?: number
  maxContextChars?: number
  maxPerLabel?: number
}

async function getSystemPrompt(override?: string): Promise<string> {
  if (override && override.trim()) return override
  return [
    "You are a concise clinical assistant answering from FDA drug label excerpts.",
    "Use only the provided excerpts; do not invent facts.",
    "Assume multiple labels are similar; pick the most appropriate snippet without burdening the user.",
    "Cite briefly using brand/manufacturer/section when helpful.",
    "If the question is unclear or citations conflict, explain and suggest how to rephrase.",
    "When uncertain, say you don’t know."
  ].join("\n")
}

export function buildContext(hits: RetrieveHit[], opts: AnswerOptions = {}): string {
  const maxPerLabel = opts.maxPerLabel ?? 1

  // Group by label (prefer set_id if present)
  const byLabel = new Map<string, RetrieveHit[]>()
  for (const h of hits) {
    const k = h._source?.set_id ?? h._source?.label_id ?? h._id
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