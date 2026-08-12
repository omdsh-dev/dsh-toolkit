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
export declare const MAX_INPUT_BYTES = 64000;
export declare const MAX_PATTERN_BYTES = 16384;
export declare const MAX_REPLACEMENT_BYTES = 16384;
export declare const MAX_OUTPUT_BYTES = 1000000;
export declare const MAX_MATCHES = 1000;
export declare const MAX_EXPLAIN_NODES = 4096;
export interface FindMatch {
    /** 匹配起始下标（0-based，UTF-16 code unit 索引）。 */
    index: number;
    /** 完整匹配文本。 */
    match: string;
    /** 编号捕获组（m.slice(1)；未参与匹配的组为 undefined；无捕获组时为空数组）。 */
    captures: Array<string | undefined>;
    /** 命名捕获组（无命名组时为 null；未参与匹配的组为 undefined）。 */
    groups: Record<string, string | undefined> | null;
}
export interface ReplaceResult {
    result: string;
    replaced: number;
}
export interface CompileOptions {
    /** 是否强制补 'g'（find/replace 需要；test 不补，避免 stateful lastIndex 干扰）。 */
    forceGlobal?: boolean;
}
export interface RegexActionArgs {
    action: string;
    pattern?: unknown;
    input?: unknown;
    flags?: unknown;
    replacement?: unknown;
    limit?: unknown;
}
/** 规范化 limit：非法值回退默认 50；超过 MAX_MATCHES 钳制到 MAX_MATCHES。 */
export declare function normalizeLimit(limit: unknown): number;
/** 编译 pattern + flags；flags 逐字符校验，重复/非法 flag 报错；pattern 有字节上限。 */
export declare function compilePattern(pattern: unknown, flags: unknown, options?: CompileOptions): RegExp;
/** 输入大小守卫：超 MAX_INPUT_BYTES 直接拒绝（不截断）。 */
export declare function assertInputSize(input: unknown): void;
/** test：判断是否匹配（整串 ^...$ 语义由模型自行用锚点表达）。 */
export declare function testMatch(re: RegExp, input: string): {
    matched: boolean;
};
/** find：收集所有匹配 + 捕获组，受 limit 约束（钳制到 MAX_MATCHES）。 */
export declare function findAll(re: RegExp, input: string, limit: number): FindMatch[];
/** replace：全局替换（编译时已强制 'g'），返回结果文本与替换次数。 */
export declare function replaceAll(re: RegExp, input: string, replacement: unknown): ReplaceResult;
/** 按 action 分发执行（worker 与主线程共用；worker 内再次执行全部上限校验）。 */
export declare function executeAction(args: RegexActionArgs): string;
