// Function signatures (kept minimal to avoid coupling to modules)
export type FetcherParams = {
    limit: number
    skip: number
    ingredient?: string
    route?: string
    updatedSince?: string
}

export type FetcherPage<TLabel = any> = {
    results: TLabel[]
    total: number
    skip: number
    limit: number
    nextSkip: number | null
}

export type Fetcher = (p: FetcherParams) => Promise<FetcherPage>

export type Chunker = (labels: any[]) => Promise<Chunk[]>
export type Chunk = { section: string; text: string; idx: number }

export type Embedder = {
    embedDocuments(texts: string[]): Promise<number[][]>
}

// Minimal OpenSearch surface used across libs/tests.
// Keep methods optional so different call sites can satisfy it.
export interface OsLike {
    bulk(args: { body: string } | any): Promise<any>
    mget(args: { index: string; body: { ids: string[] } } | any): Promise<any>
    search(args: any): Promise<any>
    index(args: any): Promise<any>
    update(args: any): Promise<any>
    get(args: any): Promise<any>
    count(args: any): Promise<any>
    indices?: {
        create?(args: any): Promise<any>
        delete?(args: any): Promise<any>
    }
}
