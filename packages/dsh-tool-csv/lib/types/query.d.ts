/**
 * CSV 查询 / 统计 / JSON 映射 —— 零依赖，纯函数。
 *
 * - queryRows：按列名或 1-based 索引精确匹配过滤（严格 ===，非子串）；
 *   结果包含表头行（如果存在），保证可被 parse 回读。
 * - statsGrid：行数 / 列数 / 列名 / 空行数 / 警告（字段数不一致、重复列名）。
 * - toJsonRows：网格 → JSON（header=true 时每行一个对象：缺失字段补 null、
 *   多余字段并入最后一个字段；header=false 时每行一个数组）。
 */
export interface QueryOptions {
    /** 列名（header=true 时）或 1-based 索引字符串，如 "2"。 */
    column: string;
    /** 精确匹配值。 */
    value: string;
    header: boolean;
    limit: number;
}
export interface QueryResult {
    /** 过滤后的行（header=true 时首行为表头）。 */
    rows: string[][];
    /** 列名数组（header=false 时为 ["1","2",...] 形式的索引字符串）。 */
    columns: string[];
}
export interface Stats {
    /** 数据行数（header=true 时不含表头行）。 */
    rows: number;
    /** 最大列宽。 */
    columns: number;
    /** 列名列表（header=true 时为首行；header=false 时为 null）。 */
    columnNames: string[] | null;
    /** 解析时跳过的全空行数。 */
    emptyRows: number;
    /** 聚合警告：字段数不一致 / 重复列名。 */
    warnings: string[];
}
/** 规范化 limit：非法值（undefined/null/非有限/负数/0/小数）回退到默认 100。 */
export declare function normalizeLimit(limit: unknown): number;
/** 按列精确匹配过滤；返回 [结果行, 列名数组]。 */
export declare function queryRows(grid: string[][], options: QueryOptions): QueryResult;
/** 统计：行数 / 列数 / 列名 / 空行数 / 聚合警告。 */
export declare function statsGrid(grid: string[][], header: boolean, emptyRows: number): Stats;
/** 网格 → JSON 值（header=true 时对象数组；header=false 时数组数组）。 */
export declare function toJsonRows(grid: string[][], header: boolean, delimiter: string, limit: unknown): unknown;
