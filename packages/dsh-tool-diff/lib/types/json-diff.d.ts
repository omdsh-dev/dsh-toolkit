/**
 * JSON 结构化 diff —— 零依赖，纯函数。
 *
 * - 递归比较：标量直接比（可选 ignoreCase）；对象按 key（可选排序）
 *   输出 `$` 风格路径变更（`$.user.name`、`$.items[0]`、特殊键 `$['a.b']`）；
 *   数组按 index 比较；
 * - sortKeys 默认 true：变更列表按路径排序，输出可复现；
 * - 深度/体积预算：超过 MAX_JSON_DEPTH 或输入超限抛错（由 index.ts 转成工具错误）。
 */
export interface JsonChange {
    path: string;
    /** 输出用字段名 op */
    kind: 'add' | 'remove' | 'replace';
    before?: unknown;
    after?: unknown;
}
export interface JsonDiffOptions {
    ignoreCase?: boolean;
    sortKeys?: boolean;
    maxDepth?: number;
}
export declare function jsonDiff(beforeJson: unknown, afterJson: unknown, options?: JsonDiffOptions): JsonChange[];
/**
 * 扫描同一对象内重复键名（D-10 修复）：JSON.parse 会静默取最后值，
 * 这里用 O(n) 状态机在 parse 前记录重复键，随输出报告，不让结构化 diff 静默丢信息。
 */
export declare function scanDuplicateKeys(text: string): string[];
/**
 * 扫描原始 JSON 文本的最大嵌套深度（跳过字符串字面量，O(n) 非递归）。
 * 用于在 JSON.parse 之前拦截超深输入（防调用栈溢出与超时）。
 */
export declare function scanJsonDepth(text: string): number;
export declare function jsonDiffText(beforeText: string, afterText: string, options?: JsonDiffOptions): {
    changes: JsonChange[];
    beforeParsed: unknown;
    afterParsed: unknown;
    duplicateKeys: {
        before: string[];
        after: string[];
    };
};
