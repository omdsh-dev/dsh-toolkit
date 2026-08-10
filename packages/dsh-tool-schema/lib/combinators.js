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
import { compareErrors, evalBranch, pushError } from "./validator.js";
function summarize(buf) {
    return [...buf.errors].sort(compareErrors);
}
function branchSummaries(buffers) {
    return buffers.map((b, i) => ({ branch: i, errors: summarize(b) }));
}
/** allOf：各失败分支的错误直接进入当前缓冲。 */
export function checkAllOf(ctx, branches, instance, ip, sp) {
    branches.forEach((branch, i) => {
        ctx.validateNode(ctx, branch, instance, ip, `${sp}/allOf/${i}`);
    });
}
/** anyOf：至少一支通过；全部失败时输出顶层错误 + 有限分支摘要。 */
export function checkAnyOf(ctx, branches, instance, ip, sp) {
    const bufs = branches.map((branch, i) => evalBranch(ctx, branch, instance, ip, `${sp}/anyOf/${i}`));
    ctx.state.deferred.push({
        run() {
            const allFailed = bufs.every((b) => b.errors.length > 0);
            if (!allFailed)
                return;
            pushError(ctx.buf, {
                instancePath: ip,
                schemaPath: `${sp}/anyOf`,
                keyword: 'anyOf',
                code: 'any-of',
                message: `no branch matched (${branches.length} of ${branches.length} failed)`,
                branches: branchSummaries(bufs),
            });
        },
    });
}
/** oneOf：恰好一支通过；0 支 → one-of；多支 → one-of-multiple。 */
export function checkOneOf(ctx, branches, instance, ip, sp) {
    const bufs = branches.map((branch, i) => evalBranch(ctx, branch, instance, ip, `${sp}/oneOf/${i}`));
    ctx.state.deferred.push({
        run() {
            const matched = [];
            bufs.forEach((b, i) => {
                if (b.errors.length === 0)
                    matched.push(i);
            });
            if (matched.length === 1)
                return;
            if (matched.length === 0) {
                pushError(ctx.buf, {
                    instancePath: ip,
                    schemaPath: `${sp}/oneOf`,
                    keyword: 'oneOf',
                    code: 'one-of',
                    message: `no branch matched (${branches.length} of ${branches.length} failed)`,
                    branches: branchSummaries(bufs),
                });
            }
            else {
                pushError(ctx.buf, {
                    instancePath: ip,
                    schemaPath: `${sp}/oneOf`,
                    keyword: 'oneOf',
                    code: 'one-of-multiple',
                    message: `more than one branch matched (${matched.length})`,
                    matchedBranches: matched,
                });
            }
        },
    });
}
/** not：子 schema 通过时失败（子 schema 的失败细节不输出）。 */
export function checkNot(ctx, sub, instance, ip, sp) {
    const buf = evalBranch(ctx, sub, instance, ip, `${sp}/not`);
    ctx.state.deferred.push({
        run() {
            if (buf.errors.length === 0) {
                pushError(ctx.buf, {
                    instancePath: ip,
                    schemaPath: `${sp}/not`,
                    keyword: 'not',
                    code: 'not',
                    message: 'instance must not match the "not" schema',
                });
            }
        },
    });
}
