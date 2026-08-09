/**
 * DSH 时间工具插件。
 *
 * 注册 `time` 工具：严格 ISO 解析、IANA 时区转换、UTC 日历运算、固定时长差。
 * 接入方式：在 cordis.yml 追加：
 *   - id: tool-time
 *     name: '@deepseek-ai/dsh-tool-time'
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { executeAction } from "./time.js";
export const name = '@deepseek-ai/dsh-tool-time';
export const inject = ['tools'];
export function apply(ctx) {
    ctx.tools.register(defineTool({
        name: 'time',
        description: 'Time utilities: current time (default UTC), IANA timezone conversion, ' +
            'UTC calendar arithmetic (add/subtract with month-end clamping), and ' +
            'fixed-duration difference between two strict ISO 8601 timestamps. ' +
            'Actions: now, convert, add, diff.',
        parameters: {
            action: {
                type: 'string',
                required: true,
                enum: ['now', 'convert', 'add', 'diff'],
                description: 'Operation to perform.',
            },
            value: {
                type: 'string',
                description: 'Strict ISO 8601 timestamp (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ssZ with optional .SSS and +/-HH:MM offset) for convert/add.',
            },
            timezone: {
                type: 'string',
                description: 'IANA timezone name, e.g. "Asia/Shanghai" (default: UTC; display only, arithmetic stays UTC).',
            },
            from: {
                type: 'string',
                description: 'Start timestamp for diff (strict ISO 8601).',
            },
            to: {
                type: 'string',
                description: 'End timestamp for diff (strict ISO 8601).',
            },
            amount: {
                type: 'integer',
                description: 'Signed safe-integer amount for add (e.g. 3 or -2).',
            },
            unit: {
                type: 'string',
                enum: ['seconds', 'minutes', 'hours', 'days', 'weeks', 'months', 'years'],
                description: 'Unit for add.',
            },
        },
        output: {
            schema: { type: 'json' },
            render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
        },
        execute: (args) => {
            const { action, ...rest } = args;
            return Promise.resolve(executeAction(action, rest));
        },
        timeoutMs: 1000,
    }));
}
