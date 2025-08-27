import { vi, type Mock } from 'vitest'

const DBG = process.env.TEST_DEBUG === '1'
function dbgLog(msg: string, arg?: any) {
    if (!DBG) return
    try {
        const size = typeof arg?.body === 'string' ? arg.body.length : JSON.stringify(arg ?? {}).length
        console.log(`[mockOs] ${msg} size=${size}`)
        if (typeof arg?.body === 'string' && DBG) {
            console.log(`[mockOs] body[0..200]=${arg.body.slice(0, 200).replace(/\n/g, '\\n')}`)
        }
    } catch { /* ignore */ }
}

// Define a type for the mock client with Vitest mock methods
export type MockOsClient = {
    bulk: Mock
    mget: Mock
    search: Mock
    index: Mock
    update: Mock
    get: Mock
}

export function createMockOsClient(): MockOsClient {
    return {
        bulk: vi.fn(async (arg: any) => {
            dbgLog('bulk()', arg)
            return { body: { errors: false, items: [] } }
        }),
        mget: vi.fn(async (arg: any) => {
            dbgLog('mget()', arg)
            return { body: { docs: [] } }
        }),
        search: vi.fn(async (arg: any) => {
            dbgLog('search()', arg)
            return { body: { hits: { hits: [] } } }
        }),
        index: vi.fn(async (arg: any) => {
            dbgLog('index()', arg)
            return {}
        }),
        update: vi.fn(async (arg: any) => {
            dbgLog('update()', arg)
            return {}
        }),
        get: vi.fn(async (arg: any) => {
            dbgLog('get()', arg)
            return { body: { _source: {} } }
        }),
    }
}
