/**
 * DSH Diff 文本差异工具插件。
 *
 * 注册 `diff` 工具：对两段文本做行级 / 结构化差异对比。
 * 接入方式：在 cordis.yml 追加：
 *   - id: tool-diff
 *     name: '@deepseek-ai/dsh-tool-diff'
 *
 * 安全边界：零依赖、纯函数（不读文件/不联网/不写文件/不调 git）；
 * 输入单侧 256KB 上限、输出 64KB 上限（超限按 maxChanges 与字节预算截断并注明）；
 * Myers diagonal 预算 2000、行数 50K 上限；timeoutMs 2000 兜底。
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { unifiedDiff, lineStats, effectiveOps, splitLines } from './text-diff.js';
import { generatePatch, validatePatch } from './patch.js';
import { jsonDiffText } from './json-diff.js';
import { csvDiff } from './csv-diff.js';
import { markdownDiff } from './markdown-diff.js';
import { MAX_INPUT_BYTES, MAX_OUTPUT_BYTES, utf8ByteLength, normalizeMaxChanges, normalizeContext, assertOutputSize, assertWellFormedText, } from './limits.js';
export const name = '@deepseek-ai/dsh-tool-diff';
export const inject = ['tools'];
function str(v, param) {
    if (typeof v !== 'string')
        throw new Error(`diff: ${param} must be a string`);
    return v;
}
/** 截断长文本（unified diff 等），带标记。 */
function truncateText(text, maxBytes) {
    if (utf8ByteLength(text) <= maxBytes)
        return { text, truncated: false };
    const marker = '\n... [output truncated]';
    const budget = maxBytes - utf8ByteLength(marker);
    let out = '';
    let used = 0;
    for (const ch of text) {
        const cb = utf8ByteLength(ch);
        if (used + cb > budget)
            break;
        out += ch;
        used += cb;
    }
    return { text: out + marker, truncated: true };
}
/**
 * 把 payload 序列化为 JSON；若超过输出预算，二分缩减 changes 数组直到装入，
 * 并置 truncated。payloadFn(n) 返回 changes 全部截为 n 项时的信封对象。
 */
function fitEnvelope(payloadFn, fullCount) {
    const full = JSON.stringify(payloadFn(fullCount));
    if (utf8ByteLength(full) <= MAX_OUTPUT_BYTES)
        return { text: full, truncated: false };
    let lo = 0;
    let hi = fullCount;
    let best = '';
    while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const t = JSON.stringify(payloadFn(mid));
        if (utf8ByteLength(t) <= MAX_OUTPUT_BYTES) {
            best = t;
            lo = mid + 1;
        }
        else {
            hi = mid - 1;
        }
    }
    return { text: best, truncated: true };
}
function runAction(args) {
    const result = dispatch(args);
    // D-07 兜底：任何 action 的最终 JSON 信封必须 ≤64KiB（fitEnvelope/patch 二分已保证，此处为契约断言）
    assertOutputSize(result);
    return result;
}
function dispatch(args) {
    const action = args.action;
    if (typeof action !== 'string')
        throw new Error('diff: action must be a string');
    const before = str(args.before, 'before');
    const after = str(args.after, 'after');
    // D-11 修复：孤立 surrogate 拒绝（合法 Unicode 前置检查）
    assertWellFormedText(before, 'before');
    assertWellFormedText(after, 'after');
    if (utf8ByteLength(before) > MAX_INPUT_BYTES) {
        throw new Error(`diff: before input exceeds ${MAX_INPUT_BYTES / 1024}KiB limit`);
    }
    if (utf8ByteLength(after) > MAX_INPUT_BYTES) {
        throw new Error(`diff: after input exceeds ${MAX_INPUT_BYTES / 1024}KiB limit`);
    }
    const context = normalizeContext(args.context);
    const maxChanges = normalizeMaxChanges(args.maxChanges);
    const ignoreWhitespace = args.ignoreWhitespace === true;
    const ignoreCase = args.ignoreCase === true;
    const sortKeys = args.sortKeys !== false;
    const format = typeof args.format === 'string' ? args.format : undefined;
    if (format !== undefined && !['unified', 'structured', 'both'].includes(format)) {
        throw new Error(`diff: unknown format "${format}" (expected unified|structured|both)`);
    }
    const key = typeof args.key === 'string' ? args.key : undefined;
    const delimiter = typeof args.delimiter === 'string' ? args.delimiter : undefined;
    const summaryBase = (equal, truncated, changes) => ({
        equal, truncated, beforeBytes: utf8ByteLength(before), afterBytes: utf8ByteLength(after), changes,
    });
    switch (action) {
        case 'text': {
            const { diff, ops, stats } = unifiedDiff(before, after, { context, ignoreWhitespace, ignoreCase });
            // stats/变化数/structured 与渲染同源（仅末尾换行差异时按合成序列计）
            const effective = effectiveOps(ops, splitLines(before).trailingNewline, splitLines(after).trailingNewline);
            const changeCount = effective.filter(o => o.type !== 'equal').length;
            const structured = structuredText(effective);
            const wantDiff = format === undefined || format === 'unified' || format === 'both';
            const wantStructured = format === 'structured' || format === 'both';
            if (!wantDiff && !wantStructured)
                throw new Error('diff: invalid format for text action');
            const make = (n) => {
                const diffPart = wantDiff ? truncateText(diff === '' ? 'No differences.' : diff, 48 * 1024) : { text: '', truncated: false };
                const changes = wantStructured ? structured.slice(0, n) : [];
                return {
                    kind: 'text',
                    ...summaryBase(diff === '' && changeCount === 0, diffPart.truncated || (wantStructured && n < changeCount), changeCount),
                    stats,
                    ...(wantDiff ? { diff: diffPart.text } : {}),
                    ...(wantStructured ? { changes } : {}),
                };
            };
            const changeLimit = wantStructured ? Math.min(maxChanges, changeCount) : 0;
            return fitEnvelope(make, changeLimit).text;
        }
        case 'json': {
            const { changes, duplicateKeys } = jsonDiffText(before, after, { ignoreCase, sortKeys });
            const wantDiff = format === 'unified' || format === 'both';
            const hasDup = duplicateKeys.before.length > 0 || duplicateKeys.after.length > 0;
            const make = (n) => {
                const limited = changes.slice(0, n).map(c => ({ op: c.kind, path: c.path, ...(c.kind !== 'add' ? { before: c.before } : {}), ...(c.kind !== 'remove' ? { after: c.after } : {}) }));
                const summary = { added: 0, removed: 0, replaced: 0, moved: 0 };
                for (const c of changes.slice(0, n)) {
                    if (c.kind === 'add')
                        summary.added++;
                    else if (c.kind === 'remove')
                        summary.removed++;
                    else
                        summary.replaced++;
                }
                return {
                    kind: 'json',
                    ...summaryBase(changes.length === 0, n < changes.length, changes.length),
                    changes: limited,
                    summary,
                    // D-10 修复：重复键不静默丢弃，两侧分别报告
                    ...(hasDup ? { duplicateKeys } : {}),
                    ...(wantDiff ? { diff: truncateText(unifiedDiff(before, after, { context, ignoreWhitespace, ignoreCase }).diff, 48 * 1024).text } : {}),
                };
            };
            return fitEnvelope(make, Math.min(maxChanges, changes.length)).text;
        }
        case 'csv': {
            const report = csvDiff(before, after, { key, delimiter, ignoreCase, ignoreWhitespace });
            const wantDiff = format === 'unified' || format === 'both';
            const make = (n) => {
                const r = csvReportLimited(report, n);
                return {
                    kind: 'csv',
                    ...summaryBase(report.equal, n < csvChangeCount(report), csvChangeCount(report)),
                    mode: r.mode,
                    ...(r.key !== undefined ? { key: r.key } : {}),
                    ...(r.columns ? { columns: r.columns } : {}),
                    addedRows: r.addedRows,
                    removedRows: r.removedRows,
                    changedRows: r.changedRows,
                    duplicateKeys: r.duplicateKeys,
                    addedColumns: r.addedColumns,
                    removedColumns: r.removedColumns,
                    ...(wantDiff ? { diff: truncateText(unifiedDiff(before, after, { context, ignoreWhitespace, ignoreCase }).diff, 48 * 1024).text } : {}),
                };
            };
            return fitEnvelope(make, csvChangeCount(report)).text;
        }
        case 'markdown': {
            const report = markdownDiff(before, after, { context, ignoreWhitespace, ignoreCase });
            const wantDiff = format === 'unified' || format === 'both' || report.diff !== '';
            const make = (n) => {
                const r = mdReportLimited(report, n);
                return {
                    kind: 'markdown',
                    ...summaryBase(report.equal, n < mdChangeCount(report), mdChangeCount(report)),
                    headingChanges: r.headingChanges,
                    blockChanges: r.blockChanges,
                    codeBlockChanges: r.codeBlockChanges,
                    ...(wantDiff ? { diff: truncateText(report.diff, 48 * 1024).text } : {}),
                };
            };
            return fitEnvelope(make, mdChangeCount(report)).text;
        }
        case 'patch': {
            // D-03 契约：patch 是精确文本协议，ignore 只作用于比较类 action
            if (ignoreWhitespace || ignoreCase) {
                throw new Error('diff: patch action does not support ignoreCase/ignoreWhitespace (use text action for normalized comparison)');
            }
            const { patch, ops } = generatePatch('before', 'after', before, after, context);
            const validation = validatePatch(before, patch, after);
            // D-08 修复：stats/changes 与渲染同源（仅末尾换行差异按合成序列计）
            const effective = effectiveOps(ops, splitLines(before).trailingNewline, splitLines(after).trailingNewline);
            const stats = lineStats(effective);
            // D-01 修复：equal = before/after 在 patch 语义（精确行 + 末尾换行）下相等，与 valid 无关
            const changeCount = effective.filter(o => o.type !== 'equal').length;
            const equal = changeCount === 0;
            // D-07 修复：整个信封纳入 64KiB 预算；patch 截断 → valid:false + patchComplete:false
            const patchBytes = utf8ByteLength(patch);
            const fullPayload = (capBytes) => {
                const t = truncateText(patch, capBytes);
                const truncated = t.truncated;
                const errs = validation.errors;
                const omittedErrors = errs.length > 10 ? errs.length - 10 : 0;
                return {
                    kind: 'patch',
                    ...summaryBase(equal, truncated, changeCount),
                    valid: truncated ? false : validation.valid,
                    patch: t.text,
                    patchComplete: !truncated,
                    hunks: validation.hunks,
                    appliedLines: validation.appliedLines,
                    appliedBytes: utf8ByteLength(after),
                    targetMatchesAfter: truncated ? false : validation.targetMatchesAfter,
                    errors: truncated ? [...errs.slice(0, 10), 'patch truncated: result is not an applicable patch'] : errs.slice(0, 10),
                    ...(omittedErrors > 0 ? { omittedErrors } : {}),
                    stats,
                };
            };
            // 二分找最大 patch 字节数使整个信封 ≤ MAX_OUTPUT_BYTES
            let lo = 0;
            let hi = patchBytes;
            let best = JSON.stringify(fullPayload(hi));
            if (utf8ByteLength(best) > MAX_OUTPUT_BYTES) {
                while (lo <= hi) {
                    const mid = Math.floor((lo + hi) / 2);
                    const t = JSON.stringify(fullPayload(mid));
                    if (utf8ByteLength(t) <= MAX_OUTPUT_BYTES) {
                        best = t;
                        lo = mid + 1;
                    }
                    else {
                        hi = mid - 1;
                    }
                }
            }
            return best;
        }
        default:
            throw new Error(`diff: unknown action "${action}" (expected text|json|csv|markdown|patch)`);
    }
}
function structuredText(ops) {
    let oldLine = 1;
    let newLine = 1;
    const changes = [];
    for (const op of ops) {
        if (op.type === 'equal') {
            oldLine++;
            newLine++;
            continue;
        }
        const entry = { op: op.type };
        if (op.type === 'delete') {
            entry.oldLine = oldLine;
            oldLine++;
        }
        if (op.type === 'insert') {
            entry.newLine = newLine;
            newLine++;
        }
        entry.text = op.text;
        changes.push(entry);
    }
    return changes;
}
function csvChangeCount(r) {
    return r.addedRows.length + r.removedRows.length + r.changedRows.length + r.duplicateKeys.length;
}
function csvReportLimited(r, n) {
    let budget = n;
    const take = (arr) => {
        if (budget <= 0)
            return [];
        const t = arr.slice(0, budget);
        budget -= t.length;
        return t;
    };
    return {
        ...r,
        addedRows: take(r.addedRows),
        removedRows: take(r.removedRows),
        changedRows: take(r.changedRows),
        duplicateKeys: take(r.duplicateKeys),
    };
}
function mdChangeCount(r) {
    return r.headingChanges.length + r.blockChanges.length + r.codeBlockChanges.length;
}
function mdReportLimited(r, n) {
    let budget = n;
    const take = (arr) => {
        if (budget <= 0)
            return [];
        const t = arr.slice(0, budget);
        budget -= t.length;
        return t;
    };
    return {
        ...r,
        headingChanges: take(r.headingChanges),
        blockChanges: take(r.blockChanges),
        codeBlockChanges: take(r.codeBlockChanges),
    };
}
export function apply(ctx) {
    ctx.tools.register(defineTool({
        name: 'diff',
        description: 'Compare two text blobs and produce a diff. ' +
            'Actions: text (unified line diff), json (path-structured diff), csv (keyed/positional row diff), ' +
            'markdown (heading-path structured diff), patch (generate + validate a unified patch in memory). ' +
            'Output is a JSON envelope with a common summary (equal/truncated/beforeBytes/afterBytes/changes) ' +
            'plus action-specific fields. Pure in-memory text processing: never reads files, calls git, ' +
            'or applies patches to disk. Inputs up to 256KiB each, output capped at 64KiB.',
        parameters: {
            action: {
                type: 'string',
                required: true,
                enum: ['text', 'json', 'csv', 'markdown', 'patch'],
                description: 'Comparison operation to perform.',
            },
            before: {
                type: 'string',
                required: true,
                description: 'Original text or JSON/CSV/Markdown document.',
            },
            after: {
                type: 'string',
                required: true,
                description: 'Updated text or JSON/CSV/Markdown document.',
            },
            format: {
                type: 'string',
                enum: ['unified', 'structured', 'both'],
                description: 'Output format. Default: unified for text, structured for json/csv/markdown. unified = include the standard diff text; structured = JSON changes only; both = diff text plus JSON changes.',
            },
            context: {
                type: 'integer',
                description: 'Number of unchanged lines around text changes. Default 3; range 0..20.',
            },
            key: {
                type: 'string',
                description: 'CSV primary-key column name or 1-based column index. Omit for positional (by-row) comparison.',
            },
            delimiter: {
                type: 'string',
                description: 'CSV field delimiter, default ",". Single character, or "tab".',
            },
            ignoreWhitespace: {
                type: 'boolean',
                description: 'Ignore whitespace differences for text/csv/markdown comparison. Default false.',
            },
            ignoreCase: {
                type: 'boolean',
                description: 'Ignore case for comparison. Default false.',
            },
            sortKeys: {
                type: 'boolean',
                description: 'Sort JSON object keys before comparison and rendering. Default true.',
            },
            maxChanges: {
                type: 'integer',
                description: 'Maximum reported changes. Default 1000; hard ceiling 10000.',
            },
        },
        output: {
            schema: { type: 'string' },
            render: (_args, value) => [{ type: 'text', text: value }],
        },
        execute: args => Promise.resolve(runAction(args)),
        timeoutMs: 2000,
    }));
}
