/**
 * JMESPath-inspired 路径查询解析器 + 执行器 —— 零依赖，纯函数。
 *
 * 语法：点号访问 (foo.bar) | 方括号索引 (items[0]) | 方括号属性
 * (items['key'] | items["key"]，支持 \\ \' \" 转义) | 数组通配符投影 (items[*].name)
 *
 * 安全：无 eval/new Function；Object.hasOwn 防原型链；
 * 深度上限 20 层；查询长度上限 200；输入 1 MB 字节（对象/字符串统一累计）；投影元素上限 100k（含无尾路径）。
 *
 * 错误分类（审查 JSON-02）：JsonQueryError.code =
 *   MISSING_PROPERTY（投影时跳过）| TYPE_MISMATCH | INDEX_OUT_OF_BOUNDS | INVALID_QUERY
 * 通配符投影只吞 MISSING_PROPERTY，其余错误重新抛出。
 */
export type JsonQueryErrorCode = 'MISSING_PROPERTY' | 'TYPE_MISMATCH' | 'INDEX_OUT_OF_BOUNDS' | 'INVALID_QUERY';
export declare class JsonQueryError extends Error {
    readonly code: JsonQueryErrorCode;
    constructor(code: JsonQueryErrorCode, message: string);
}
export declare function normalizeInput(input: unknown): unknown;
export declare function query(jsonInput: unknown, queryStr: unknown): unknown;
