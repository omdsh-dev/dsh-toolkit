/**
 * DSH 时间工具插件。
 *
 * 注册 `time` 工具：严格 ISO 解析、IANA 时区转换、UTC 日历运算、固定时长差。
 * 接入方式：在 cordis.yml 追加：
 *   - id: tool-time
 *     name: '@deepseek-ai/dsh-tool-time'
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "@deepseek-ai/dsh-tool-time";
export declare const inject: string[];
export declare function apply(ctx: Context): void;
