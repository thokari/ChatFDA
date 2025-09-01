import { NextRequest } from "next/server"
import { streamAskEvents } from "@/lib/workflow"

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

    const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
            const encoder = new TextEncoder()

            try {
                for await (const ev of streamAskEvents(q)) {
                    controller.enqueue(encoder.encode(sseEncode(ev.type, ev.data)))
                }
            } finally {
                controller.close()
            }
        },
    })

    return new Response(stream, { headers: sseInit() })
}
