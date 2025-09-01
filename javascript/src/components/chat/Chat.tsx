"use client"
import React, { useEffect, useRef, useState } from "react"
import { ChatMessage } from "./ChatMessage"
import { ChatInput } from "./ChatInput"
import { CitationList } from "@/components/citations/CitationList"
import { useChatStore } from "@/store/chat"

function InlineTimer({ active, phase, durationMs }: { active: boolean; phase: 'retrieving' | 'selecting' | 'answering' | 'done' | null; durationMs: number | undefined }) {
    const [t0, setT0] = useState<number | null>(null)
    const [now, setNow] = useState<number>(Date.now())

    useEffect(() => {
        let id: any
        if (active) {
            const start = Date.now()
            setT0(start)
            id = setInterval(() => setNow(Date.now()), 100)
        } else {
            setT0(null)
        }
        return () => { if (id) clearInterval(id) }
    }, [active])

    if (active && t0 != null) {
        const elapsed = (now - t0) / 1000
        const label = phase === 'retrieving' ? 'Retrieving relevant labels…' : phase === 'selecting' ? 'Selecting relevant passages…' : 'Answering…'
        return (
            <div className="text-sm text-slate-700 px-2 py-1">
                <span>{label} </span><span className="font-bold">{elapsed.toFixed(1)}s</span>
            </div>
        )
    }
    if (!active && typeof durationMs === 'number') {
        return (
            <div className="text-sm text-slate-700 px-2 py-1">
                Responded in <span className="font-semibold">{(durationMs / 1000).toFixed(2)}s</span>
            </div>
        )
    }
    return null
}

export default function Chat() {
    const { messages, pending, phase, sendPrompt } = useChatStore()
    const [input, setInput] = useState("")
    const messageEndRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!pending) messageEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, [messages, pending])

    return (
        <div className="mx-auto max-w-3xl w-full px-4 sm:px-6 py-6">
            <div className="space-y-4">
                {messages.map((m, i) => {
                    const isLast = i === messages.length - 1
                    const isAssistant = m.role === 'assistant'
                    const isLoadingAssistant = isAssistant && pending && isLast && m.content === ''
                    return (
                        <div key={i} className="">
                            {isAssistant && (
                                <InlineTimer
                                    active={pending && isLast}
                                    phase={phase}
                                    durationMs={typeof m.meta?.durationMs === 'number' ? m.meta.durationMs : undefined}
                                />
                            )}
                            {isLoadingAssistant ? (
                                <div className="w-full flex justify-start my-2">
                                    <div className="bg-gray-100 max-w-[80%] rounded-2xl px-4 py-2">
                                        <span className="inline-flex gap-1 items-center">
                                            <span className="w-1 h-1 rounded-full bg-slate-400 animate-pulse [animation-delay:0ms]" />
                                            <span className="w-1 h-1 rounded-full bg-slate-400 animate-pulse [animation-delay:150ms]" />
                                            <span className="w-1 h-1 rounded-full bg-slate-400 animate-pulse [animation-delay:300ms]" />
                                        </span>
                                    </div>
                                </div>
                            ) : (
                                <ChatMessage role={m.role} content={m.content} />
                            )}
                            {i === messages.length - 1 && (
                                <div ref={messageEndRef} />
                            )}
                            {/* Show citations only after completion */}
                            {m.role === "assistant" && Array.isArray(m.meta?.citations) && m.meta.citations.length > 0 && !(pending && i === messages.length - 1) && (
                                <>
                                    <h3 className="mt-6 font-semibold text-slate-800">Sources used for this response</h3>
                                    <div className="transition-opacity duration-200 opacity-100">
                                        <CitationList hits={m.meta.citations} />
                                    </div>
                                </>
                            )}
                        </div>
                    )
                })}
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
