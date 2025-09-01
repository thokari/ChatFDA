import { NextRequest, NextResponse } from "next/server"
import { runAsk } from "@/lib/workflow"

export const runtime = "nodejs"

export async function POST(req: NextRequest) {
    const { q } = await req.json().catch(() => ({}))
    if (!q || typeof q !== "string") {
        return NextResponse.json({ error: "q is required" }, { status: 400 })
    }
    const result = await runAsk(q)
    return NextResponse.json(result)
}
