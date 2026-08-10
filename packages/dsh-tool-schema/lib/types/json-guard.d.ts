/**
 * JSON 守卫 —— 带 cycle 检测的迭代遍历，同时统计估算 UTF-8 字节、嵌套深度与
 * 节点数，并校验值是否 JSON-compatible。
 *
 * 设计文档 §8：JSON value 可能以已解析对象传入，不能只检查 JSON.stringify 后
 * 的大小；需要带 cycle 检测的迭代遍历，同时统计节点、深度和估算 UTF-8 字节。
 * 虽然 DSH canonical JSON 理论上排除 cycle，独立核心函数仍应防御直接调用。
 *
 * 安全属性：
 * - 只接受 plain object（原型为 null 或 Object.prototype）、数组与 JSON 基本类型；
 *   类实例 / Date / Map / Set / 函数 / symbol / bigint / undefined / NaN / Infinity
 *   均视为非 JSON（cycle 也在此报告）。
 * - 所有对象访问使用 Object.hasOwn，`__proto__`/`constructor`/`prototype` 不会
 *   产生原型链误判。
 */
export interface GuardOptions {
    /** 估算 UTF-8 字节上限。 */
    maxBytes: number;
    /** 最大嵌套深度。 */
    maxDepth: number;
    /** 最大节点数（去重后的对象/数组节点）。 */
    maxNodes: number;
    /** 诊断标签：'data' | 'schema'。 */
    label: string;
}
export interface GuardFailure {
    /** 问题节点相对根的 RFC 6901 JSON Pointer。 */
    path: string;
    code: string;
    message: string;
}
export interface GuardResult {
    ok: boolean;
    nodes: number;
    depth: number;
    bytes: number;
    failure?: GuardFailure;
}
/** plain object 判定：原型为 null 或 Object.prototype（不接收数组）。 */
export declare function isJsonRecord(value: unknown): value is Record<string, unknown>;
/**
 * 校验值并统计。遇第一个问题即返回（ok=false + failure）。
 */
export declare function checkJsonValue(value: unknown, opts: GuardOptions): GuardResult;
/** RFC 6901 指针 token 转义：`~` → `~0`，`/` → `~1`。 */
export declare function escapeToken(token: string): string;
/** 仅做 JSON-compatible 判定（无大小/深度限制；含 cycle 检测）。 */
export declare function isJsonCompatible(value: unknown): boolean;
