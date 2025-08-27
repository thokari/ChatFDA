import { Client } from "@opensearch-project/opensearch"
import type { OsLike } from "./types.js"

const OS_HOST = process.env.OS_HOST || "https://localhost:9200"
const OS_USER = process.env.OS_USER || "admin"
const OS_PASS = process.env.OS_PASS || ""

// Concrete client type = the minimal surface we use
export type OsClient = OsLike

// Production client
export const os: OsClient = new Client({
    node: OS_HOST,
    auth: { username: OS_USER, password: OS_PASS },
    ssl: { rejectUnauthorized: false }, // dev: self-signed TLS
}) as unknown as OsClient
