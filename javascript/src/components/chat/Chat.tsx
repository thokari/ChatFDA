"use client"
import React, { useEffect, useRef, useState } from "react"
import { ChatMessage } from "./ChatMessage"
import { ChatInput } from "./ChatInput"
import { CitationList } from "@/components/citations/CitationList"
import { readSse, type SseEvent } from "@/utils/sse"
import { addMissingSentenceSpaces } from "@/utils/text"

type Msg = { role: "user" | "assistant"; content: string; meta?: any }

export default function Chat() {
    const [messages, setMessages] = useState<Msg[]>([])
    const [input, setInput] = useState("")
    const [loading, setLoading] = useState(false)
    const scrollRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
    }, [messages])

    async function ask(q: string) {
        setLoading(true)
        try {
            const useStream = true
            if (!useStream) {
                const res = await fetch("/api/ask", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ q, topK: 8 })
                })
                const data = await res.json()
                setMessages(m => [...m, { role: "assistant", content: data.answer ?? "No answer", meta: { citations: data.citations, strategy: data.strategy } }])
            } else {
                const res = await fetch("/api/ask/stream", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ q, topK: 8 })
                })
                if (!res.body) throw new Error("No stream")
                let answer = ""
                let citations: any[] | undefined
                let strategy: any | undefined
                for await (const ev of readSse(res.body) as AsyncIterable<SseEvent>) {
                    if (ev.type === "retrieval") strategy = ev.data?.strategy
                    if (ev.type === "token") {
                        const piece = typeof ev.data === "string" ? ev.data : ""
                        answer += piece
                        const smoothed = addMissingSentenceSpaces(answer)
                        // Optimistically render partial answer
                        setMessages(m => {
                            const last = m[m.length - 1]
                            // Avoid appending too many interim entries; coalesce last assistant message
                            if (last?.role === "assistant") {
                                const copy = m.slice()
                                copy[copy.length - 1] = { ...last, content: smoothed }
                                return copy
                            }
                            return [...m, { role: "assistant", content: smoothed }]
                        })
                    }
                    if (ev.type === "citations") citations = ev.data as any[]
                }
                // Finalize
                setMessages(m => {
                    const last = m[m.length - 1]
                    if (last?.role === "assistant") {
                        const copy = m.slice()
                        copy[copy.length - 1] = { ...last, content: addMissingSentenceSpaces(answer), meta: { citations, strategy } }
                        return copy
                    }
                    return [...m, { role: "assistant", content: addMissingSentenceSpaces(answer), meta: { citations, strategy } }]
                })
            }
        } catch (e: any) {
            setMessages(m => [...m, { role: "assistant", content: "Request failed. Please try again." }])
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="mx-auto max-w-3xl w-full h-[90vh] flex flex-col gap-3">
            <div ref={scrollRef} className="flex-1 overflow-y-auto border rounded-md p-3">
                {messages.map((m, i) => (
                    <div key={i}>
                        <ChatMessage role={m.role} content={m.content} />
                        {m.role === "assistant" && m.meta?.citations && (
                            <CitationList hits={m.meta.citations} />
                        )}
                    </div>
                ))}
                {loading && <div className="text-sm text-gray-500 px-2 py-1">Thinking…</div>}
            </div>
            <ChatInput
                value={input}
                onChange={setInput}
                disabled={loading}
                onSubmit={() => {
                    const q = input.trim()
                    if (!q) return
                    setMessages(m => [...m, { role: "user", content: q }])
                    setInput("")
                    void ask(q)
                }}
            />
        </div>
    )
}
