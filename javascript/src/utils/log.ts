type Level = "error" | "warn" | "info" | "debug"

const order: Record<Level, number> = { error: 0, warn: 1, info: 2, debug: 3 }
const envLevel = (process.env.LOG_LEVEL?.toLowerCase() as Level) || "info"
const minLevel = order[envLevel] ?? order.info
const asJson = process.env.LOG_JSON === "1"

function out(level: Level, scope: string, msg: string, meta?: unknown) {
    if (order[level] > minLevel) return
    const time = new Date().toISOString()
    if (asJson) {
        const rec: any = { time, level, scope, msg }
        if (meta !== undefined) rec.meta = meta
        const line = JSON.stringify(rec)
        if (level === "error" || level === "warn") process.stderr.write(line + "\n")
        else process.stdout.write(line + "\n")
        return
    }
    const head = `${level.toUpperCase()} ${scope}`
    //const head = `[${time}] ${level.toUpperCase()} ${scope}`
    const line = meta === undefined ? `${head} ${msg}` : `${head} ${msg} ${safeMeta(meta)}`
    if (level === "error" || level === "warn") process.stderr.write(line + "\n")
    else process.stdout.write(line + "\n")
}

function safeMeta(m: unknown) {
    try { return JSON.stringify(m) } catch { return String(m) }
}

export function createLogger(scope: string) {
    return {
        error: (msg: string, meta?: unknown) => out("error", scope, msg, meta),
        warn: (msg: string, meta?: unknown) => out("warn", scope, msg, meta),
        info: (msg: string, meta?: unknown) => out("info", scope, msg, meta),
        debug: (msg: string, meta?: unknown) => out("debug", scope, msg, meta),
        isDebug: () => minLevel >= order.debug,
        child: (sub: string) => createLogger(`${scope}:${sub}`)
    }
}
