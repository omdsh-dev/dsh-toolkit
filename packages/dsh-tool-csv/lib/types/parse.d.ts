/**
 * RFC 4180 CSV 状态机解析器 —— 零依赖，纯函数，单遍扫描 O(n)。
 *
 * 边界处理：
 * - 引号只在字段开头生效（`"` 前有内容则按字面量处理，与多数 CSV 库一致）
 * - 引号内逗号/换行/CRLF 视为字段内容；`""` 转义为单个 `"`
 * - CRLF 归一化：`\r\n` 记一行，单独 `\r` 也记一行
 * - 首行 UTF-8 BOM（U+FEFF）剥离
 * - 全空字段的行（空行）跳过，不产生记录（与 pandas skip_blank_lines 语义一致），
 *   计数通过 ParseResult.skippedBlank 返回（供 stats 动作报告空行数）
 * - 输入超过 MAX_INPUT_BYTES 直接拒绝（不截断——截断会产生错误数据）
 *
 * 与设计文档的唯一偏差：parseCsv 返回 { rows, skippedBlank } 而非裸 string[][]，
 * 以携带空行计数；rows 语义与文档完全一致。
 */
export interface ParseOptions {
    /** 字段分隔符，单字符（"tab" 在调用层已归一为 "\t"）。 */
    delimiter: string;
    /** 是否把首行当表头（解析层不消费该字段，由调用方决定如何映射）。 */
    header: boolean;
}
export interface ParseResult {
    /** 解析出的字符串网格（空行已被跳过）。 */
    rows: string[][];
    /** 跳过的全空行数（供 stats 报告空行数）。 */
    skippedBlank: number;
}
export declare const MAX_INPUT_BYTES = 256000;
/** 校验分隔符：单 UTF-16 code unit 或 "tab"；拒绝 surrogate pair 与控制字符（除 \t）。 */
export declare function normalizeDelimiter(delimiter: unknown): string;
/** 解析 CSV 文本为字符串网格；跳过空行；BOM 剥离；输入字节上限检查；严格引号校验。 */
export declare function parseCsv(text: unknown, options: ParseOptions): ParseResult;
