/**
 * Markdown → 白名单 HTML —— 零依赖，纯函数。
 *
 * 只实现工具需要的 CommonMark 子集：标题/围栏代码/引用/列表/表格 +
 * 行内 `code`、**bold**、*italic*、[text](url)、![alt](url)。
 *
 * 安全：
 * - 文本内容一律 HTML 转义（& < > " '）——markdown 内嵌的 <script> 等
 *   原样显示为文本，不可能产出白名单外的标签；
 * - 链接 scheme 白名单（http/https/mailto），javascript:/data: 降级纯文本；
 * - 输出标签仅 p h1-h6 ul ol li blockquote pre code a img strong em br hr
 *   table thead tbody tr th td。
 */
const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;
/** URL 规范化（审查 MD-01/MD-02）：去除 C0 控制字符与首尾空白后再判断。 */
function normalizeUrl(raw) {
    return raw.replace(/[\u0000-\u001f\u007f]/g, '').trim();
}
/** scheme 白名单（大小写不敏感，审查 MD-02）；无 scheme 视为相对路径。 */
function safeScheme(rawUrl) {
    const url = normalizeUrl(rawUrl);
    if (url === '')
        return false;
    const m = SCHEME_RE.exec(url);
    if (!m)
        return true; // 相对路径（无 scheme；协议相对 //host 属此类）
    const scheme = m[1].toLowerCase();
    return scheme === 'http' || scheme === 'https' || scheme === 'mailto';
}
function resolveUrl(href, baseUrl) {
    const h = normalizeUrl(href);
    if (baseUrl === undefined || h === '' || SCHEME_RE.test(h))
        return h;
    const base = baseUrl.replace(/\/+$/, '');
    if (h.startsWith('/'))
        return base + h;
    return `${base}/${h}`;
}
export function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
/** 从 openIdx（'(' 后）扫描匹配的 ')'，支持 URL 内嵌套括号。 */
function scanUrlEnd(input, openIdx) {
    let depth = 0;
    let j = openIdx;
    while (j < input.length) {
        const ch = input[j];
        if (ch === '(')
            depth++;
        else if (ch === ')') {
            if (depth === 0)
                return j;
            depth--;
        }
        j++;
    }
    return -1;
}
/**
 * 行内解析：转义文本 + 白名单行内标签。
 * 顺序：`code` → **bold** → *italic* → ![alt](url) → [text](url)。
 */
function renderInline(input, options, allowBold = true) {
    let out = '';
    let i = 0;
    while (i < input.length) {
        const c = input[i];
        // 行内代码
        if (c === '`') {
            const close = input.indexOf('`', i + 1);
            if (close !== -1) {
                out += `<code>${escapeHtml(input.slice(i + 1, close))}</code>`;
                i = close + 1;
                continue;
            }
        }
        // 粗体
        if (allowBold && c === '*' && input[i + 1] === '*') {
            const close = input.indexOf('**', i + 2);
            if (close !== -1) {
                out += `<strong>${renderInline(input.slice(i + 2, close), options, false)}</strong>`;
                i = close + 2;
                continue;
            }
        }
        // 斜体
        if (c === '*' && input[i + 1] !== '*') {
            const close = input.indexOf('*', i + 1);
            if (close !== -1) {
                out += `<em>${renderInline(input.slice(i + 1, close), options, false)}</em>`;
                i = close + 1;
                continue;
            }
        }
        // 图片 ![alt](url)
        if (c === '!' && input[i + 1] === '[') {
            const close = input.indexOf('](', i + 2);
            if (close !== -1) {
                const closeEnd = scanUrlEnd(input, close + 2);
                if (closeEnd !== -1) {
                    const alt = input.slice(i + 2, close);
                    const url = resolveUrl(input.slice(close + 2, closeEnd).split(/\s+/)[0] ?? '', options.baseUrl);
                    i = closeEnd + 1;
                    if (url !== '' && safeScheme(url))
                        out += `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}">`;
                    else
                        out += escapeHtml(alt);
                    continue;
                }
            }
        }
        // 链接 [text](url)
        if (c === '[') {
            const close = input.indexOf('](', i + 1);
            if (close !== -1) {
                const closeEnd = scanUrlEnd(input, close + 2);
                if (closeEnd !== -1) {
                    const text = input.slice(i + 1, close);
                    const url = resolveUrl(input.slice(close + 2, closeEnd).split(/\s+/)[0] ?? '', options.baseUrl);
                    i = closeEnd + 1;
                    if (url !== '' && safeScheme(url)) {
                        out += `<a href="${escapeHtml(url)}">${escapeHtml(text)}</a>`;
                    }
                    else {
                        out += escapeHtml(text);
                    }
                    continue;
                }
            }
        }
        out += escapeHtml(c);
        i++;
    }
    return out;
}
/** 分隔行检测：| --- | 或 | :--- | 等。 */
export function isSeparatorRow(cells) {
    return cells.length > 0 && cells.every(c => /^:?-{3,}:?$/.test(c.trim()));
}
/** 管道行 → 单元格（支持 \| 转义）。 */
export function splitPipe(line) {
    let l = line.trim();
    if (l.startsWith('|'))
        l = l.slice(1);
    if (l.endsWith('|'))
        l = l.slice(0, -1);
    const cells = [];
    let cur = '';
    let i = 0;
    while (i < l.length) {
        const c = l[i];
        if (c === '\\' && l[i + 1] === '|') {
            cur += '|';
            i += 2;
            continue;
        }
        if (c === '|') {
            cells.push(cur.trim());
            cur = '';
            i++;
            continue;
        }
        cur += c;
        i++;
    }
    cells.push(cur.trim());
    return cells;
}
function renderTable(lines, options) {
    const rows = lines.map(splitPipe);
    // 找分隔行
    let sepIndex = -1;
    for (let i = 0; i < rows.length; i++) {
        if (isSeparatorRow(rows[i])) {
            sepIndex = i;
            break;
        }
    }
    const header = sepIndex === -1 ? rows[0] : rows[0];
    const body = sepIndex === -1 ? rows.slice(1) : [...rows.slice(1, sepIndex), ...rows.slice(sepIndex + 1)];
    const width = Math.max(header.length, ...body.map(r => r.length));
    const pad = (r) => {
        const out = [...r];
        while (out.length < width)
            out.push('');
        return out;
    };
    const tr = (cells, tag) => `<tr>${pad(cells).map(c => `<${tag}>${renderInline(c, options)}</${tag}>`).join('')}</tr>`;
    const thead = `<thead>${tr(header, 'th')}</thead>`;
    const tbody = body.length > 0 ? `<tbody>${body.map(r => tr(r, 'td')).join('')}</tbody>` : '';
    return `<table>${thead}${tbody}</table>`;
}
/** Markdown → 白名单 HTML。 */
export function md2html(markdown, options = {}) {
    const lines = markdown.replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();
        if (trimmed === '') {
            i++;
            continue;
        }
        // 围栏代码块
        const fence = /^```([a-zA-Z0-9_-]*)\s*$/.exec(trimmed);
        if (fence) {
            const lang = fence[1];
            const body = [];
            i++;
            while (i < lines.length && !/^```\s*$/.test(lines[i])) {
                body.push(lines[i]);
                i++;
            }
            i++; // 跳过闭合围栏（或 EOF）
            out.push(`<pre><code${lang ? ` class="language-${lang}"` : ''}>${escapeHtml(body.join('\n'))}</code></pre>`);
            continue;
        }
        // 标题
        const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
        if (heading) {
            const level = heading[1].length;
            out.push(`<h${level}>${renderInline(heading[2], options)}</h${level}>`);
            i++;
            continue;
        }
        // 表格：连续管道行（含分隔行）
        if (trimmed.startsWith('|')) {
            const tableLines = [];
            while (i < lines.length && lines[i].trim().startsWith('|')) {
                tableLines.push(lines[i]);
                i++;
            }
            out.push(renderTable(tableLines, options));
            continue;
        }
        // 引用
        if (trimmed.startsWith('>')) {
            const quote = [];
            while (i < lines.length && lines[i].trim().startsWith('>')) {
                quote.push(lines[i].trim().replace(/^>\s?/, ''));
                i++;
            }
            out.push(`<blockquote>${quote.map(q => `<p>${renderInline(q, options)}</p>`).join('')}</blockquote>`);
            continue;
        }
        // 无序列表
        if (/^[-*]\s+/.test(trimmed)) {
            const items = [];
            while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
                items.push(lines[i].trim().replace(/^[-*]\s+/, ''));
                i++;
            }
            out.push(`<ul>${items.map(it => `<li>${renderInline(it, options)}</li>`).join('')}</ul>`);
            continue;
        }
        // 有序列表
        if (/^\d+\.\s+/.test(trimmed)) {
            const items = [];
            while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
                items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
                i++;
            }
            out.push(`<ol>${items.map(it => `<li>${renderInline(it, options)}</li>`).join('')}</ol>`);
            continue;
        }
        // 普通段落：收集到空行
        const para = [];
        while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,6}\s|```|[-*]\s|\d+\.\s|>\s|\|)/.test(lines[i].trim())) {
            para.push(lines[i]);
            i++;
        }
        out.push(`<p>${renderInline(para.join(' '), options)}</p>`);
    }
    return out.join('\n') + '\n';
}
