"use client"
import React, { useEffect, useRef, useState } from "react"
import { ChatMessage } from "./ChatMessage"
import { ChatInput } from "./ChatInput"
import { CitationList } from "@/components/citations/CitationList"
import { useChatStore } from "@/store/chat"

export default function Chat() {
    const { messages, pending, sendPrompt } = useChatStore()
    const [input, setInput] = useState("")
    const messageEndRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!pending) messageEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, [messages, pending])

    return (
        <div className="mx-auto max-w-3xl w-full px-4 sm:px-6 py-6">
            <div className="space-y-4">
                {messages.map((m, i) => (
                    <div key={i} className="">
                        <ChatMessage role={m.role} content={m.content} />
                        {i === messages.length - 1 && (
                            <div ref={messageEndRef} />
                        )}
            {m.role === "assistant" && Array.isArray(m.meta?.citations) && m.meta.citations.length > 0 && (
                            <>
                                <h3 className="mt-6 font-semibold text-slate-800">Sources used for this response</h3>
                <CitationList hits={m.meta.citations} />
                            </>
                        )}
                    </div>
                ))}
                {pending && <div className="text-sm text-blue-700/70 px-2 py-1">Thinking…</div>}
            </div>

            <div className={messages.length === 0 ? "min-h-[50vh] flex items-center" : "mt-4"}>
                <ChatInput
                    value={input}
                    onChange={setInput}
                    disabled={pending}
                    onSubmit={() => {
                        const q = input.trim()
                        if (!q) return
                        setInput("")
                        void sendPrompt(q)
                    }}
                />
            </div>
        </div>
    )
}
