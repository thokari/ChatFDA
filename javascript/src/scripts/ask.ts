#!/usr/bin/env ts-node
import "dotenv/config"
import { retrieveWithInfo } from "../lib/retriever.js"
import { answerQuestion } from "../lib/qa/answerer.js"

const args = process.argv.slice(2)
const getArg = (f: string) => {
  const i = args.indexOf(f)
  return i >= 0 ? args[i + 1] : undefined
}
const qArg = getArg("--q")
const query: string = (typeof qArg === "string" && qArg.trim().length > 0)
  ? qArg
  : "What pain relievers are safe in pregnancy?"

const topArg = getArg("--topK")
const topK: number = Number.isFinite(Number(topArg)) ? Number(topArg) : 8

const { hits, strategy } = await retrieveWithInfo(query, {
  topK,
  highlight: false,
  sourceFields: ["*"] // full _source
})

const result = await answerQuestion(query, hits, { maxPerLabel: 1 })
console.log(result.answer)
console.log("\nStrategy:", strategy)
console.log("\nCitations:", JSON.stringify(result.citations, null, 2))
