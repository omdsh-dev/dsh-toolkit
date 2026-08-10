/**
 * 验证内核 —— 递归/迭代的 JSON Schema 验证 + action 共用的 preflight。
 *
 * 设计文档 §5：
 * - 错误同时提供 instancePath / schemaPath（RFC 6901 JSON Pointer）；
 * - 所有对象访问使用 Object.hasOwn，`__proto__`/`constructor`/`prototype`
 *   不会产生原型链误判；
 * - 错误排序稳定：instancePath 字典序 → schemaPath 字典序 → keyword 字典序；
 * - 数字语义：JSON number 必须有限；integer 用 Number.isInteger；multipleOf
 *   使用缩放/容差策略（见 isMultipleOf）；
 * - 字符串长度按 Unicode code point 计（不按 UTF-16 code unit）；
 * - pattern 在 worker 内共享总预算执行（见 pattern-worker.ts）；
 * - 本地 `$ref` 动态检测：引用链最大 64，纯 `$ref` 环通过
 *   (schemaNodeIdentity, instanceIdentity) 栈检测报 ref-cycle。
 *
 * 组合关键字（allOf/anyOf/oneOf/not）见 combinators.ts；anyOf/oneOf/not 的
 * 判定依赖 pattern 结果，因此以 deferred finalizer 形式在 pattern 阶段之后结算。
 */
import { type PatternCheck } from './pattern-worker.ts';
import type { SchemaIssue, ValidationError } from './types.ts';
export interface ValidateOptions {
    maxErrors: number;
    strictSchema: boolean;
    /** pattern 总预算（ms）；测试可传小值以加速超时用例。 */
    patternBudgetMs?: number;
}
export interface CoreValidateResult {
    complete: boolean;
    valid: boolean | null;
    supportedSubsetValid: boolean | null;
    errors: ValidationError[];
    schemaIssues: SchemaIssue[];
    checkedNodes: number;
    truncated: boolean;
}
export interface PreflightResult {
    /** data 是否通过 json-guard（JSON-compatible、大小/深度/节点/cycle）。 */
    dataOk: boolean;
    /** schema 是否通过 json-guard。 */
    schemaOk: boolean;
    dataError: ValidationError | undefined;
    schemaIssues: SchemaIssue[];
    nodePaths: WeakMap<object, string>;
    validPatterns: Set<string>;
}
/** 错误缓冲：主缓冲（maxErrors）与分支缓冲（MAX_BRANCH_ERRORS）共用。 */
export interface ErrorBuffer {
    errors: ValidationError[];
    cap: number;
    truncated: boolean;
}
/** 入队待 worker 执行的 pattern 检查（owner 指向错误归属缓冲，worker 端忽略）。 */
export interface QueuedPatternCheck extends PatternCheck {
    owner: ErrorBuffer;
}
export interface WalkState {
    checkedNodes: number;
    stopped: boolean;
    patternChecks: QueuedPatternCheck[];
    nextPatternId: number;
    patternCount: number;
    deferred: Array<{
        run(): void;
    }>;
    refStack: Array<{
        schema: object;
        instance: unknown;
    }>;
    /** 主错误缓冲（cap = maxErrors）；分支缓冲满只截断该分支，主缓冲满才停止整个遍历。 */
    main: ErrorBuffer;
}
export interface WalkCtx {
    root: unknown;
    buf: ErrorBuffer;
    validPatterns: Set<string>;
    nodePaths: WeakMap<object, string>;
    state: WalkState;
    validateNode: (ctx: WalkCtx, schema: unknown, instance: unknown, instancePath: string, schemaPath: string) => void;
}
/** 把错误推入缓冲；缓冲已满则置 truncated 并返回 false。 */
export declare function pushError(buf: ErrorBuffer, err: ValidationError): boolean;
/** 稳定错误排序：instancePath → schemaPath → keyword（字典序）。 */
export declare function compareErrors(a: ValidationError, b: ValidationError): number;
/** 结构相等（JSON Schema enum/const/uniqueItems 语义；对象键集合 + 值递归）。 */
export declare function deepEqual(a: unknown, b: unknown): boolean;
/**
 * multipleOf：不使用 `% === 0`（浮点误差）。使用缩放/容差策略：
 * q = value / divisor，n = round(q)，当 |q - n| 相对容差内视为倍数。
 *
 * 实现限制（设计文档 §5.4 要求记录）：不承诺任意精度 JSON number；极端浮点数
 * （如 1e308 与极小 divisor 导致 q 溢出为 Infinity）返回一致的可测试结果
 * （非倍数，因为 diff 为 NaN）。
 */
export declare function isMultipleOf(value: number, divisor: number): boolean;
/** 组合分支评估：独立错误缓冲（≤ MAX_BRANCH_ERRORS），共享 state。 */
export declare function evalBranch(ctx: WalkCtx, schema: unknown, instance: unknown, ip: string, sp: string): ErrorBuffer;
/**
 * 核心递归验证。schema 为 boolean 或对象；未知关键字忽略（schema-check 已
 * 报告 unsupported-keyword；strictSchema=false 的 subset 模式继续处理已支持部分）。
 */
export declare function validateNode(ctx: WalkCtx, schema: unknown, instance: unknown, ip: string, sp: string): void;
/** 预检查（data/schema 守卫 + schema 关键字检查）；validateCore 与 normalize 共用。 */
export declare function preflight(data: unknown, schema: unknown): PreflightResult;
/** 完整验证（validate action 的核心；paths/normalize 复用）。 */
export declare function validateCore(data: unknown, schema: unknown, opts: ValidateOptions): Promise<CoreValidateResult>;
