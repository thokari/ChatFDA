import React from "react"

export function ChatInput({
    value, onChange, onSubmit, disabled
}: { value: string; onChange: (v: string) => void; onSubmit: () => void; disabled?: boolean }) {
    return (
        <form
            onSubmit={(e) => { e.preventDefault(); onSubmit() }}
            className="flex gap-2 w-full"
        >
            <input
                className="flex-1 border rounded-md px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Ask about dosing, warnings, pregnancy…"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                disabled={disabled}
            />
            <button
                className="rounded-md border px-4 py-2 bg-black text-white disabled:opacity-50"
                disabled={disabled}
                type="submit"
            >
                Send
            </button>
        </form>
    )
}
