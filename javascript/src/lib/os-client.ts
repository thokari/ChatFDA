import { Client } from "@opensearch-project/opensearch"
import type { OsLike } from "./types.js"
// Optional AWS SigV4 support for public AWS OpenSearch
// We import lazily to avoid requiring AWS deps in non-AWS setups.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { AwsSigv4Signer } from "@opensearch-project/opensearch/aws"
import { defaultProvider as awsDefaultCreds } from "@aws-sdk/credential-provider-node"

// Concrete client type = the minimal surface we use
export type OsClient = OsLike

export function osClientFromEnv(): OsClient {
    const node = process.env.OS_HOST || "https://localhost:9200"
    const insecure = process.env.OS_INSECURE_TLS === "1" || process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0"
    const useAws = (process.env.OS_SIGNING || "").toLowerCase() === "aws"

    if (useAws) {
        const region = process.env.OS_AWS_REGION || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1"
        return new Client({
            ...(AwsSigv4Signer({
                region,
                service: "es",
                getCredentials: awsDefaultCreds(),
            }) as any),
            node,
            ssl: { rejectUnauthorized: insecure ? false : true },
        }) as unknown as OsClient
    }

    const username = process.env.OS_USER || "admin"
    const password = process.env.OS_PASS || ""
    return new Client({
        node,
        auth: { username, password },
        ssl: { rejectUnauthorized: insecure ? false : true },
    }) as unknown as OsClient
}
