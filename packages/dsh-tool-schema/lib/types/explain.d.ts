/**
 * explain action —— 静态解释 schema 的约束树（有限节点列表，非自然语言长文）。
 *
 * 设计文档 §7：返回有限约束节点列表，如
 *   { "schemaPath": "#", "summary": "object; requires: name" }
 * 节点数上限 MAX_EXPLAIN_NODES，超出截断并置 truncated。explain 只做静态遍历，
 * 不构造 RegExp、不匹配、不执行任何代码。
 *
 * schema 预检查（checkSchema）与 explain 复用：不支持的 schema 关键字同样在
 * schemaIssues 中报告（绝不静默忽略）；节点摘要仅覆盖已支持关键字。
 */
import type { ExplainResult } from './types.ts';
export interface ExplainOptions {
    strictSchema: boolean;
}
/** explain action。 */
export declare function explainSchema(schema: unknown, _opts: ExplainOptions): ExplainResult;
