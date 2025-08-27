import { Client } from "@opensearch-project/opensearch"

const OS_HOST = process.env.OS_HOST || "https://localhost:9200"
const OS_USER = process.env.OS_USER || "admin"
const OS_PASS = process.env.OS_PASS || ""

// Define the interface we actually use (subset of OpenSearch Client)
export interface OsClient {
    bulk(args: { body: string } | any): Promise<any>
    mget(args: { index: string, body: { ids: string[] } } | any): Promise<any>
    index(args: any): Promise<any>
    update(args: any): Promise<any>
    get(args: any): Promise<any>
}

// Production client
export const os: OsClient = new Client({
    node: OS_HOST,
    auth: { username: OS_USER, password: OS_PASS },
    ssl: { rejectUnauthorized: false }, // dev: self-signed TLS
})