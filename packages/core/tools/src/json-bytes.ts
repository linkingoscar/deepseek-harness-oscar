/** Exact iterative JSON-byte accounting for host-owned canonical values. */

import type { JsonValue } from '@deepseek-ai/dsh-session'

/** Serialized UTF-8 bytes for one JSON string, including quotes and escaping. */
function jsonStringBytes(text: string): number {
  let bytes = 2
  for (let index = 0; index < text.length;) {
    const codePoint = text.codePointAt(index)
    if (codePoint === undefined) break
    const width = codePoint > 0xffff ? 2 : 1
    if (width === 2) {
      bytes += 4
      index += 2
      continue
    }
    const code = text.charCodeAt(index)
    if (code === 0x22 || code === 0x5c) bytes += 2
    else if (code >= 0xd800 && code <= 0xdfff) bytes += 6
    else if (code < 0x20) bytes += code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d ? 2 : 6
    else bytes += Buffer.byteLength(text[index]!, 'utf8')
    index += 1
  }
  return bytes
}

/**
 * Measure canonical lossless JSON without recursive traversal or materializing
 * the complete serialized value. Returns `undefined` as soon as `maxBytes` is
 * crossed, so the same primitive can later back an admission decision.
 * @param value - Canonical lossless JSON value to measure.
 * @param maxBytes - Largest serialized UTF-8 JSON size the caller can admit.
 * @returns Exact serialized bytes, or `undefined` once the cap is crossed.
 */
export function jsonValueBytesUpTo(value: JsonValue, maxBytes: number): number | undefined {
  type Task =
    | { kind: 'value'; value: JsonValue }
    | { kind: 'array'; value: JsonValue[]; index: number }
    | { kind: 'object'; value: Record<string, JsonValue>; keys: string[]; index: number }

  let bytes = 0
  const add = (cost: number): boolean => {
    bytes += cost
    return bytes <= maxBytes
  }
  const tasks: Task[] = [{ kind: 'value', value }]
  for (let task = tasks.pop(); task !== undefined; task = tasks.pop()) {
    if (task.kind === 'value') {
      const current = task.value
      if (current === null) {
        if (!add(4)) return undefined
      } else if (typeof current === 'string') {
        if (!add(jsonStringBytes(current))) return undefined
      } else if (typeof current === 'number') {
        if (!add(Buffer.byteLength(String(current), 'utf8'))) return undefined
      } else if (typeof current === 'boolean') {
        if (!add(current ? 4 : 5)) return undefined
      } else if (Array.isArray(current)) {
        if (!add(2)) return undefined
        if (current.length > 0) tasks.push({ kind: 'array', value: current, index: 0 })
      } else {
        if (!add(2)) return undefined
        const object = current as Record<string, JsonValue>
        const keys = Object.keys(object)
        if (keys.length > 0) tasks.push({ kind: 'object', value: object, keys, index: 0 })
      }
      continue
    }

    if (task.index > 0 && !add(1)) return undefined
    if (task.kind === 'array') {
      const item = task.value[task.index]
      if (item === undefined) throw new TypeError('canonical JSON array is sparse')
      if (task.index + 1 < task.value.length) tasks.push({ ...task, index: task.index + 1 })
      tasks.push({ kind: 'value', value: item })
      continue
    }

    const key = task.keys[task.index]
    if (key === undefined) throw new TypeError('canonical JSON object frame has no key')
    if (!add(jsonStringBytes(key) + 1)) return undefined
    const item = task.value[key]
    if (item === undefined) throw new TypeError('canonical JSON object has undefined value')
    if (task.index + 1 < task.keys.length) tasks.push({ ...task, index: task.index + 1 })
    tasks.push({ kind: 'value', value: item })
  }
  return bytes
}

/**
 * Exact serialized UTF-8 JSON bytes for one canonical value.
 * @param value - Canonical lossless JSON value to measure.
 * @returns Exact serialized UTF-8 JSON byte length.
 */
export function jsonValueBytes(value: JsonValue): number {
  const measured = jsonValueBytesUpTo(value, Number.MAX_SAFE_INTEGER)
  if (measured === undefined) throw new RangeError('canonical JSON value exceeds safe byte accounting range')
  return measured
}
