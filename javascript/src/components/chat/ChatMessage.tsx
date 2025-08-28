import React from "react"

export function ChatMessage({ role, content }: { role: "user" | "assistant"; content: string }) {
    const isUser = role === "user"
    return (
        <div className={`w-full flex ${isUser ? "justify-end" : "justify-start"} my-2`}>
            <div className={`${isUser ? "bg-blue-600 text-white" : "bg-gray-100"}
                   max-w-[80%] rounded-2xl px-4 py-2 whitespace-pre-wrap`}>
                {content}
            </div>
        </div>
    )
}
