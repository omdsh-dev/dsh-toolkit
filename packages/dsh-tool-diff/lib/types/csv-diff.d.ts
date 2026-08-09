/**
 * CSV 结构化 diff —— 零依赖，纯函数。
 *
 * - RFC4180 风格解析（引号包裹、"" 转义、CRLF/LF、带引号字段内换行、BOM 忽略）；
 * - 双模式：
 *   - keyed：首行表头 + 指定 key 列（列名或 1-based 索引）——按 key 匹配行；
 *   - positional：未提供 key —— 按行号位置比较，报告中 mode 注明；
 * - 重复 key 不静默覆盖：放入 duplicateKeys 且 equal=false；
 * - 列集合变化单独报告 addedColumns / removedColumns；缺失列值统一为 null；
 * - 行顺序默认不影响 keyed 结果。
 */
export interface CsvRow {
    /** 数据行号（1-based，不含表头行号语义，仅定位用） */
    line: number;
    cells: string[];
}
export interface CsvChangeEntry {
    column: string;
    before?: string | null;
    after?: string | null;
}
export interface CsvReport {
    mode: 'keyed' | 'positional';
    key?: string;
    columns?: string[];
    equal: boolean;
    addedRows: Array<Record<string, unknown>>;
    removedRows: Array<Record<string, unknown>>;
    changedRows: Array<{
        key: string;
        changes: CsvChangeEntry[];
    }>;
    duplicateKeys: string[];
    addedColumns: string[];
    removedColumns: string[];
    truncated?: boolean;
}
export interface CsvParseResult {
    header: string[] | null;
    rows: CsvRow[];
}
/** 解析 CSV 文本（RFC4180 风格，支持自定义分隔符）。返回表头（若多行）与数据行。 */
export declare function parseCsv(text: string, delimiter?: string): CsvParseResult;
export interface CsvDiffOptions {
    /** key 列名（表头模式）或 1-based 列序号；缺省 → positional 模式 */
    key?: string;
    delimiter?: string;
    ignoreCase?: boolean;
    ignoreWhitespace?: boolean;
}
export declare function csvDiff(beforeText: string, afterText: string, options?: CsvDiffOptions): CsvReport;
