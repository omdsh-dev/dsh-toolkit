/**
 * 组合关键字 —— allOf / anyOf / oneOf / not。
 *
 * 设计文档 §5.3：
 * - allOf：所有分支都必须通过，输出各失败分支的错误（直接进入当前缓冲，
 *   schemaPath 位于 `#/allOf/<i>/...`）；
 * - anyOf：至少一支通过；全部失败时，返回顶层 `anyOf` 错误，并在 `branches`
 *   中给每支有限摘要（≤ MAX_BRANCH_ERRORS 条）；
 * - oneOf：恰好一支通过；0 支与多支通过分别报告（one-of / one-of-multiple）；
 * - not：子 schema 通过时失败。
 *
 * 分支判定依赖 pattern 结果（pattern 在 worker 内批量结算），因此 anyOf/oneOf/
 * not 的父级错误以 deferred finalizer 形式注册：pattern 阶段之后按注册顺序
 * （先内后外）结算，保证嵌套组合的正确性。
 */
import { type WalkCtx } from './validator.ts';
/** allOf：各失败分支的错误直接进入当前缓冲。 */
export declare function checkAllOf(ctx: WalkCtx, branches: unknown[], instance: unknown, ip: string, sp: string): void;
/** anyOf：至少一支通过；全部失败时输出顶层错误 + 有限分支摘要。 */
export declare function checkAnyOf(ctx: WalkCtx, branches: unknown[], instance: unknown, ip: string, sp: string): void;
/** oneOf：恰好一支通过；0 支 → one-of；多支 → one-of-multiple。 */
export declare function checkOneOf(ctx: WalkCtx, branches: unknown[], instance: unknown, ip: string, sp: string): void;
/** not：子 schema 通过时失败（子 schema 的失败细节不输出）。 */
export declare function checkNot(ctx: WalkCtx, sub: unknown, instance: unknown, ip: string, sp: string): void;
