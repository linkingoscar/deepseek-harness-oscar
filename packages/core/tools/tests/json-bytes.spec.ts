import { describe, expect, it } from 'vitest'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import { jsonValueBytes, jsonValueBytesUpTo } from '../src/json-bytes.ts'

describe('jsonValueBytes', () => {
  it('matches exact UTF-8 JSON serialization for strings, escaping, and containers', () => {
    for (const value of [
      '€',
      '😀',
      '"\\\n',
      { euro: '€', emoji: '😀', nested: [true, null, 12.5] },
    ] satisfies JsonValue[]) {
      expect(jsonValueBytes(value)).toBe(Buffer.byteLength(JSON.stringify(value), 'utf8'))
    }
  })

  it('stays iterative for deeply nested canonical values', () => {
    let value: JsonValue = '😀'
    for (let depth = 0; depth < 5_000; depth++) value = [value]
    expect(jsonValueBytes(value)).toBe(10_006)
  })

  it('reports the exact boundary without materializing an oversized serialization', () => {
    expect(jsonValueBytesUpTo('€', 5)).toBe(5)
    expect(jsonValueBytesUpTo('€', 4)).toBeUndefined()
  })
})
