/**
 * 本地 `$ref` / JSON Pointer —— 仅支持 `#` 与 `#/$defs/<escaped-token>...`。
 *
 * 设计文档 §5.6：
 * - 使用 RFC 6901 token 解码（`~1` → `/`，`~0` → `~`，先处理 `~1` 再 `~0`）；
 * - 禁止外部 URI、绝对路径和相对文件路径；
 * - 解析后节点必须存在；
 * - 引用链最大 64；纯 `$ref` 环必须报 `ref-cycle`（静态检测在 schema-check，
 *   动态兜底在 validator 的 (schemaNode, instance) 栈检测）。
 *
 * 安全属性：全部对象访问使用 Object.hasOwn，`__proto__`/`constructor` 等键
 * 只能作为普通 JSON 键命中，绝不上溯原型链。
 */
export interface ParsedRef {
    ok: true;
    /** 解码后的 token 序列（`#` 为空数组）。 */
    tokens: string[];
}
export interface RefParseFailure {
    ok: false;
    code: 'ref-invalid';
    message: string;
}
export type ParseRefResult = ParsedRef | RefParseFailure;
/** RFC 6901 token 解码；非法转义（`~` 后非 0/1）返回 null。 */
export declare function unescapeToken(token: string): string | null;
/**
 * 解析 `$ref` 字符串。只接受 `#` 与 `#/...`；`#foo`（anchor 形式）、
 * 非 `#` 开头（远程/绝对/相对路径）一律拒绝。
 */
export declare function parseRef(ref: string): ParseRefResult;
export interface ResolvedRef {
    ok: true;
    value: unknown;
}
export interface RefResolveFailure {
    ok: false;
    code: 'ref-invalid' | 'ref-missing';
    message: string;
}
export type ResolveRefResult = ResolvedRef | RefResolveFailure;
/**
 * 在 schema 根中解析本地 `$ref`。仅允许 `#` 与 `#/$defs/<token>...`；
 * 第一个 token 必须为 `$defs`，否则视为非法引用形式。
 */
export declare function resolveRef(root: unknown, ref: string): ResolveRefResult;
