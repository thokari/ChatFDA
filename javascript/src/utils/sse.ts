export type SseEvent =
    | { type: "retrieval"; data: any }
    | { type: "meta"; data: any }
    | { type: "token"; data: string }
    | { type: "citations"; data: any }
    | { type: "done"; data: { ok: boolean } }
    | { type: "error"; data: { message: string } }

export async function* readSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent, void, unknown> {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let buf = ""
    while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })

        // Split on double newline between SSE events
        let idx: number
        while ((idx = buf.indexOf("\n\n")) !== -1) {
            const raw = buf.slice(0, idx)
            buf = buf.slice(idx + 2)

            let event: string | null = null
            const dataLines: string[] = []

            for (let line of raw.split("\n")) {
                // drop trailing CR for Windows newlines
                if (line.endsWith("\r")) line = line.slice(0, -1)
                if (line.startsWith("event:")) {
                    event = line.slice(6).trim()
                } else if (line.startsWith("data:")) {
                    // Per SSE spec, a single leading space after ':' is ignored
                    let v = line.slice(5)
                    if (v.startsWith(" ")) v = v.slice(1)
                    dataLines.push(v)
                }
            }

            const data = dataLines.length ? dataLines.join("\n") : null
            if (data == null) continue
            try {
                const parsed = (() => {
                    try { return JSON.parse(data!) } catch { return data }
                })()
                const type = (event ?? "token") as SseEvent["type"]
                yield { type, data: parsed } as SseEvent
            } catch {
                // ignore malformed event
            }
        }
    }
}
