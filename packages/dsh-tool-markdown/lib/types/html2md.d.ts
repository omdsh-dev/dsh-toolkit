/**
 * DOM → Markdown（GFM 子集）—— 零依赖，纯函数。
 *
 * 映射：h1-h6/p/ul/ol/li/blockquote/pre/code/hr/br/a/img/strong/em/table；
 * 未知/容器元素（div/span/section…）递归透传。
 *
 * 安全：
 * - 链接 scheme 白名单（http/https/mailto；javascript:/data: 降级为纯文本）；
 * - baseUrl 提供时把相对 href/src 解析为绝对（naive join，文档注明限制）；
 * - 表格单元格内容中的 '|' 转义为 '\|'。
 */
import { type HtmlNode } from './html.ts';
export interface Html2MdOptions {
    /** 解析相对 href/src 的基准 URL（naive join）。 */
    baseUrl?: string;
}
/** HTML <table> 节点 → GFM 表格文本（导出供 table 动作复用）。 */
export declare function tableToGfm(node: HtmlNode, options?: Html2MdOptions): string;
/** HTML → Markdown（GFM 子集）。 */
export declare function html2md(html: string, options?: Html2MdOptions): string;
