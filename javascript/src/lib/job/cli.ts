#!/usr/bin/env ts-node
import "dotenv/config"
import { Command } from "commander"
import { makeJobId, getJob, setStatus, type JobParams, preflightTotal, openFdaPreflight, ensureJob, parseSeedsCsv } from "./control.js"
import { runJob } from "./runner.js"
import { osClientFromEnv } from "../os-client.js"
import { createLogger } from "../../utils/log.js"

const log = createLogger("cli")

function jobIdFromOpts(opts: any): string {
    if (opts.id) return String(opts.id)
    const ingredient = String(opts.ingredient ?? "").toUpperCase()
    const route = String(opts.roSute ?? "").toUpperCase()
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
        log.info(`openFDA: ${total} label(s) for ${ingredient} route=${route}${opts.updatedSince ? " since " + opts.updatedSince : ""}${sampleId ? `, e.g. id=${sampleId}` : ""}`)
    })

program
    .command("start")
    .requiredOption("--ingredient <name>", "generic/substance name (e.g., ibuprofen)")
    .requiredOption("--route <ROUTE>", "route (e.g., ORAL)")
    .option("--updatedSince <YYYYMMDD>", "effective_time lower bound")
    .option("--limit <n>", "page size (1..1000)", (v) => parseInt(v, 10), 100)
    .option("-v, --verbose", "verbose progress logs")
    .action(async (opts) => {
        const os = osClientFromEnv()
        const ingredient = String(opts.ingredient).toUpperCase()
        const route = String(opts.route).toUpperCase()
        const limit = Math.min(Math.max(Number(opts.limit ?? 100), 1), 1000)

        const total = await preflightTotal({ ingredient, route, updatedSince: opts.updatedSince })
        if (total === 0) {
            log.info(`No labels found on openFDA for ${ingredient} route=${route}. Aborting.`)
            return
        }
        log.info(`[preflight] ${total} total labels for ${ingredient} route=${route}${opts.updatedSince ? ` since ${opts.updatedSince}` : ""}`)

        const params: JobParams = {
            ingredient: String(opts.ingredient),
            route: route,
            limit,
            ...(opts.updatedSince !== undefined ? { updatedSince: String(opts.updatedSince) } : {}),
            ...(total ? { total_expected: total } : {})
        }

        const { jobId } = await ensureJob(os, params)
        log.info("Starting runner", { jobId })
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
            log.info(`No seeds found in ${opts.file}`)
            return
        }
        const os = osClientFromEnv()
        log.info(`Starting batch for ${seeds.length} seed(s) from ${opts.file}`)

        for (const { ingredient, route } of seeds) {
            const t0 = Date.now()
            const ING = ingredient.toUpperCase()
            const ROUTE = route.toUpperCase()
            try {
                const total = await preflightTotal({
                    ingredient: ING,
                    route: ROUTE,
                    updatedSince: opts.updatedSince
                })
                if (total === 0) {
                    log.info(`[preflight] 0 total labels for ${ingredient} route=${route}. Skipping.`)
                    continue
                }
                log.info(`[preflight] ${total} total labels for ${ingredient} route=${route}${opts.updatedSince ? ` since ${opts.updatedSince}` : ""}`)
                const params: JobParams = {
                    ingredient: String(ingredient),
                    route: ROUTE,
                    limit: Math.min(Math.max(Number(opts.limit ?? 100), 1), 1000),
                    ...(opts.updatedSince ? { updatedSince: String(opts.updatedSince) } : {}),
                    ...(total ? { total_expected: total } : {})
                }
                const { jobId } = await ensureJob(os, params)
                log.info("Running job", { jobId })
                await runJob(jobId)
            } catch (e: any) {
                log.error(`Error on ${ingredient}/${route}: ${e?.message || e}`)
            }
        }
        log.info("Batch complete.")
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
        log.info(`Paused ${jobId}`)
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
        log.info(`Resuming ${jobId}`)
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
        if (!job) return log.info(`No job ${jobId}`)
        const seen = job.counters?.labels_seen ?? 0
        const total = job.params?.total_expected ?? null
        const pct = total ? ((seen / total) * 100).toFixed(1) : "?"
        log.info(`job=${jobId} status=${job.status} seen=${seen}${total ? `/${total} (${pct}%)` : ""} skip=${job.cursor?.skip ?? 0}`)
    })

program.parseAsync().catch((e) => {
    log.error(e?.message || String(e))
    process.exit(1)
})
