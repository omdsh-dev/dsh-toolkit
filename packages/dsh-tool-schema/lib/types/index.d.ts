/**
 * DSH JSON Schema 验证工具插件。
 *
 * 注册 `schema` 工具：validate / paths / explain / normalize。
 * 接入方式：在 cordis.yml 追加：
 *   - id: tool-schema
 *     name: '@deepseek-ai/dsh-tool-schema'
 *
 * 设计文档要点：
 * - 统一 `{ type: 'json' }` canonical output；render 为 JSON.stringify；
 * - execute 非 async：同步构造并返回 Promise.resolve(结果 as JsonValue)；
 * - timeoutMs 3000（pattern worker 另有 1000ms 硬预算）；
 * - validate/paths/normalize 必须显式提供 `data`（null 是合法数据）；
 * - strictSchema 默认 true；maxErrors 默认 100、范围 1..1000；
 * - 输出上限 1 MiB：超限时截断 errors/schemaIssues 等数组并置 truncated。
 */
import type { Context } from 'cordis';
export declare const name = "@deepseek-ai/dsh-tool-schema";
export declare const inject: string[];
/**
 * canonical 输出上限：JSON.stringify 后超过 MAX_OUTPUT_BYTES 时，渐进截断
 * 可裁剪数组（errors/schemaIssues/nodes/warnings/paths/appliedDefaults）并置
 * truncated。value 恒 ≤ data 上限（256 KiB），无需裁剪。
 */
export declare function capJsonOutput<T>(value: T): T;
export declare function apply(ctx: Context): void;
