import { describe, it, expect } from 'vitest'
import { mmrDiversify } from './retriever'

// Helper: L2-normalize a vector
function normalize(v: number[]): number[] {
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0))
    return norm === 0 ? v : v.map(x => x / norm)
}

// Direct dot product for test
function dotProduct(a: number[], b: number[]): number {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0
    let sum = 0
    for (let i = 0; i < a.length; i++) sum += (a[i] ?? 0) * (b[i] ?? 0)
    return sum
}

describe('dotProduct', () => {
    it('computes correct dot product for normalized vectors', () => {
        const a: number[] = normalize([1, 2, 2])
        const b: number[] = normalize([2, 0, 1])
        const expected = dotProduct(a, b)
        // Should match manual calculation
        expect(expected).toBeCloseTo((a[0] ?? 0)*(b[0] ?? 0) + (a[1] ?? 0)*(b[1] ?? 0) + (a[2] ?? 0)*(b[2] ?? 0), 8)
    })
})

describe('mmrDiversify', () => {
    const v1: number[] = normalize([1, 0, 0])
    const v2: number[] = normalize([0, 1, 0])
    const v3: number[] = normalize([0, 0, 1])
    const v4: number[] = normalize([1, 1, 0])
    const candidates: { id: string; qSim: number; embedding: number[] }[] = [
        { id: 'A', qSim: 0.9, embedding: v1 },
        { id: 'B', qSim: 0.8, embedding: v2 },
        { id: 'C', qSim: 0.7, embedding: v3 },
        { id: 'D', qSim: 0.6, embedding: v4 },
    ]

    it('selects highest relevance first (lambda=1)', () => {
        const out = mmrDiversify(candidates, 2, 1)
        expect(out.map((x: {id: string}) => x.id)).toEqual(['A', 'B'])
    })

    it('selects most diverse after first (lambda=0)', () => {
        const out = mmrDiversify(candidates, 2, 0)
        // v1 and v2 and v3 are all orthogonal to v1, so either B or C is valid
        expect(out[0]?.id).toBe('A')
        expect(['B', 'C']).toContain(out[1]?.id)
    })

    it('balances relevance and diversity (lambda=0.5)', () => {
        const out = mmrDiversify(candidates, 3, 0.5)
        // Should start with A, then pick B or C (both orthogonal to A), then D (closest to A+B)
    expect(out[0]?.id).toBe('A')
        expect(out.length).toBe(3)
        expect(new Set(out.map((x: {id: string}) => x.id)).size).toBe(3)
    })

    it('handles k > candidates', () => {
        const out = mmrDiversify(candidates, 10, 0.7)
        expect(out.length).toBe(4)
    })

    it('returns empty for empty input', () => {
        const out = mmrDiversify([], 3, 0.7)
        expect(out).toEqual([])
    })
})
