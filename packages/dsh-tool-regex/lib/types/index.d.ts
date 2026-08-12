/**
 * DSH 正则工具插件。
 *
 * 注册 `regex` 工具：测试匹配、提取捕获组、安全替换、静态解释正则（不执行代码）。
 * 接入方式：在 cordis.yml 追加：
 *   - id: tool-regex
 *     name: '@deepseek-ai/dsh-tool-regex'
 *
 * 安全边界（ReDoS 多层防线）：
 * - test/find/replace 在**可终止的 worker 线程**内同步执行，WORKER_BUDGET_MS
 *   到期 worker.terminate() 并返回 `regex: execution timed out`——灾难性回溯
 *   不再能阻塞宿主进程（工具管道的 timeoutMs 对同步阻塞体是协作式，仅靠它不够）。
 * - 输入 64KB / pattern 16KB / replacement 16KB / 输出 1MB / 匹配数 1000 上限
 *   （worker 内再次校验）。
 * - explain 只做静态 tokenizer，不构造 RegExp，天然免疫 ReDoS，保持同步执行。
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "@deepseek-ai/dsh-tool-regex";
export declare const inject: string[];
export declare function apply(ctx: Context): void;
