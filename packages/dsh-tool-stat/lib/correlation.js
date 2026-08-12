/**
 * dsh-tool-stat correlation 核心计算 —— Pearson / Spearman。
 *
 * 契约（冻结，见 dsh-tool-stat-design.md §3.3）：
 * - Pearson：稳定的协方差/方差在线更新（Welford 风格）；
 *   任一序列零方差时返回 `defined: false, value: null, reason: 'zero-variance'`
 * - Spearman：对两个序列分别计算平均秩（ties 用 midrank），再对秩序列算 Pearson
 * - 计算结果返回前做有限数检查，溢出抛 `numeric-overflow` 错误
 *
 * 本模块不依赖 Cordis / dsh-tools；输入视为已通过 `validateStatArgs`
 * （等长、至少 2 项、有限），且不修改输入数组。
 */
import { normalizeZero } from './validate.js';
/**
 * 1-based 平均秩（ties 取 midrank）。返回与原数组同序的秩数组；
 * 不修改输入（对副本排序）。
 */
export function midranks(values) {
    const n = values.length;
    const indexed = values.map((v, i) => ({ v, i }));
    indexed.sort((a, b) => a.v - b.v);
    const ranks = new Array(n);
    let i = 0;
    while (i < n) {
        let j = i;
        // 循环条件保证下标在界内（i < n、j + 1 < n），断言仅为安抚 noUncheckedIndexedAccess
        while (j + 1 < n && indexed[j + 1].v === indexed[i].v)
            j++;
        const mid = (i + j) / 2 + 1; // (i+1 + j+1) / 2
        for (let k = i; k <= j; k++)
            ranks[indexed[k].i] = mid;
        i = j + 1;
    }
    return ranks;
}
function pearsonCore(method, x, y) {
    const n = x.length;
    let meanX = 0;
    let meanY = 0;
    let m2x = 0;
    let m2y = 0;
    let cov = 0;
    for (let i = 0; i < n; i++) {
        // x/y 等长且长度 n，下标在界内；取局部变量避免重复下标访问
        const xi = x[i];
        const yi = y[i];
        const dx = xi - meanX;
        meanX += dx / (i + 1);
        const dy = yi - meanY;
        meanY += dy / (i + 1);
        m2x += dx * (xi - meanX);
        m2y += dy * (yi - meanY);
        cov += dx * (yi - meanY);
    }
    if (m2x === 0 || m2y === 0) {
        return { action: 'correlation', method, count: n, defined: false, value: null, reason: 'zero-variance' };
    }
    const denom = Math.sqrt(m2x * m2y);
    if (!Number.isFinite(denom) || !Number.isFinite(cov)) {
        throw new Error('stat: numeric-overflow: correlation produced a non-finite value');
    }
    const value = cov / denom;
    if (!Number.isFinite(value)) {
        throw new Error('stat: numeric-overflow: correlation produced a non-finite value');
    }
    return { action: 'correlation', method, count: n, defined: true, value: normalizeZero(value), reason: null };
}
/** correlation action。`method='spearman'` 时先对两序列分别做 midrank。 */
export function correlationValues(x, y, method) {
    if (method === 'spearman') {
        return pearsonCore(method, midranks(x), midranks(y));
    }
    return pearsonCore(method, x, y);
}
