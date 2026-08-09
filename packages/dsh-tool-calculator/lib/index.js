/**
 * DSH 计算器工具插件。
 *
 * 注册 `calculator` 工具：安全的数学表达式求值器。
 * 接入方式：在 cordis.yml 追加：
 *   - id: tool-calculator
 *     name: '@deepseek-ai/dsh-tool-calculator'
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { evaluate } from "./evaluate.js";
export const name = '@deepseek-ai/dsh-tool-calculator';
export const inject = ['tools'];
export function apply(ctx) {
    ctx.tools.register(defineTool({
        name: 'calculator',
        description: 'Evaluate a mathematical expression safely. ' +
            'Supports +, -, *, /, %, **, parentheses, and functions: ' +
            'abs, ceil, floor, round, max, min, sqrt, pow, log, log2, log10, exp, sin, cos, tan, PI, E.',
        parameters: {
            expression: {
                type: 'string',
                required: true,
                description: 'Mathematical expression, e.g. "15 + 27 * sqrt(9)"',
            },
        },
        output: {
            schema: { type: 'number' },
            render: (_args, value) => [{ type: 'text', text: String(value) }],
        },
        execute: args => Promise.resolve(evaluate(args.expression)),
        timeoutMs: 1000,
    }));
}
