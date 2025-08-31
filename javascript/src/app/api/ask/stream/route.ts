import { NextRequest } from "next/server"
import { retrieveWithInfo } from "@/lib/retriever"
import { answerQuestionStream } from "@/lib/qa/answerer"
import { selectCitations } from "@/lib/qa/selector"

export const runtime = "nodejs"

function sseInit(headers?: Record<string, string>) {
    return new Headers({
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
        ...headers,
    })
}

function sseEncode(event: string | null, data: any) {
    // Always JSON-encode so leading spaces in strings are preserved through SSE parsing
    const payload = JSON.stringify(data)
    return (event ? `event: ${event}\n` : "") + `data: ${payload}\n\n`
}

export async function POST(req: NextRequest) {
    const { q } = await req.json().catch(() => ({}))
    if (!q || typeof q !== "string") return new Response("q is required", { status: 400 })

    const { hits, strategy } = await retrieveWithInfo(q, { highlight: false, sourceFields: ["*"] })

    const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
            const encoder = new TextEncoder()

            // Emit retrieval info early for UI
            controller.enqueue(encoder.encode(sseEncode("retrieval", { strategy, total: hits.length })))

            try {
                // Select citations first (trimmed quotes) and emit for UI
                const byId = new Map<string, any>()
                for (const h of hits) {
                    const cid = String(h._source?.chunk_id ?? h._id)
                    byId.set(cid, h)
                }
                const sel = await selectCitations(q, hits)
                const selectedHits = sel.citations
                    .map(c => {
                        const base = byId.get(c.chunk_id)
                        if (!base) return null
                        return { ...base, _source: { ...base._source, text: c.text } }
                    })
                    .filter(Boolean) as typeof hits

                controller.enqueue(encoder.encode(sseEncode("citations", selectedHits)))

                const { stream: aiStream, model } = await answerQuestionStream(q, selectedHits)
                controller.enqueue(encoder.encode(sseEncode("meta", { model })))

                for await (const token of aiStream) {
                    controller.enqueue(encoder.encode(sseEncode("token", token)))
                }
                controller.enqueue(encoder.encode(sseEncode("done", { ok: true })))
            } catch (err: any) {
                controller.enqueue(encoder.encode(sseEncode("error", { message: err?.message ?? "failed" })))
            } finally {
                controller.close()
            }
        },
    })

    return new Response(stream, { headers: sseInit() })
}
