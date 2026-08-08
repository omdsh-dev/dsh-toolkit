/**
 * UTF-8 字节长度 —— 零依赖（不依赖 Buffer/TextEncoder，保持无 node types 构建）。
 */
export function utf8ByteLength(text: string): number {
  let bytes = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code < 0x80) {
      bytes += 1
    } else if (code < 0x800) {
      bytes += 2
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4 // surrogate pair → 4 字节
        i++
      } else {
        bytes += 3 // 孤立高代理项
      }
    } else {
      bytes += 3
    }
  }
  return bytes
}
