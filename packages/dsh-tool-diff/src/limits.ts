/**
 * 统一复杂度预算 —— 所有 action 在入口统一执行上限检查（超硬限报错不截断）。
 */

export const MAX_INPUT_BYTES = 256 * 1024
export const MAX_OUTPUT_BYTES = 64 * 1024
export const MAX_CHANGES = 10_000
export const DEFAULT_MAX_CHANGES = 1_000
export const MAX_LINES = 50_000
export const MAX_JSON_DEPTH = 64
export const MAX_CSV_ROWS = 50_000
export const MAX_CSV_COLUMNS = 512

/** UTF-8 字节数（零依赖，不用 Buffer）。 */
export function utf8ByteLength(text: string): number {
  let bytes = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) { bytes += 4; i++ } else bytes += 3
    } else bytes += 3
  }
  return bytes
}

/** 校验输入字节数；超限抛 diff: 错误。 */
export function assertInputSize(text: string, label: string): void {
  if (utf8ByteLength(text) > MAX_INPUT_BYTES) {
    throw new Error(`diff: ${label} exceeds ${MAX_INPUT_BYTES} bytes`)
  }
}

/**
 * 校验文本为合法 Unicode（无孤立 surrogate，D-11 修复）。
 * 孤立 surrogate 既不是合法 UTF-8，也会在后续序列化/截断中产生不一致。
 */
export function assertWellFormedText(text: string, label: string): void {
  if (!text.isWellFormed()) {
    throw new Error(`diff: ${label} contains invalid Unicode (isolated surrogate)`)
  }
}

/** 校验输出字节数；超限抛 diff: 错误（不静默截断输出——变更列表截断走 maxChanges）。 */
export function assertOutputSize(text: string): void {
  if (utf8ByteLength(text) > MAX_OUTPUT_BYTES) {
    throw new Error(`diff: output exceeds ${MAX_OUTPUT_BYTES} bytes`)
  }
}

/** 规范化 maxChanges：非法值回退默认；超硬顶钳制到硬顶。 */
export function normalizeMaxChanges(maxChanges: unknown): number {
  if (typeof maxChanges !== 'number' || !Number.isFinite(maxChanges) || maxChanges < 1) {
    return DEFAULT_MAX_CHANGES
  }
  return Math.min(Math.floor(maxChanges), MAX_CHANGES)
}

/** 规范化 context：0..20，非法回退 3。 */
export function normalizeContext(context: unknown): number {
  if (typeof context !== 'number' || !Number.isFinite(context)) return 3
  return Math.min(20, Math.max(0, Math.floor(context)))
}
