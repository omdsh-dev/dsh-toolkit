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
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "@deepseek-ai/dsh-tool-csv";
export declare const inject: string[];
export declare function apply(ctx: Context): void;
