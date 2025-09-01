"use client"
import { create } from 'zustand'
import { readSse, type SseEvent } from '@/utils/sse'
import { addMissingSentenceSpaces } from '@/utils/text'

export type ChatMessage = {
    role: 'user' | 'assistant'
    content: string
    meta?: {
        citations?: any[]
        strategy?: any
        durationMs?: number
    }
}

export type ChatState = {
    messages: ChatMessage[]
    pending: boolean
    phase: 'retrieving' | 'selecting' | 'answering' | 'done' | null
    startedAt: number | null
    error?: string | undefined
    sendPrompt: (q: string) => Promise<void>
    reset: () => void
}

export const useChatStore = create<ChatState>()((set, get) => ({
    messages: [],
    pending: false,
    phase: null,
    startedAt: null,
    error: undefined,

    reset: () => set({
        messages: [],
        pending: false,
        phase: null,
        startedAt: null,
        error: undefined
    }),

    sendPrompt: async (q: string) => {
        const trimmed = q.trim()
        if (!trimmed) return
        set(s => ({
            messages: [
                ...s.messages,
                { role: 'user', content: trimmed, meta: {} }
            ], error: undefined
        }))
        set({
            pending: true,
            phase: 'retrieving',
            startedAt: Date.now(),
        })
        // Ensure there's an assistant placeholder immediately so the UI can anchor the timer
        set(s => {
            const last = s.messages[s.messages.length - 1]
            if (last?.role === 'assistant') return {}
            return { messages: [...s.messages, { role: 'assistant', content: '', meta: {} }] }
        })
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
                if (ev.type === 'retrieval') {
                    strategy = (ev as any).data?.strategy
                    set({ phase: 'selecting' })
                }
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
                                {
                                    role: 'assistant',
                                    content: '',
                                    meta: {
                                        ...(citations ? { citations } : {}),
                                        ...(strategy !== undefined ? { strategy } : {})
                                    }
                                }
                            ]
                        }
                    })
                    // stay in 'selecting' until meta arrives
                    continue
                }
                if (ev.type === 'meta') {
                    set({ phase: 'answering' })
                }
                if (ev.type === 'done') {
                    const started = get().startedAt
                    const dur = typeof started === 'number' ? Math.max(0, Date.now() - started) : undefined
                    set(s => {
                        const last = s.messages[s.messages.length - 1]
                        if (last?.role === 'assistant') {
                            const copy = s.messages.slice()
                            copy[copy.length - 1] = {
                                ...last,
                                meta: { ...(last.meta || {}), ...(dur !== undefined ? { durationMs: dur } : {}) }
                            }
                            return { phase: 'done', messages: copy }
                        }
                        return { phase: 'done' }
                    })
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
                        {
                            role: 'assistant',
                            content: finalized,
                            meta: {
                                ...(citations ? { citations } : {}),
                                ...(strategy !== undefined ? { strategy } : {})
                            }
                        }
                    ]
                }
            })
        } catch (e: any) {
            set(s => ({
                messages: [
                    ...s.messages,
                    { role: 'assistant', content: 'Request failed. Please try again.', meta: {} }
                ]
            }))
            set({ error: e?.message ?? 'Request failed' })
        } finally {
            set({ pending: false, phase: null, startedAt: null })
        }
    }
}))
