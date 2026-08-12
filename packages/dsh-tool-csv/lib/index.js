/**
 * DSH CSV 数据工具插件。
 *
 * 注册 `csv` 工具：解析、查询、统计 RFC 4180 CSV 文本。
 * 接入方式：在 cordis.yml 追加：
 *   - id: tool-csv
 *     name: '@deepseek-ai/dsh-tool-csv'
 *
 * 安全边界：零依赖、纯函数（不读文件/不联网/不 eval）；输入 256KB 上限；
 * 查询只做字面精确匹配，无表达式求值面；timeoutMs 2000 兜底。
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { parseCsv, normalizeDelimiter } from './parse.js';
import { queryRows, statsGrid, toJsonRows, normalizeLimit } from './query.js';
export const name = '@deepseek-ai/dsh-tool-csv';
export const inject = ['tools'];
function runAction(args) {
    const action = args.action;
    if (typeof args.csv !== 'string') {
        throw new Error('csv: csv must be a string');
    }
    const delimiter = normalizeDelimiter(args.delimiter);
    // header 默认 true；非布尔值回退默认
    const header = typeof args.header === 'boolean' ? args.header : true;
    const { rows, skippedBlank } = parseCsv(args.csv, { delimiter, header });
    if (action === 'parse' || action === 'to_json') {
        return JSON.stringify(toJsonRows(rows, header, delimiter, args.limit));
    }
    if (action === 'query') {
        if (typeof args.column !== 'string' || args.column === '') {
            throw new Error('csv: query requires a non-empty column');
        }
        if (typeof args.value !== 'string') {
            throw new Error('csv: query requires a string value');
        }
        const result = queryRows(rows, {
            column: args.column,
            value: args.value,
            header,
            limit: normalizeLimit(args.limit),
        });
        return JSON.stringify(result.rows);
    }
    if (action === 'stats') {
        return JSON.stringify(statsGrid(rows, header, skippedBlank));
    }
    throw new Error(`csv: unknown action "${action}"`);
}
export function apply(ctx) {
    ctx.tools.register(defineTool({
        name: 'csv',
        description: 'Parse, query, and summarize CSV text. ' +
            'Actions: parse (to JSON array), query (filter rows by exact column value), ' +
            'stats (row/column counts), to_json (alias of parse). ' +
            'RFC 4180, quoted fields with commas/newlines supported, BOM ignored. ' +
            'Pure text processing: no file or network access.',
        parameters: {
            action: {
                type: 'string',
                required: true,
                enum: ['parse', 'query', 'stats', 'to_json'],
                description: 'Operation to perform.',
            },
            csv: {
                type: 'string',
                required: true,
                description: 'CSV text. RFC 4180: quoted fields may contain commas, quotes ("" escaped), and newlines. A leading UTF-8 BOM is ignored.',
            },
            column: {
                type: 'string',
                description: 'Column name (when the first row is a header) or 1-based index like "2", for query.',
            },
            value: {
                type: 'string',
                description: 'Exact match value for query filtering (strict equality, not substring).',
            },
            delimiter: {
                type: 'string',
                description: 'Field delimiter, default ",". Accepts a single character, or "tab" for \\t.',
            },
            header: {
                type: 'boolean',
                description: 'Treat the first row as a header. Default true. When false, rows parse as arrays and column means a 1-based index.',
            },
            limit: {
                type: 'integer',
                description: 'Maximum rows to return (query/parse), default 100. Prevents unbounded output.',
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
