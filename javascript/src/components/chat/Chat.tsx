"use client"
import React, { useEffect, useRef, useState } from "react"
import { ChatMessage } from "./ChatMessage"
import { ChatInput } from "./ChatInput"
import { CitationList } from "@/components/citations/CitationList"

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
            const res = await fetch("/api/ask", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ q, topK: 8 })
            })
            const data = await res.json()
            setMessages(m => [...m, { role: "assistant", content: data.answer ?? "No answer", meta: { citations: data.citations, strategy: data.strategy } }])
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
