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
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "@deepseek-ai/dsh-tool-markdown";
export declare const inject: string[];
export declare function apply(ctx: Context): void;
