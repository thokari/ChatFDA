#!/usr/bin/env ts-node
import "dotenv/config"
import { Command } from "commander"
import { makeJobId, getJob, setStatus, type JobParams, preflightTotal, openFdaPreflight, ensureJob, parseSeedsCsv } from "./control.js"
import { runJob } from "./runner.js"
import { osClientFromEnv } from "../os-client.js";

// Quick openFDA preflight now comes from control.ts
// Removed local checkOpenFda/preflightTotal helpers

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
        const { total, sampleId } = await openFdaPreflight({ ingredient, route, updatedSince: opts.updatedSince })
        console.log(`openFDA: ${total} label(s) for ${ingredient} route=${route}${opts.updatedSince ? " since " + opts.updatedSince : ""}${sampleId ? `, e.g. id=${sampleId}` : ""}`)
    })

program
    .command("start")
    .requiredOption("--ingredient <name>", "generic/substance name (e.g., ibuprofen)")
    .requiredOption("--route <ROUTE>", "route (e.g., ORAL)")
    .option("--updatedSince <YYYYMMDD>", "effective_time lower bound")
    .option("--limit <n>", "page size (1..1000)", (v) => parseInt(v, 10), 100)
    .option("-v, --verbose", "verbose progress logs")
    .action(async (opts) => {
        const t0 = Date.now()
        const T = (msg: string) => {
            if (!opts.verbose) return
            const dt = ((Date.now() - t0) / 1000).toFixed(2)
            console.log(`[t+${dt}s] ${msg}`)
        }
        T("bootstrapping CLI…")

        const os = osClientFromEnv()
        T("OpenSearch client initialized")

        const ingredient = String(opts.ingredient).toUpperCase()
        const route = String(opts.route).toUpperCase()
        const limit = Math.min(Math.max(Number(opts.limit ?? 100), 1), 1000)

        T("calling openFDA preflight…")
        const total = await preflightTotal({ ingredient, route, updatedSince: opts.updatedSince })
        T(`openFDA preflight done (total=${total})`)
        if (total === 0) {
            console.log(`No labels found on openFDA for ${ingredient} route=${route}. Aborting.`)
            return
        }
        console.log(`[preflight] ${total} total labels for ${ingredient} route=${route}${opts.updatedSince ? ` since ${opts.updatedSince}` : ""}`)

        const params: JobParams = {
            ingredient: String(opts.ingredient),
            route: route,
            limit,
            ...(opts.updatedSince !== undefined ? { updatedSince: String(opts.updatedSince) } : {}),
            ...(total ? { total_expected: total } : {})
        }

        const { jobId } = await ensureJob(os, params)
        T("starting runner…")
        await runJob(jobId)
    })

program
    .command("start-batch")
    .requiredOption("--file <path>", "CSV with header: ingredient,route")
    .option("--updatedSince <YYYYMMDD>", "effective_time lower bound (applies to all)")
    .option("--limit <n>", "page size (1..1000)", (v) => parseInt(v, 10), 100)
    .option("-v, --verbose", "verbose progress logs")
    .action(async (opts) => {
        const seeds = parseSeedsCsv(String(opts.file))
        if (seeds.length === 0) {
            console.log(`No seeds found in ${opts.file}`)
            return
        }
        const os = osClientFromEnv()
        console.log(`Starting batch for ${seeds.length} seed(s) from ${opts.file}`)

        for (const { ingredient, route } of seeds) {
            const t0 = Date.now()
            const T = (msg: string) => {
                if (!opts.verbose) return
                const dt = ((Date.now() - t0) / 1000).toFixed(2)
                console.log(`[${ingredient.toUpperCase()}/${route.toUpperCase()} t+${dt}s] ${msg}`)
            }
            try {
                T("preflight…")
                const total = await preflightTotal({
                    ingredient: String(ingredient).toUpperCase(),
                    route: String(route).toUpperCase(),
                    updatedSince: opts.updatedSince
                })
                if (total === 0) {
                    console.log(`[preflight] 0 total labels for ${ingredient} route=${route}. Skipping.`)
                    continue
                }
                console.log(`[preflight] ${total} total labels for ${ingredient} route=${route}${opts.updatedSince ? ` since ${opts.updatedSince}` : ""}`)
                const params: JobParams = {
                    ingredient: String(ingredient),
                    route: String(route).toUpperCase(),
                    limit: Math.min(Math.max(Number(opts.limit ?? 100), 1), 1000),
                    ...(opts.updatedSince ? { updatedSince: String(opts.updatedSince) } : {}),
                    ...(total ? { total_expected: total } : {})
                }
                const { jobId } = await ensureJob(os, params)
                T("running…")
                await runJob(jobId)
            } catch (e: any) {
                console.error(`Error on ${ingredient}/${route}: ${e?.message || e}`)
            }
        }
        console.log("Batch complete.")
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
