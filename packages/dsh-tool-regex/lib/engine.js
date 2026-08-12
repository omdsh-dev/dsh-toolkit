/**
 * 正则执行引擎 —— test / find / replace + action 分发。零依赖，纯函数。
 *
 * 安全设计（ReDoS + 资源上限，多层防线）：
 * 1. 输入长度上限 MAX_INPUT_BYTES = 64,000 字节；pattern 上限 MAX_PATTERN_BYTES；
 *    replacement 上限 MAX_REPLACEMENT_BYTES；统一输出上限 MAX_OUTPUT_BYTES。
 * 2. 匹配数上限 MAX_MATCHES（find/replace 的 limit 被钳制到该值）。
 * 3. 硬超时：index.ts 把 test/find/replace 派发到可终止的 worker 线程，
 *    WORKER_BUDGET_MS 到期调用 worker.terminate()——同步 V8 回溯不再能阻塞宿主。
 *    worker 内通过 executeAction 再次执行全部上限校验。
 * 4. explain 只做静态 tokenizer（线性扫描），不构造 RegExp，天然免疫 ReDoS。
 *
 * flags 校验：逐字符校验（g i m s u y d v），重复 flag 报错；find/replace 自动补 'g'。
 *
 * replace 实现：String.prototype.replace 的字符串替换路径（JS 原生 $-语义），
 * 独立 exec 循环计数替换次数；空匹配推进实现 ECMAScript AdvanceStringIndex
 * （u/v 标志下按 surrogate pair 推进，否则按 1 个 UTF-16 code unit）。
 */
import { explainPattern } from './explain.js';
export const MAX_INPUT_BYTES = 64_000;
export const MAX_PATTERN_BYTES = 16_384;
export const MAX_REPLACEMENT_BYTES = 16_384;
export const MAX_OUTPUT_BYTES = 1_000_000;
export const MAX_MATCHES = 1_000;
export const MAX_EXPLAIN_NODES = 4_096;
const VALID_FLAGS = 'dgimsuyv';
const DEFAULT_LIMIT = 50;
/** 规范化 limit：非法值回退默认 50；超过 MAX_MATCHES 钳制到 MAX_MATCHES。 */
export function normalizeLimit(limit) {
    if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 1) {
        return DEFAULT_LIMIT;
    }
    return Math.min(Math.floor(limit), MAX_MATCHES);
}
/** 字节守卫：超上限报错（不截断）。 */
function assertBytes(value, max, label) {
    if (Buffer.byteLength(value, 'utf8') > max) {
        throw new Error(`regex: ${label} exceeds ${max} bytes`);
    }
}
/** 编译 pattern + flags；flags 逐字符校验，重复/非法 flag 报错；pattern 有字节上限。 */
export function compilePattern(pattern, flags, options) {
    if (typeof pattern !== 'string') {
        throw new Error('regex: pattern must be a string');
    }
    assertBytes(pattern, MAX_PATTERN_BYTES, 'pattern');
    const flagStr = flags === undefined || flags === null ? '' : String(flags);
    const seen = new Set();
    for (const ch of flagStr) {
        if (seen.has(ch))
            throw new Error(`regex: duplicate flag "${ch}"`);
        if (!VALID_FLAGS.includes(ch))
            throw new Error(`regex: invalid flag "${ch}"`);
        seen.add(ch);
    }
    const forceGlobal = options?.forceGlobal === true;
    const effective = forceGlobal && !flagStr.includes('g') ? flagStr + 'g' : flagStr;
    try {
        return new RegExp(pattern, effective);
    }
    catch (error) {
        // SyntaxError message 通常含 "at position N"
        throw new Error(`regex: invalid pattern: ${String(error.message)}`);
    }
}
/** 输入大小守卫：超 MAX_INPUT_BYTES 直接拒绝（不截断）。 */
export function assertInputSize(input) {
    if (typeof input !== 'string') {
        throw new Error('regex: input must be a string');
    }
    assertBytes(input, MAX_INPUT_BYTES, 'input');
}
/**
 * ECMAScript AdvanceStringIndex：空匹配的 lastIndex 推进。
 * u/v（Unicode）模式下，当前位置若处于高代理项且后跟低代理项，按 2 个
 * UTF-16 code unit 推进，否则 1；非 Unicode 模式恒为 1。
 */
function advanceStringIndex(input, index, unicode) {
    if (!unicode)
        return index + 1;
    if (index + 1 < input.length) {
        const first = input.charCodeAt(index);
        if (first >= 0xd800 && first <= 0xdbff) {
            const second = input.charCodeAt(index + 1);
            if (second >= 0xdc00 && second <= 0xdfff)
                return index + 2;
        }
    }
    return index + 1;
}
/** test：判断是否匹配（整串 ^...$ 语义由模型自行用锚点表达）。 */
export function testMatch(re, input) {
    re.lastIndex = 0;
    return { matched: re.test(input) };
}
/** find：收集所有匹配 + 捕获组，受 limit 约束（钳制到 MAX_MATCHES）。 */
export function findAll(re, input, limit) {
    const cap = normalizeLimit(limit);
    const unicode = re.unicode || re.unicodeSets;
    const out = [];
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(input)) !== null) {
        out.push({
            index: m.index,
            match: m[0],
            captures: m.slice(1),
            groups: m.groups ? { ...m.groups } : null,
        });
        if (out.length >= cap)
            break;
        if (m[0].length === 0) {
            // 空匹配推进：u/v 下按 code point 边界推进，避免重复命中/死循环
            re.lastIndex = advanceStringIndex(input, re.lastIndex, unicode);
        }
    }
    return out;
}
/** replace：全局替换（编译时已强制 'g'），返回结果文本与替换次数。 */
export function replaceAll(re, input, replacement) {
    if (typeof replacement !== 'string') {
        throw new Error('regex: replacement must be a string');
    }
    assertBytes(replacement, MAX_REPLACEMENT_BYTES, 'replacement');
    const unicode = re.unicode || re.unicodeSets;
    // 计数 pass：与 replace 相同的遍历语义（含空匹配推进规则）
    let replaced = 0;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(input)) !== null) {
        replaced++;
        if (m[0].length === 0) {
            re.lastIndex = advanceStringIndex(input, re.lastIndex, unicode);
        }
    }
    // 执行 pass：字符串替换路径（JS 原生 $-语义，回调路径不会二次展开）
    re.lastIndex = 0;
    const result = input.replace(re, replacement);
    assertBytes(result, MAX_OUTPUT_BYTES, 'result');
    return { result, replaced };
}
/** 按 action 分发执行（worker 与主线程共用；worker 内再次执行全部上限校验）。 */
export function executeAction(args) {
    const flags = typeof args.flags === 'string' && args.flags !== '' ? args.flags : undefined;
    const limit = normalizeLimit(args.limit);
    let value;
    switch (args.action) {
        case 'test': {
            assertInputSize(args.input);
            const re = compilePattern(args.pattern, flags);
            value = testMatch(re, args.input);
            break;
        }
        case 'find': {
            assertInputSize(args.input);
            // 无 g 自动补 g：否则只能拿到第一个匹配，语义意外（文档明确说明）
            const re = compilePattern(args.pattern, flags, { forceGlobal: true });
            value = findAll(re, args.input, limit);
            break;
        }
        case 'replace': {
            assertInputSize(args.input);
            const re = compilePattern(args.pattern, flags, { forceGlobal: true });
            value = replaceAll(re, args.input, args.replacement);
            break;
        }
        case 'explain': {
            // 静态解析：不构造 RegExp、不执行匹配
            value = explainPattern(args.pattern);
            break;
        }
        default:
            throw new Error(`regex: unknown action "${args.action}"`);
    }
    const text = JSON.stringify(value);
    assertBytes(text, MAX_OUTPUT_BYTES, 'output');
    return text;
}
