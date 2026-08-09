/**
 * RFC 4180 CSV 状态机解析器 —— 零依赖，纯函数，单遍扫描 O(n)。
 *
 * 边界处理：
 * - 引号只在字段开头生效（`"` 前有内容则按字面量处理，与多数 CSV 库一致）
 * - 引号内逗号/换行/CRLF 视为字段内容；`""` 转义为单个 `"`
 * - CRLF 归一化：`\r\n` 记一行，单独 `\r` 也记一行
 * - 首行 UTF-8 BOM（U+FEFF）剥离
 * - 全空字段的行（空行）跳过，不产生记录（与 pandas skip_blank_lines 语义一致），
 *   计数通过 ParseResult.skippedBlank 返回（供 stats 动作报告空行数）
 * - 输入超过 MAX_INPUT_BYTES 直接拒绝（不截断——截断会产生错误数据）
 *
 * 与设计文档的唯一偏差：parseCsv 返回 { rows, skippedBlank } 而非裸 string[][]，
 * 以携带空行计数；rows 语义与文档完全一致。
 */
export const MAX_INPUT_BYTES = 256_000;
/** 校验分隔符：单 UTF-16 code unit 或 "tab"；拒绝 surrogate pair 与控制字符（除 \t）。 */
export function normalizeDelimiter(delimiter) {
    if (delimiter === undefined || delimiter === null)
        return ',';
    if (typeof delimiter !== 'string') {
        throw new Error('csv: delimiter must be a single character or "tab"');
    }
    if (delimiter === 'tab')
        return '\t';
    // UTF-16 单元数：非 BMP 字符（如 😀）长度为 2，解析器按 code unit 比较无法匹配，
    // 必须拒绝；同时拒绝换行等控制字符（会改变行解析语义）。
    if (delimiter.length !== 1) {
        throw new Error('csv: delimiter must be a single character or "tab"');
    }
    const code = delimiter.charCodeAt(0);
    if (code < 0x20 && delimiter !== '\t') {
        throw new Error('csv: delimiter must be a single character or "tab" (control characters are not allowed)');
    }
    return delimiter;
}
/** 解析 CSV 文本为字符串网格；跳过空行；BOM 剥离；输入字节上限检查；严格引号校验。 */
export function parseCsv(text, options) {
    if (typeof text !== 'string') {
        throw new Error('csv: csv must be a string');
    }
    if (Buffer.byteLength(text, 'utf8') > MAX_INPUT_BYTES) {
        throw new Error(`csv: input exceeds ${MAX_INPUT_BYTES} bytes`);
    }
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    let afterQuote = false; // 闭合引号后只允许分隔符/行结束/EOF
    let skippedBlank = 0;
    let i = 0;
    const len = text.length;
    const delim = options.delimiter;
    // BOM 剥离
    if (text.charCodeAt(0) === 0xfeff)
        i = 1;
    const pushField = () => {
        row.push(field);
        field = '';
    };
    const pushRow = () => {
        pushField();
        if (row.some(f => f !== '')) {
            rows.push(row);
        }
        else {
            skippedBlank++;
        }
        row = [];
    };
    for (; i < len; i++) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i++;
                } // "" 转义
                else {
                    inQuotes = false;
                    afterQuote = true;
                } // 闭合引号
            }
            else {
                field += ch;
            }
        }
        else if (afterQuote) {
            // RFC 4180：闭合引号后只允许分隔符、行结束或 EOF
            if (ch === delim) {
                pushField();
                afterQuote = false;
            }
            else if (ch === '\n' || ch === '\r') {
                if (ch === '\r' && text[i + 1] === '\n')
                    i++;
                pushRow();
                afterQuote = false;
            }
            else {
                throw new Error(`csv: invalid character "${ch}" after closing quote at position ${i}`);
            }
        }
        else if (ch === '"' && field === '') {
            inQuotes = true; // 仅字段开头是引号时进入引用态
        }
        else if (ch === delim) {
            pushField();
        }
        else if (ch === '\n' || ch === '\r') {
            // CRLF 归一：\r 后跟 \n 时只记一行
            if (ch === '\r' && text[i + 1] === '\n')
                i++;
            pushRow();
        }
        else {
            field += ch;
        }
    }
    // 无结尾换行时收尾（避免吞掉最后一行）
    if (inQuotes) {
        throw new Error('csv: unterminated quoted field (missing closing quote)');
    }
    if (field !== '' || row.length > 0)
        pushRow();
    return { rows, skippedBlank };
}
