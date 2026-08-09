/**
 * DSH 计算器工具插件。
 *
 * 注册 `calculator` 工具：安全的数学表达式求值器。
 * 接入方式：在 cordis.yml 追加：
 *   - id: tool-calculator
 *     name: '@deepseek-ai/dsh-tool-calculator'
 */
import type { Context } from 'cordis';
export declare const name = "@deepseek-ai/dsh-tool-calculator";
export declare const inject: string[];
export declare function apply(ctx: Context): void;
