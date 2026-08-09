/**
 * unified patch 生成与内存校验。
 *
 * - generatePatch：复用 text-diff 的 unified 渲染，可自定义文件标签（默认 before/after）；
 * - validatePatch：解析 `---`/`+++`/`@@`/上下文行，在内存中把补丁应用到 before，
 *   与 after 逐行比对；绝不写文件、不调用 git（read-only）。
 */
import { splitLines, diffLines, renderUnified } from "./text-diff.js";
import { assertInputSize } from "./limits.js";
/**
 * 生成 unified patch（D-03 契约：patch 是精确文本协议，不做 ignore 归一化——
 * 归一化比较请用 text action；ignore 选项会在工具入口被拒绝）。
 */
export function generatePatch(beforeLabel, afterLabel, beforeText, afterText, context) {
    assertInputSize(beforeText, 'before');
    assertInputSize(afterText, 'after');
    const a = splitLines(beforeText);
    const b = splitLines(afterText);
    const ops = diffLines(a.lines, b.lines);
    const patch = renderUnified(beforeLabel, afterLabel, a.lines, b.lines, ops, context, a.trailingNewline, b.trailingNewline);
    return { patch, ops };
}
/**
 * 解析 unified diff 文本。
 * - strict（默认 true，D-14）：要求 `---`/`+++` 文件头；每个 body 行必须以
 *   ` `（ctx）/`-`（del）/`+`（add）/`\`（no-newline 标记）开头，否则报错；
 *   hunk 行数与 header 计数不一致报错。
 * - lenient：容忍缺失文件头与空行（内部生成 patch 自检场景）。
 * 忽略 `\ No newline at end of file` 标记行（行级校验不依赖字节末尾）。
 */
export function parsePatch(patchText, options = {}) {
    const strict = options.strict !== false;
    const errors = [];
    const hunks = [];
    // 去除尾部换行产生的空元素（补丁文本通常以 \n 结尾）
    const lines = patchText.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n');
    let i = 0;
    // 文件头（--- / +++ / diff --git 等）
    const headerRe = /^(---|\+\+\+|diff |index |new file|deleted file|similarity|rename |Binary files)/;
    while (i < lines.length) {
        const l = lines[i];
        if (l.startsWith('@@'))
            break;
        if (headerRe.test(l)) {
            i++;
            continue;
        }
        if (l.trim() === '') {
            i++;
            continue;
        }
        if (strict) {
            errors.push(`unexpected line before first hunk at ${i + 1}: ${l.slice(0, 60)}`);
            return { hunks, errors };
        }
        break;
    }
    // 文件头检查（strict）：--- 与 +++ 各至少出现一次（允许 diff --git 包装）
    const head = lines.slice(0, i).join('\n');
    if (strict && (!head.includes('---') || !head.includes('+++'))) {
        errors.push('patch is missing ---/+++ file headers (strict mode)');
        return { hunks, errors };
    }
    const hunkRe = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
    while (i < lines.length) {
        const l = lines[i];
        if (l.trim() === '') {
            i++;
            continue;
        }
        if (l.startsWith('\\ No newline')) {
            i++;
            continue;
        }
        const m = hunkRe.exec(l);
        if (!m) {
            if (headerRe.test(l)) {
                i++;
                continue;
            }
            errors.push(`unexpected line at ${i + 1}: ${l.slice(0, 60)}`);
            return { hunks, errors };
        }
        const oldStart = Number(m[1]);
        const oldCount = m[2] === undefined ? 1 : Number(m[2]);
        const newStart = Number(m[3]);
        const newCount = m[4] === undefined ? 1 : Number(m[4]);
        const h = { oldStart, oldCount, newStart, newCount, lines: [] };
        i++;
        let seenOld = 0;
        let seenNew = 0;
        while (i < lines.length && (seenOld < oldCount || seenNew < newCount)) {
            const cl = lines[i];
            if (cl.startsWith('\\ No newline')) {
                i++;
                continue;
            }
            if (cl.startsWith('@@')) {
                errors.push('hunk ended early (unexpected @@)');
                break;
            }
            const first = cl[0] ?? '';
            if (strict && first !== ' ' && first !== '-' && first !== '+') {
                errors.push(`invalid hunk body line at ${i + 1} (strict mode): ${cl.slice(0, 60)}`);
                return { hunks, errors };
            }
            const kind = first === '-' ? 'del' : first === '+' ? 'add' : 'ctx';
            if (kind === 'ctx' || kind === 'del')
                seenOld++;
            if (kind === 'ctx' || kind === 'add')
                seenNew++;
            h.lines.push({ kind, text: cl.slice(1) });
            i++;
        }
        if (seenOld !== oldCount || seenNew !== newCount) {
            errors.push(`hunk @@ -${oldStart},${oldCount} +${newStart},${newCount} @@: expected ${oldCount}/${newCount} lines, saw ${seenOld}/${seenNew}`);
        }
        hunks.push(h);
    }
    return { hunks, errors };
}
/**
 * 内存中应用补丁并校验：把 hunks 应用到 before 行数组，
 * 若所有上下文/删除行匹配且结果与 after 逐行一致 → 补丁有效。
 *
 * 两阶段（D-02/D-09 修复）：
 * 1) 结构验证：所有 hunk 的 oldStart/newStart 单调不重叠、old/new 坐标间隙一致
 *    （newStart 与累积 new 坐标对齐），任何不一致 → 整体拒绝，不进入应用阶段；
 * 2) 应用：上下文/删除行逐行匹配后应用，任一 hunk 失配 → 整体拒绝并停止。
 */
export function validatePatch(beforeText, patchText, afterText) {
    const errors = [];
    const before = beforeText.replace(/\r\n/g, '\n').split('\n');
    const after = afterText.replace(/\r\n/g, '\n').split('\n');
    // 去掉 split 末尾空元素（trailing newline 与行级比较无关）
    if (before.length > 0 && before[before.length - 1] === '')
        before.pop();
    if (after.length > 0 && after[after.length - 1] === '')
        after.pop();
    // 空补丁：两边行级相等 → 平凡有效；不等 → 明确报错
    if (patchText.trim() === '') {
        const equal = before.length === after.length && before.every((l, i) => l === after[i]);
        return {
            valid: equal,
            hunks: 0,
            appliedLines: 0,
            targetMatchesAfter: equal,
            errors: equal ? [] : ['patch is empty but before does not match after'],
        };
    }
    const parsed = parsePatch(patchText);
    errors.push(...parsed.errors);
    if (parsed.hunks.length === 0 && !errors.length) {
        errors.push('patch contains no hunks');
    }
    // ── 阶段 1：结构验证（D-02/D-09）——坐标单调、不重叠、old/new 间隙一致 ──
    let oldCursor = 0; // 已消费的 before 行数（0-based）
    let newCursor = 0; // 已产出的 after 行数（0-based）
    let lastOld = -1;
    let lastNew = -1;
    for (const h of parsed.hunks) {
        // unified 约定：空文件起始 oldStart=0（等价于 1-based 的 1）
        const oldPos = h.oldStart === 0 ? 1 : h.oldStart;
        const newPos = h.newStart === 0 ? 1 : h.newStart;
        if (h.oldStart !== 0 && h.oldStart <= lastOld) {
            errors.push(`hunk @@ -${h.oldStart},${h.oldCount} +${h.newStart},${h.newCount} @@: oldStart not increasing (overlap or reversed order)`);
        }
        else if (h.newStart !== 0 && h.newStart <= lastNew) {
            errors.push(`hunk @@ -${h.oldStart},${h.oldCount} +${h.newStart},${h.newCount} @@: newStart not increasing (overlap or reversed order)`);
        }
        else if (oldPos - oldCursor !== newPos - newCursor) {
            // old/new 坐标间隙必须一致：中间未变化的行数在两侧相同
            errors.push(`hunk @@ -${h.oldStart},${h.oldCount} +${h.newStart},${h.newCount} @@: old/new coordinate gap mismatch (oldCursor=${oldCursor}, newCursor=${newCursor})`);
        }
        else if (h.oldStart !== 0 && h.oldStart - 1 > before.length) {
            errors.push(`hunk @@ -${h.oldStart},... : oldStart ${h.oldStart} out of bounds (file has ${before.length} lines)`);
        }
        lastOld = h.oldStart;
        lastNew = h.newStart;
        oldCursor += h.oldCount;
        newCursor += h.newCount;
    }
    // new 侧总行数与 after 行数一致（最后一个 hunk 后允许未变化的尾部，由 targetMatchesAfter 兜底）
    if (errors.length > 0) {
        return { valid: false, hunks: parsed.hunks.length, appliedLines: 0, targetMatchesAfter: false, errors };
    }
    // ── 阶段 2：应用（位置按前序 hunk 的净偏移 shift 调整）──
    const applied = before.slice();
    let appliedLines = 0;
    let shift = 0;
    for (const h of parsed.hunks) {
        const pos = h.oldStart === 0 ? 0 : h.oldStart - 1 + shift;
        if (pos < 0 || pos > applied.length) {
            errors.push(`hunk @@ -${h.oldStart},${h.oldCount} +${h.newStart},${h.newCount} @@: position ${pos} out of bounds (file has ${applied.length} lines)`);
            break;
        }
        // 校验 ctx/del 行
        let di = pos;
        let ok = true;
        for (const pl of h.lines) {
            if (pl.kind === 'add')
                continue;
            const target = applied[di];
            if (target === undefined || target !== pl.text) {
                errors.push(`hunk @@ -${h.oldStart},... : context line ${di + 1} mismatch (expected ${JSON.stringify(pl.text)}, got ${JSON.stringify(target)})`);
                ok = false;
                break;
            }
            di++;
        }
        if (!ok)
            break;
        // 应用：删除 del，插入 add
        let di2 = pos;
        for (const pl of h.lines) {
            if (pl.kind === 'del') {
                applied.splice(di2, 1);
                appliedLines++;
            }
            else if (pl.kind === 'add') {
                applied.splice(di2, 0, pl.text);
                di2++;
                appliedLines++;
            }
            else
                di2++;
        }
        shift += (h.newCount - h.oldCount);
    }
    let targetMatchesAfter = applied.length === after.length && applied.every((l, i) => l === after[i]);
    if (!targetMatchesAfter) {
        errors.push('patched result does not match after content');
    }
    return { valid: errors.length === 0, hunks: parsed.hunks.length, appliedLines, targetMatchesAfter, errors };
}
