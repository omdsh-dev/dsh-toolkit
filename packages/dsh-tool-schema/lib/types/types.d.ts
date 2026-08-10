/**
 * 共享类型定义 —— 验证错误、schema issue、action 输出。
 *
 * 内核不依赖 `@deepseek-ai/dsh-tools` 的 JsonValue：保持零依赖纯函数核心，
 * 由 index.ts 在边界处转换为 DSH canonical JSON。
 */
/** 内核本地的 JSON 值类型（不含非 JSON 值如 undefined/NaN/函数）。 */
export type JsonValue = string | number | boolean | null | JsonValue[] | {
    [key: string]: JsonValue;
};
/** 单个失败的 JSON Schema 验证（branch 摘要内嵌于 anyOf/oneOf 错误）。 */
export interface ValidationError {
    /** RFC 6901 JSON Pointer（例如 `/users/0/name`）。 */
    instancePath: string;
    /** 例如 `#/properties/users/items/properties/name/type`。 */
    schemaPath: string;
    /** 触发失败的关键字。 */
    keyword: string;
    /** 稳定错误码（测试与消费端依赖）。 */
    code: string;
    /** 人读消息。 */
    message: string;
    /** 可选：期望值描述（type / 数值边界等）。 */
    expected?: string | string[];
    /** 可选：实际值描述（type 失败）。 */
    actual?: string;
    /** anyOf/oneOf 全部失败时的有限分支摘要（每支 ≤ MAX_BRANCH_ERRORS 条）。 */
    branches?: BranchSummary[];
    /** oneOf 多分支匹配时的匹配分支下标。 */
    matchedBranches?: number[];
}
/** 组合关键字失败时的单分支有限摘要。 */
export interface BranchSummary {
    branch: number;
    errors: ValidationError[];
}
/** schema 自身的问题（unsupported keyword、结构非法、pattern 非法等）。 */
export interface SchemaIssue {
    schemaPath: string;
    keyword: string;
    code: string;
    message: string;
}
/** normalize 的警告（默认值未应用等；设计文档未规定形状，作为扩展提供）。 */
export interface NormalizeWarning {
    instancePath: string;
    schemaPath: string;
    code: string;
    message: string;
}
/** validate action 的 canonical 输出。 */
export interface ValidateResult {
    action: 'validate';
    /** schema 是否被完整验证（schema issue 或 data 守卫失败时为 false）。 */
    complete: boolean;
    /** 总判定；schema 不完整（strictSchema=false 且有 issue）时为 null。 */
    valid: boolean | null;
    /** 已支持子集的验证判定；strict 失败或守卫失败时为 null。 */
    supportedSubsetValid: boolean | null;
    errors: ValidationError[];
    schemaIssues: SchemaIssue[];
    checkedNodes: number;
    truncated: boolean;
}
/** paths action 的 canonical 输出。 */
export interface PathsResult {
    action: 'paths';
    valid: boolean | null;
    paths: Array<{
        path: string;
        keywords: string[];
    }>;
    errorCount: number;
    truncated: boolean;
}
/** explain action 的约束节点。 */
export interface ExplainNode {
    schemaPath: string;
    summary: string;
}
/** explain action 的 canonical 输出。 */
export interface ExplainResult {
    action: 'explain';
    nodes: ExplainNode[];
    schemaIssues: SchemaIssue[];
    truncated: boolean;
}
/** normalize action 的 canonical 输出。 */
export interface NormalizeResult {
    action: 'normalize';
    complete: boolean;
    valid: boolean | null;
    supportedSubsetValid: boolean | null;
    /** 深拷贝并应用 default 后的结果（新对象均为 null-prototype）。 */
    value: unknown;
    /** 已应用 default 的 instancePath 列表。 */
    appliedDefaults: string[];
    warnings: NormalizeWarning[];
    errors: ValidationError[];
    schemaIssues: SchemaIssue[];
    truncated: boolean;
}
