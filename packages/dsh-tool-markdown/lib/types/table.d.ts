/**
 * 表格规范化 —— HTML <table> 或管道分隔文本 → GFM 表格。零依赖，纯函数。
 *
 * - HTML 输入：走 html.ts 解析，取第一个 <table>；
 * - 管道文本输入：首行为表头（已有分隔行则保留结构）；
 * - 列数不一致补空单元格；单元格内 '|' 转义；空单元格保留。
 */
import { type Html2MdOptions } from './html2md.ts';
export interface TableOptions extends Html2MdOptions {
    /** 仅支持 'gfm'（默认）。 */
    format?: string;
}
/** 任意分隔文本或 HTML table → GFM 表格文本。 */
export declare function normalizeTable(text: string, options?: TableOptions): string;
