import { NextRequest, NextResponse } from "next/server"
import { retrieveWithInfo } from "@/lib/retriever"
import { answerQuestion } from "@/lib/qa/answerer"

export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  const { q, topK = 8 } = await req.json().catch(() => ({}))
  if (!q || typeof q !== "string") return NextResponse.json({ error: "q is required" }, { status: 400 })
  const { hits, strategy } = await retrieveWithInfo(q, { topK, highlight: false, sourceFields: ["*"] })
  const result = await answerQuestion(q, hits, { maxPerLabel: 1 })
  return NextResponse.json({ ...result, strategy })
}
