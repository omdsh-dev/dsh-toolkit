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
export interface Md2HtmlOptions {
    /** 解析相对 href/src 的基准 URL（naive join）。 */
    baseUrl?: string;
}
export declare function escapeHtml(text: string): string;
/** 分隔行检测：| --- | 或 | :--- | 等。 */
export declare function isSeparatorRow(cells: string[]): boolean;
/** 管道行 → 单元格（支持 \| 转义）。 */
export declare function splitPipe(line: string): string[];
/** Markdown → 白名单 HTML。 */
export declare function md2html(markdown: string, options?: Md2HtmlOptions): string;
