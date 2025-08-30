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
    // Scroll to the latest content without forcing a tall inner box
    const endRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
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
        <div className="mx-auto max-w-3xl w-full px-4 sm:px-6 py-6">
            {/* Messages stack; allow the page to scroll naturally */}
            <div className="space-y-4">
                {messages.map((m, i) => (
                    <div key={i} className="">
                        <ChatMessage role={m.role} content={m.content} />
                        {m.role === "assistant" && m.meta?.citations && (
                            <>
                                <h3 className="mt-6 font-semibold text-slate-800">Sources used for this response</h3>
                                <CitationList hits={m.meta.citations} />
                            </>
                        )}
                    </div>
                ))}
                {loading && <div className="text-sm text-blue-700/70 px-2 py-1">Thinking…</div>}
                <div ref={endRef} />
            </div>

            {/* Input: center vertically when empty; otherwise sits below content */}
            <div className={messages.length === 0 ? "min-h-[50vh] flex items-center" : "mt-4"}>
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
        </div>
    )
}
