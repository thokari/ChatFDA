import { Client } from "@opensearch-project/opensearch"
import type { OsLike } from "./types.js"

// Concrete client type = the minimal surface we use
export type OsClient = OsLike

export function osClientFromEnv(): OsClient {
    const node = process.env.OS_HOST || "https://localhost:9200"
    const username = process.env.OS_USER || "admin"
    const password = process.env.OS_PASS || ""
    return new Client({
        node,
        auth: { username, password },
        ssl: { rejectUnauthorized: false }, // dev only (self-signed)
    }) as unknown as OsClient
}
