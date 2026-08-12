/**
 * DSH Markdown 工具插件。
 *
 * 注册 `markdown` 工具：HTML↔Markdown 转换、GFM 表格规范化、目录生成。
 * 接入方式：在 cordis.yml 追加：
 *   - id: tool-markdown
 *     name: '@deepseek-ai/dsh-tool-markdown'
 *
 * 安全边界：零依赖（手写解析器，无 cheerio/jsdom）；纯函数不联网；
 * md2html 只输出白名单标签（文本一律 HTML 转义）；链接 scheme 白名单；
 * script/style/iframe 内容剥离；嵌套深度 64 上限；maxBytes 输入预算。
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { utf8ByteLength } from './bytes.js';
import { html2md } from './html2md.js';
import { md2html } from './md2html.js';
import { normalizeTable } from './table.js';
import { toc } from './toc.js';
export const name = '@deepseek-ai/dsh-tool-markdown';
export const inject = ['tools'];
const DEFAULT_MAX_BYTES = 256_000;
const HARD_MAX_BYTES = 1_000_000;
function normalizeMaxBytes(maxBytes) {
    if (typeof maxBytes !== 'number' || !Number.isFinite(maxBytes) || maxBytes < 1) {
        return DEFAULT_MAX_BYTES;
    }
    const n = Math.floor(maxBytes);
    if (n > HARD_MAX_BYTES) {
        throw new Error(`markdown: maxBytes cannot exceed ${HARD_MAX_BYTES}`);
    }
    return n;
}
function assertSize(input, maxBytes, label) {
    if (typeof input !== 'string') {
        throw new Error(`markdown: ${label} must be a string`);
    }
    const bytes = utf8ByteLength(input);
    if (bytes > maxBytes) {
        throw new Error(`markdown: ${label} exceeds ${maxBytes} bytes (got ${bytes})`);
    }
}
function runAction(args) {
    const maxBytes = normalizeMaxBytes(args.maxBytes);
    const baseUrl = typeof args.baseUrl === 'string' && args.baseUrl !== '' ? args.baseUrl : undefined;
    switch (args.action) {
        case 'html2md': {
            assertSize(args.html, maxBytes, 'html');
            return html2md(args.html, { baseUrl });
        }
        case 'md2html': {
            assertSize(args.markdown, maxBytes, 'markdown');
            return md2html(args.markdown, { baseUrl });
        }
        case 'table': {
            assertSize(args.text, maxBytes, 'text');
            return normalizeTable(args.text, { baseUrl });
        }
        case 'toc': {
            assertSize(args.markdown, maxBytes, 'markdown');
            return toc(args.markdown);
        }
        default:
            throw new Error(`markdown: unknown action "${args.action}"`);
    }
}
export function apply(ctx) {
    ctx.tools.register(defineTool({
        name: 'markdown',
        description: 'Markdown utilities over text (zero-dependency, pure functions). ' +
            'Actions: html2md (HTML to GFM Markdown: main content, tables, links; ' +
            'script/style/iframe content stripped), md2html (Markdown to whitelisted ' +
            'safe HTML: only p/h1-h6/ul/ol/li/blockquote/pre/code/a/img/strong/em/br/hr/table; ' +
            'all text is HTML-escaped, javascript:/data: links degrade to plain text), ' +
            'table (normalize HTML <table> or pipe-delimited text to a GFM table), ' +
            'toc (generate a nested TOC with anchors from Markdown headings). ' +
            'Inputs over maxBytes (default 256000, ceiling 1000000) are rejected. ' +
            'Do not pass HTML containing secrets (tool arguments are recorded in session logs).',
        parameters: {
            action: {
                type: 'string',
                required: true,
                enum: ['html2md', 'md2html', 'table', 'toc'],
                description: 'Operation to perform.',
            },
            html: {
                type: 'string',
                description: 'HTML input for html2md (fragment or full document).',
            },
            markdown: {
                type: 'string',
                description: 'Markdown input for md2html/toc.',
            },
            text: {
                type: 'string',
                description: 'Table input for the table action: HTML <table> or pipe-delimited text.',
            },
            baseUrl: {
                type: 'string',
                description: 'Optional base URL: resolves relative href/src to absolute before conversion (naive join).',
            },
            maxBytes: {
                type: 'integer',
                description: 'Input size cap, default 256000. Hard ceiling 1000000.',
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
