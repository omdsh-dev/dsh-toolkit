/**
 * UTF-8 字节长度 —— 零依赖（不依赖 Buffer/TextEncoder，保持无 node types 构建）。
 */
export declare function utf8ByteLength(text: string): number;
