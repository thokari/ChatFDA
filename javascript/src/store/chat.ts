"use client"
import { create } from 'zustand'
import { readSse, type SseEvent } from '@/utils/sse'
import { addMissingSentenceSpaces } from '@/utils/text'

export type ChatMessage = { role: 'user' | 'assistant'; content: string; meta?: { citations?: any[]; strategy?: any } }

type ChatState = {
    messages: ChatMessage[]
    pending: boolean
    error?: string | undefined
    sendPrompt: (q: string) => Promise<void>
    reset: () => void
}

export const useChatStore = create<ChatState>()((set, get) => ({
    messages: [],
    pending: false,
    error: undefined,
    reset: () => set({ messages: [], pending: false, error: undefined }),
    sendPrompt: async (q: string) => {
        const trimmed = q.trim()
        if (!trimmed) return
    set(s => ({ messages: [...s.messages, { role: 'user', content: trimmed, meta: {} }], error: undefined }))
        set({ pending: true })
        try {
            const res = await fetch('/api/ask/stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ q: trimmed })
            })
            if (!res.body) throw new Error('No stream')

            let answer = ''
            let citations: any[] | undefined
            let strategy: any | undefined

            for await (const ev of readSse(res.body) as AsyncIterable<SseEvent>) {
                if (ev.type === 'retrieval') strategy = (ev as any).data?.strategy
                if ((ev as any).type === 'citations') {
                    citations = (ev as any).data as any[]
                    // Attach citations early so UI can show them while streaming
                    set(s => {
                        const last = s.messages[s.messages.length - 1]
                        if (last?.role === 'assistant') {
                            const copy = s.messages.slice()
                            copy[copy.length - 1] = {
                                ...last,
                                meta: {
                                    ...(last.meta || {}),
                                    ...(citations ? { citations } : {}),
                                    ...(strategy !== undefined ? { strategy } : {}),
                                }
                            }
                            return { messages: copy }
                        }
                        return {
                            messages: [
                                ...s.messages,
                                { role: 'assistant', content: '', meta: { ...(citations ? { citations } : {}), ...(strategy !== undefined ? { strategy } : {}) } }
                            ]
                        }
                    })
                    continue
                }
                if (ev.type === 'token') {
                    const piece = typeof (ev as any).data === 'string' ? (ev as any).data : ''
                    answer += piece
                    const smoothed = addMissingSentenceSpaces(answer)
                    set(s => {
                        const last = s.messages[s.messages.length - 1]
                        if (last?.role === 'assistant') {
                            const copy = s.messages.slice()
                            copy[copy.length - 1] = { ...last, content: smoothed }
                            return { messages: copy }
                        }
                        return { messages: [...s.messages, { role: 'assistant', content: smoothed, meta: {} }] }
                    })
                }
            }

            set(s => {
                const last = s.messages[s.messages.length - 1]
                const finalized = addMissingSentenceSpaces(answer)
                if (last?.role === 'assistant') {
                    const copy = s.messages.slice()
                    copy[copy.length - 1] = {
                        ...last,
                        content: finalized,
                        meta: {
                            ...(last.meta || {}),
                            ...(citations ? { citations } : {}),
                            ...(strategy !== undefined ? { strategy } : {}),
                        }
                    }
                    return { messages: copy }
                }
                return {
                    messages: [
                        ...s.messages,
                        { role: 'assistant', content: finalized, meta: { ...(citations ? { citations } : {}), ...(strategy !== undefined ? { strategy } : {}) } }
                    ]
                }
            })
        } catch (e: any) {
            set(s => ({ messages: [...s.messages, { role: 'assistant', content: 'Request failed. Please try again.', meta: {} }] }))
            set({ error: e?.message ?? 'Request failed' })
        } finally {
            set({ pending: false })
        }
    }
}))
