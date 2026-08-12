/**
 * Markdown 结构化 diff —— 零依赖，纯函数。
 *
 * - 轻量块级 tokenizer：ATX 标题、围栏代码块、列表项、引用块、表格、分隔线、
 *   内联 HTML 注释；其余按空行分段落；无法识别的语法按普通文本块保留，不丢弃；
 * - 输出协议（§3.5）：
 *   - headingChanges：[{ op: add|remove|rename, before, after, level, index }]；
 *   - blockChanges：[{ op: add|remove|replace, path, before, after }]，path 形如 `h2[1]/p[0]`；
 *   - codeBlockChanges：[{ language, beforeLines, afterLines }]；
 *   - diff：两块文档的 unified diff（可选）。
 */
import { splitLines, diffLines, renderUnified } from './text-diff.js';
import { assertInputSize } from './limits.js';
const ATX_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE_RE = /^(`{3,}|~{3,})/;
const LIST_RE = /^\s*[-*+]\s+/;
const ORDERED_RE = /^\s*\d+[.)]\s+/;
const QUOTE_RE = /^\s*>\s?/;
const HR_RE = /^\s*([-*_])\s*(\1\s*){2,}$/;
const TABLE_SEP_RE = /^\s*\|?[\s:|-]+\|[\s:|-]*$/;
const HTML_COMMENT_RE = /^\s*<!--/;
function hashStr(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++)
        h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return h;
}
export function tokenizeMarkdown(text) {
    assertInputSize(text, 'markdown');
    const { lines } = splitLines(text);
    const blocks = [];
    const headingStack = [];
    let headingOrdinal = 0;
    let i = 0;
    while (i < lines.length) {
        const raw = lines[i].text;
        const lineNo = i + 1;
        if (raw.trim() === '') {
            blocks.push({ kind: 'blank', line: lineNo, text: '' });
            i++;
            continue;
        }
        const atx = ATX_RE.exec(raw);
        if (atx) {
            const level = atx[1].length;
            const headingText = atx[2].trim();
            while (headingStack.length >= level)
                headingStack.pop();
            const path = [...headingStack, headingText].join(' > ');
            headingStack.push(headingText);
            headingOrdinal++;
            blocks.push({ kind: 'heading', line: lineNo, level, headingText, path, text: raw });
            i++;
            continue;
        }
        const fence = FENCE_RE.exec(raw);
        if (fence) {
            const marker = fence[1][0];
            const fenceLen = fence[1].length;
            const language = raw.slice(fence[1].length).trim().split(/\s+/)[0] ?? '';
            let end = -1;
            let j = i + 1;
            while (j < lines.length) {
                const close = /^(`{3,}|~{3,})/.exec(lines[j].text);
                if (close && close[1][0] === marker && close[1].length >= fenceLen) {
                    end = j;
                    break;
                }
                j++;
            }
            const blockLines = end === -1 ? lines.slice(i) : lines.slice(i, end + 1);
            blocks.push({ kind: 'fence', line: lineNo, language, text: blockLines.map(l => l.text).join('\n') });
            i += blockLines.length;
            continue;
        }
        if (QUOTE_RE.test(raw)) {
            const blockLines = [raw];
            let j = i + 1;
            while (j < lines.length && (QUOTE_RE.test(lines[j].text) || lines[j].text.trim() === '')) {
                if (lines[j].text.trim() === '') {
                    j++;
                    continue;
                }
                blockLines.push(lines[j].text);
                j++;
            }
            blocks.push({ kind: 'quote', line: lineNo, text: blockLines.join('\n') });
            i = j;
            continue;
        }
        if (LIST_RE.test(raw) || ORDERED_RE.test(raw)) {
            const blockLines = [raw];
            let j = i + 1;
            while (j < lines.length) {
                const t = lines[j].text;
                if (t.trim() === '')
                    break;
                if (LIST_RE.test(t) || ORDERED_RE.test(t)) {
                    blockLines.push(t);
                    j++;
                    continue;
                }
                if (/^\s+/.test(t)) {
                    blockLines.push(t);
                    j++;
                    continue;
                }
                break;
            }
            blocks.push({ kind: 'list', line: lineNo, text: blockLines.join('\n') });
            i = j;
            continue;
        }
        // GFM 表格：表头行 + 分隔行（前瞻下一行是分隔行则整块归为 table）
        const nextRaw = i + 1 < lines.length ? lines[i + 1].text : '';
        if (raw.includes('|') && (TABLE_SEP_RE.test(raw.replace(/\|/g, '|')) || TABLE_SEP_RE.test(nextRaw.replace(/\|/g, '|')))) {
            const blockLines = [raw];
            let j = i + 1;
            while (j < lines.length && lines[j].text.includes('|') && !/^\s*$/.test(lines[j].text)) {
                blockLines.push(lines[j].text);
                j++;
            }
            blocks.push({ kind: 'table', line: lineNo, text: blockLines.join('\n') });
            i = j;
            continue;
        }
        if (HR_RE.test(raw)) {
            blocks.push({ kind: 'hr', line: lineNo, text: raw });
            i++;
            continue;
        }
        if (HTML_COMMENT_RE.test(raw)) {
            const blockLines = [raw];
            let j = i + 1;
            while (j < lines.length && !lines[j].text.includes('-->')) {
                blockLines.push(lines[j].text);
                j++;
            }
            if (j < lines.length)
                blockLines.push(lines[j].text);
            blocks.push({ kind: 'html', line: lineNo, text: blockLines.join('\n') });
            i = j + 1;
            continue;
        }
        const blockLines = [raw];
        let j = i + 1;
        while (j < lines.length && lines[j].text.trim() !== '') {
            blockLines.push(lines[j].text);
            j++;
        }
        blocks.push({ kind: 'paragraph', line: lineNo, text: blockLines.join('\n') });
        i = j;
    }
    return blocks;
}
/** 为块生成 "h2[1]/p[0]" 形式的路径；每个标题下块计数从 0 重新开始。 */
function buildPaths(blocks) {
    const map = new Map();
    let currentHeadingPath = '';
    const headingCounters = new Map();
    let lastHeading = null;
    let blockCounter = 0;
    for (const b of blocks) {
        if (b.kind === 'heading') {
            const key = `h${b.level}`;
            const n = (headingCounters.get(key) ?? 0) + 1;
            headingCounters.set(key, n);
            currentHeadingPath = `${key}[${n}]`;
            lastHeading = b;
            blockCounter = 0;
            map.set(b, currentHeadingPath);
        }
        else {
            const base = lastHeading ? `${currentHeadingPath}/` : '';
            map.set(b, `${base}${kindToken(b.kind)}[${blockCounter}]`);
            blockCounter++;
        }
    }
    return map;
}
function kindToken(kind) {
    switch (kind) {
        case 'fence': return 'code';
        case 'list': return 'ul';
        case 'quote': return 'blockquote';
        case 'table': return 'table';
        case 'paragraph': return 'p';
        case 'hr': return 'hr';
        case 'html': return 'html';
        case 'blank': return 'blank';
        default: return 'block';
    }
}
function blockEqual(a, b, options) {
    if (a.kind !== b.kind)
        return false;
    if (a.kind === 'heading') {
        const at = options.ignoreCase ? a.headingText.toLowerCase() : a.headingText;
        const bt = options.ignoreCase ? b.headingText.toLowerCase() : b.headingText;
        return at === bt;
    }
    if (options.ignoreCase && a.text.toLowerCase() === b.text.toLowerCase())
        return true;
    if (options.ignoreWhitespace) {
        return a.text.replace(/[ \t]+/g, ' ').trim() === b.text.replace(/[ \t]+/g, ' ').trim();
    }
    return a.text === b.text;
}
export function markdownDiff(beforeText, afterText, options = {}) {
    const before = tokenizeMarkdown(beforeText);
    const after = tokenizeMarkdown(afterText);
    const beforePaths = buildPaths(before);
    const afterPaths = buildPaths(after);
    const headingChanges = [];
    const blockChanges = [];
    const codeBlockChanges = [];
    // 标题匹配：先按父路径（路径去掉最后一段）配，再按同级别序号配。
    // 同路径同级别但文本不同 → rename；级别变化 → remove+add。
    const beforeHeadings = before.filter(b => b.kind === 'heading');
    const afterHeadings = after.filter(b => b.kind === 'heading');
    const parentPath = (h) => {
        const p = h.path;
        const idx = p.lastIndexOf(' > ');
        return idx === -1 ? '' : p.slice(0, idx);
    };
    const afterParentMap = new Map();
    for (const h of afterHeadings) {
        const pp = parentPath(h);
        const arr = afterParentMap.get(pp) ?? [];
        arr.push(h);
        afterParentMap.set(pp, arr);
    }
    const afterOrdinalByLevel = new Map();
    for (const h of afterHeadings) {
        const key = `h${h.level}`;
        afterOrdinalByLevel.set(key, (afterOrdinalByLevel.get(key) ?? 0) + 1);
    }
    const afterUsed = new Set();
    const matchHeading = (h) => {
        // 1) 同父路径 + 同级别（最可靠）
        const siblings = afterParentMap.get(parentPath(h)) ?? [];
        const byLevel = siblings.filter(s => s.level === h.level);
        if (byLevel.length > 0 && !afterUsed.has(byLevel[0]))
            return byLevel[0];
        // 2) 同级别 + 同序号（父路径无匹配时）
        const ordinal = beforeHeadings.filter(b => b.level === h.level).indexOf(h);
        let seen = 0;
        for (const s of afterHeadings) {
            if (s.level !== h.level || afterUsed.has(s))
                continue;
            if (seen === ordinal)
                return s;
            seen++;
        }
        return undefined;
    };
    beforeHeadings.forEach((h, i) => {
        const match = matchHeading(h);
        if (match) {
            afterUsed.add(match);
            if (!blockEqual(h, match, options)) {
                headingChanges.push({
                    op: 'rename',
                    before: h.headingText,
                    after: match.headingText,
                    level: h.level,
                    index: i + 1,
                });
            }
        }
        else {
            headingChanges.push({ op: 'remove', before: h.headingText, level: h.level, index: i + 1 });
        }
    });
    afterHeadings.forEach((h, i) => {
        if (!afterUsed.has(h)) {
            headingChanges.push({ op: 'add', after: h.headingText, level: h.level, index: i + 1 });
        }
    });
    // 非标题块：按块类型 token 做 Myers 对齐（消除同型块内容变化被误报为 remove+add）。
    // equal 对：内容不同 → replace（fence 只进 codeBlockChanges）；delete/insert → remove/add。
    const nb = before.filter(b => b.kind !== 'heading' && b.kind !== 'blank');
    const na = after.filter(b => b.kind !== 'heading' && b.kind !== 'blank');
    const lb = nb.map(b => ({ text: kindToken(b.kind), hash: 0 }));
    const la = na.map(b => ({ text: kindToken(b.kind), hash: 0 }));
    for (const l of lb)
        l.hash = hashStr(l.text);
    for (const l of la)
        l.hash = hashStr(l.text);
    const ops = diffLines(lb, la, { ignoreCase: false, ignoreWhitespace: false });
    const ctx = options.context ?? 3;
    let bi = 0;
    let ai = 0;
    for (const op of ops) {
        if (op.type === 'equal') {
            const a = nb[bi];
            const b = na[ai];
            if (!blockEqual(a, b, options)) {
                if (a.kind === 'fence') {
                    // D-04 修复：语言/行数/内容任一变化都进入 codeBlockChanges，
                    // 同语言同行数但内容不同 → changed:true（否则 equal 会漏报）
                    const aLines = a.text.split('\n').length;
                    const bLines = b.text.split('\n').length;
                    const langChanged = (a.language ?? '') !== (b.language ?? '');
                    const linesChanged = aLines !== bLines;
                    codeBlockChanges.push({
                        language: b.language ?? '',
                        beforeLines: aLines,
                        afterLines: bLines,
                        ...(!langChanged && !linesChanged ? { changed: true } : {}),
                    });
                }
                else {
                    blockChanges.push({
                        op: 'replace',
                        path: beforePaths.get(a) ?? `L${a.line}`,
                        before: a.text,
                        after: b.text,
                    });
                }
            }
            bi++;
            ai++;
            continue;
        }
        if (op.type === 'delete') {
            const b = nb[bi];
            blockChanges.push({ op: 'remove', path: beforePaths.get(b) ?? `L${b.line}`, before: b.text });
            bi++;
        }
        else {
            const a = na[ai];
            blockChanges.push({ op: 'add', path: afterPaths.get(a) ?? `L${a.line}`, after: a.text });
            ai++;
        }
    }
    // 整体 unified diff（可选字段）
    const a2 = splitLines(beforeText);
    const b2 = splitLines(afterText);
    const opsAll = diffLines(a2.lines, b2.lines, { ignoreCase: options.ignoreCase, ignoreWhitespace: options.ignoreWhitespace });
    const diff = renderUnified('before', 'after', a2.lines, b2.lines, opsAll, ctx, a2.trailingNewline, b2.trailingNewline);
    const equal = headingChanges.length === 0 && blockChanges.length === 0 && codeBlockChanges.length === 0;
    return { equal, headingChanges, blockChanges, codeBlockChanges, diff };
}
