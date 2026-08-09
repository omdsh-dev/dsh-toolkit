/**
 * Markdown 目录生成 —— 从标题行生成嵌套列表 + 锚点链接。零依赖，纯函数。
 *
 * 审查 MD-05 修复：
 * - fenced code 状态机：围栏内 `# fake` 不进入目录；
 * - 重复标题锚点自动递增（GitHub 风格 `-1/-2` 后缀）；
 * - 尾部闭合井号只在前面有空白时才剥离（`# C#` 正确保留为文本 C#）；
 * - slug 前剥离行内 Markdown 语法（`code`→code、[x](url)→x、**b**→b），
 *   与 GitHub slug 方向一致（简化实现，CJK 保留）。
 */
/** 剥离行内 Markdown 语法 → 可见文本（GitHub slug 方向；下划线保留）。 */
function toVisibleText(text) {
    return text
        .replace(/`([^`]*)`/g, '$1')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/!?\[([^\]]*)\]/g, '$1')
        .replace(/\*{1,2}/g, '');
}
/** GitHub 风格锚点（简化）：小写 + 去标点 + 空白转 '-'（下划线保留）；CJK 保留。 */
export function slugify(text) {
    return toVisibleText(text)
        .toLowerCase()
        .replace(/[^\p{L}\p{N} _-]/gu, '')
        .trim()
        .replace(/ +/g, '-');
}
const FENCE_RE = /^```|^~~~/;
/** 从 Markdown 提取标题序列（跳过 fenced code 内的伪标题；重复锚点递增）。 */
export function extractHeadings(markdown) {
    const entries = [];
    const seen = new Map();
    let inFence = false;
    for (const line of markdown.replace(/\r\n/g, '\n').split('\n')) {
        if (FENCE_RE.test(line.trimStart())) {
            inFence = !inFence;
            continue;
        }
        if (inFence)
            continue;
        // 尾部闭合井号仅在前有空白时剥离（`# C#` → 文本 "C#"）
        const m = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/.exec(line);
        if (m) {
            const text = m[2].trim();
            if (text === '')
                continue;
            const base = slugify(text);
            const count = seen.get(base) ?? 0;
            seen.set(base, count + 1);
            const anchor = count === 0 ? base : `${base}-${count}`;
            entries.push({ level: m[1].length, text, anchor });
        }
    }
    return entries;
}
/** 标题序列 → 嵌套目录列表（2 空格/层缩进）。无标题返回空字符串。 */
export function toc(markdown) {
    const entries = extractHeadings(markdown);
    const lines = [];
    for (const e of entries) {
        const indent = '  '.repeat(Math.max(0, e.level - 1));
        lines.push(`${indent}- [${e.text}](#${e.anchor})`);
    }
    return lines.join('\n');
}
