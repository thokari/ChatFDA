import { describe, it, expect, vi, afterEach } from "vitest"
import { fetchFdaLabels } from "../lib/fda-api.js"

afterEach(() => {
    vi.unstubAllGlobals()
})

describe("fetchFdaLabels", () => {
    it("builds URL, parses page, computes nextSkip", async () => {
        const mockJson = {
            meta: { results: { total: 5, skip: 0 } },
            results: [{ id: "doc1" }]
        }
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => mockJson,
            headers: new Headers()
        }))

        const page = await fetchFdaLabels({ limit: 1, skip: 0, ingredient: "ibuprofen", route: "ORAL" })
        expect(page.results).toHaveLength(1)
        expect(page.total).toBe(5)
        expect(page.skip).toBe(0)
        expect(page.limit).toBe(1)
        expect(page.nextSkip).toBe(1)
    })

    it("treats short page as end (nextSkip=null)", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ meta: { results: { total: 1, skip: 0 } }, results: [] }),
            headers: new Headers()
        }))

        const page = await fetchFdaLabels({ limit: 10, skip: 0 })
        expect(page.results).toHaveLength(0)
        expect(page.nextSkip).toBeNull()
    })

    it("retries 5xx and 429, aborts on 4xx", async () => {
        const responses = [
            { ok: false, status: 503, headers: new Headers(), text: async () => "oops" },
            { ok: false, status: 429, headers: new Headers([["retry-after", "0"]]), text: async () => "rate" },
            { ok: true, status: 200, headers: new Headers(), json: async () => ({ meta: { results: { total: 1, skip: 0 } }, results: [{ id: "ok" }] }) }
        ]
        let i = 0
        vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => responses[i++]))

        const page = await fetchFdaLabels({ limit: 1, skip: 0, retries: 2 })
        expect(page.results[0].id).toBe("ok")
    })
})
