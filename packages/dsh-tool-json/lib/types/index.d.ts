/**
 * DSH JSON 查询工具插件。
 *
 * 注册 `json` 工具：JMESPath 核心子集查询。
 * 接入方式：在 cordis.yml 追加：
 *   - id: tool-json
 *     name: '@deepseek-ai/dsh-tool-json'
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "@deepseek-ai/dsh-tool-json";
export declare const inject: string[];
export declare function apply(ctx: Context): void;
