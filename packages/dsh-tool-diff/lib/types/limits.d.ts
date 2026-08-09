/**
 * 统一复杂度预算 —— 所有 action 在入口统一执行上限检查（超硬限报错不截断）。
 */
export declare const MAX_INPUT_BYTES: number;
export declare const MAX_OUTPUT_BYTES: number;
export declare const MAX_CHANGES = 10000;
export declare const DEFAULT_MAX_CHANGES = 1000;
export declare const MAX_LINES = 50000;
export declare const MAX_JSON_DEPTH = 64;
export declare const MAX_CSV_ROWS = 50000;
export declare const MAX_CSV_COLUMNS = 512;
/** UTF-8 字节数（零依赖，不用 Buffer）。 */
export declare function utf8ByteLength(text: string): number;
/** 校验输入字节数；超限抛 diff: 错误。 */
export declare function assertInputSize(text: string, label: string): void;
/**
 * 校验文本为合法 Unicode（无孤立 surrogate，D-11 修复）。
 * 孤立 surrogate 既不是合法 UTF-8，也会在后续序列化/截断中产生不一致。
 */
export declare function assertWellFormedText(text: string, label: string): void;
/** 校验输出字节数；超限抛 diff: 错误（不静默截断输出——变更列表截断走 maxChanges）。 */
export declare function assertOutputSize(text: string): void;
/** 规范化 maxChanges：非法值回退默认；超硬顶钳制到硬顶。 */
export declare function normalizeMaxChanges(maxChanges: unknown): number;
/** 规范化 context：0..20，非法回退 3。 */
export declare function normalizeContext(context: unknown): number;
