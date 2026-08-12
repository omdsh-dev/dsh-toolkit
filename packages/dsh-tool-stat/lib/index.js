/**
 * DSH 统计工具插件。
 *
 * 注册 `stat` 工具：描述统计、百分位数、频数分布、相关性计算。
 * 接入方式：在 cordis.yml 追加：
 *   - id: tool-stat
 *     name: '@deepseek-ai/dsh-tool-stat'
 *
 * 契约（冻结，见 dsh-tool-stat-design.md）：
 * - 4 个 action：describe / percentile / frequency / correlation
 * - 只接受显式传入的有限数值数组；拒绝 NaN / Infinity；-0 规范化为 0
 * - 数值稳定性：Neumaier 补偿求和、Welford 方差、线性插值百分位、Spearman midrank
 * - 结果返回前再次有限数检查，溢出抛 `numeric-overflow` 错误，
 *   绝不让 canonical JSON 输出包含 Infinity / NaN
 * - 资源边界：最大 100000 观测、100 个百分位数、10000 distinct 输出；timeoutMs 2000
 * - 不读取文件、不访问网络、不创建进程、不保存状态；不修改输入数组
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { validateStatArgs } from './validate.js';
import { describeValues, percentileValues } from './describe.js';
import { frequencyValues } from './frequency.js';
import { correlationValues } from './correlation.js';
export const name = '@deepseek-ai/dsh-tool-stat';
export const inject = ['tools'];
/**
 * `stat` 工具入口：校验参数后按 action 分发。
 * 校验失败抛 `stat: ...` 错误；计算结果溢出抛 `numeric-overflow` 错误。
 */
export function runStatAction(args) {
    const { action, values, other, percentiles, method, sample } = validateStatArgs(args);
    switch (action) {
        case 'describe':
            return describeValues(values, sample);
        case 'percentile':
            return percentileValues(values, percentiles);
        case 'frequency':
            return frequencyValues(values);
        case 'correlation':
            return correlationValues(values, other, method);
    }
}
export function apply(ctx) {
    ctx.tools.register(defineTool({
        name: 'stat',
        description: 'Deterministic statistics over explicit finite numeric arrays. ' +
            'Actions: describe (count/sum/min/max/mean/median/variance/standardDeviation/q1/q3/iqr, ' +
            'Neumaier compensated sum + Welford variance, population or sample), ' +
            'percentile (one or more percentiles 0..100, linear interpolation h=(n-1)*p, output keeps request order, duplicates kept), ' +
            'frequency (value/count/ratio grouped by strict equality, ascending output, ratio denominators use the original count), ' +
            'correlation (Pearson or Spearman midrank; zero-variance pairs return defined=false with reason "zero-variance"). ' +
            'Rejects NaN/Infinity; -0 is normalized to 0; inputs are never modified; results are re-checked for finiteness ' +
            '(numeric-overflow errors are returned instead of emitting non-finite JSON). ' +
            'Limits: 1..100000 observations, at most 100 percentiles, at most 10000 distinct output entries.',
        parameters: {
            action: {
                type: 'string',
                required: true,
                enum: ['describe', 'percentile', 'frequency', 'correlation'],
                description: 'Operation to perform.',
            },
            values: {
                type: 'array',
                required: true,
                items: { type: 'number' },
                description: 'Finite numeric observations (1..100000). -0 is normalized to 0.',
            },
            other: {
                type: 'array',
                items: { type: 'number' },
                description: 'Paired observations for correlation; must have the same length as values (at least 2).',
            },
            percentiles: {
                type: 'array',
                items: { type: 'number' },
                description: 'Percentiles in 0..100 for percentile (1..100 items); output keeps request order.',
            },
            method: {
                type: 'string',
                enum: ['pearson', 'spearman'],
                description: 'Correlation method (default pearson).',
            },
            sample: {
                type: 'boolean',
                description: 'Use the sample (n-1) variance denominator (default false = population).',
            },
        },
        output: {
            schema: { type: 'json' },
            render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
        },
        execute: (args) => {
            // 非 async：同步计算 + Promise.resolve；结果接口无隐式索引签名，
            // 经 unknown 双断言转换为 canonical JsonValue（数值输出已保证有限）。
            return Promise.resolve(runStatAction(args));
        },
        timeoutMs: 2000,
    }));
}
