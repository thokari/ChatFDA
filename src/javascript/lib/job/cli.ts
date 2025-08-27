#!/usr/bin/env ts-node
import "dotenv/config"
import { Command } from "commander"
import { osClientFromEnv, makeJobId, createJob, getJob, setStatus, logEvent, type JobParams } from "./control.js"
import { runJob } from "./runner.js"

// Quick openFDA preflight (uses openfda.substance_name and openfda.route)
async function checkOpenFda(opts: { ingredient: string; route: string; updatedSince?: string }) {
    const parts: string[] = []
    if (opts.ingredient) parts.push(`openfda.substance_name:${encodeURIComponent(opts.ingredient)}`)
    if (opts.route) parts.push(`openfda.route:${encodeURIComponent(opts.route)}`)
    if (opts.updatedSince) parts.push(`effective_time:[${opts.updatedSince}+TO+*]`)
    const search = parts.join("+AND+")
    const url = `https://api.fda.gov/drug/label.json?search=${search}&limit=1`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`openFDA check failed: HTTP ${res.status}`)
    const json: any = await res.json()
    const total = json?.meta?.results?.total ?? 0
    const sampleId = json?.results?.[0]?.id
    return { total, sampleId }
}

function jobIdFromOpts(opts: any): string {
    if (opts.id) return String(opts.id)
    const ingredient = String(opts.ingredient ?? "").toUpperCase()
    const route = String(opts.route ?? "").toUpperCase()
    const limit = Math.min(Math.max(Number(opts.limit ?? 100), 1), 1000)
    const params: JobParams = {
        ingredient, route, limit,
        ...(opts.updatedSince ? { updatedSince: String(opts.updatedSince) } : {})
    }
    return makeJobId(params)
}

async function preflightTotal(opts: { ingredient: string; route: string; updatedSince?: string }) {
    const q: string[] = []
    if (opts.ingredient) q.push(`openfda.substance_name:${encodeURIComponent(opts.ingredient)}`)
    if (opts.route) q.push(`openfda.route:${encodeURIComponent(opts.route)}`)
    if (opts.updatedSince) q.push(`effective_time:[${opts.updatedSince}+TO+*]`)
    const url = `https://api.fda.gov/drug/label.json?search=${q.join("+AND+")}&limit=1`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`openFDA preflight failed: HTTP ${res.status}`)
    const json: any = await res.json()
    return Number(json?.meta?.results?.total || 0)
}

const program = new Command()

program
    .name("job-cli")
    .description("Ingest job controller")
    .showHelpAfterError()

program
    .command("check")
    .requiredOption("--ingredient <name>", "generic/substance name (e.g., ibuprofen)")
    .requiredOption("--route <ROUTE>", "route (e.g., ORAL)")
    .option("--updatedSince <YYYYMMDD>", "effective_time lower bound")
    .action(async (opts) => {
        const ingredient = String(opts.ingredient).toUpperCase()
        const route = String(opts.route).toUpperCase()
        const { total, sampleId } = await checkOpenFda({ ingredient, route, updatedSince: opts.updatedSince })
        console.log(`openFDA: ${total} label(s) for ${ingredient} route=${route}${opts.updatedSince ? " since " + opts.updatedSince : ""}${sampleId ? `, e.g. id=${sampleId}` : ""}`)
    })

program
    .command("start")
    .requiredOption("--ingredient <name>", "generic/substance name (e.g., ibuprofen)")
    .requiredOption("--route <ROUTE>", "route (e.g., ORAL)")
    .option("--updatedSince <YYYYMMDD>", "effective_time lower bound")
    .option("--limit <n>", "page size (1..1000)", (v) => parseInt(v, 10), 100)
    .action(async (opts) => {
        const os = osClientFromEnv()

        const ingredient = String(opts.ingredient).toUpperCase()
        const route = String(opts.route).toUpperCase()
        const limit = Math.min(Math.max(Number(opts.limit ?? 100), 1), 1000)

        // preflight to set total_expected
        const total = await preflightTotal({ ingredient, route, updatedSince: opts.updatedSince })
        if (total === 0) {
            console.log(`No labels found on openFDA for ${ingredient} route=${route}. Aborting.`)
            return
        }
        console.log(`[preflight] ${total} total labels for ${ingredient} route=${route}${opts.updatedSince ? ` since ${opts.updatedSince}` : ""}`)

        const params: JobParams = {
            ingredient: String(opts.ingredient),
            route: String(opts.route).toUpperCase(),
            limit,
            ...(opts.updatedSince !== undefined ? { updatedSince: String(opts.updatedSince) } : {})
        }

        const jobId = makeJobId(params)
        const existing = await getJob(os, jobId)
        if (existing) {
            console.log(`Job exists: ${jobId} (status=${existing.status}). Resuming…`)
            await setStatus(os, jobId, "RUNNING")
        } else {
            await createJob(os, jobId, params)
            await logEvent(os, jobId, "INFO", "JOB", "Started", params)
            console.log(`Started ${jobId}`)
        }
        await runJob(jobId)
    })

program
    .command("pause")
    .option("--id <jobId>", "existing job id")
    .option("--ingredient <name>")
    .option("--route <ROUTE>")
    .option("--limit <n>")
    .option("--updatedSince <YYYYMMDD>")
    .action(async (opts) => {
        const os = osClientFromEnv()
        const jobId = jobIdFromOpts(opts)
        await setStatus(os, jobId, "PAUSED")
        console.log(`Paused ${jobId}`)
    })

program
    .command("resume")
    .option("--id <jobId>")
    .option("--ingredient <name>")
    .option("--route <ROUTE>")
    .option("--limit <n>")
    .option("--updatedSince <YYYYMMDD>")
    .action(async (opts) => {
        const os = osClientFromEnv()
        const jobId = jobIdFromOpts(opts)
        await setStatus(os, jobId, "RUNNING")
        console.log(`Resuming ${jobId}`)
        await runJob(jobId)
    })

program
    .command("status")
    .option("--id <jobId>")
    .option("--ingredient <name>")
    .option("--route <ROUTE>")
    .option("--limit <n>")
    .option("--updatedSince <YYYYMMDD>")
    .action(async (opts) => {
        const os = osClientFromEnv()
        const jobId = jobIdFromOpts(opts)
        const job = await getJob(os, jobId)
        if (!job) return console.log(`No job ${jobId}`)
        const seen = job.counters?.labels_seen ?? 0
        const total = job.params?.total_expected ?? null
        const pct = total ? ((seen / total) * 100).toFixed(1) : "?"
        console.log(`job=${jobId} status=${job.status} seen=${seen}${total ? `/${total} (${pct}%)` : ""} skip=${job.cursor?.skip ?? 0}`)
    })

program.parseAsync().catch((e) => {
    console.error(e?.message || e)
    process.exit(1)
})
