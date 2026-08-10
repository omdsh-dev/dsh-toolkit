/**
 * schema 预检查 —— 关键字类型校验、不支持关键字报告、pattern 预算、本地 `$ref`
 * 静态校验（解析、存在性、纯 `$ref` 链深/环）。
 *
 * 设计文档 §3.2 / §5.5 / §5.6：
 * - 遇到不支持的关键字绝不静默忽略：默认返回 schema issue（`unsupported-keyword`）；
 *   strictSchema=false 时为 warning 并继续处理已支持部分（结果必须 complete:false、
 *   valid:null + supportedSubsetValid）；strictSchema=true 时 schema 检查直接失败。
 * - pattern：最大 16 KiB、每个 schema 最多 100 个、必须能编译（非法 → pattern-invalid）。
 * - 本地 `$ref`：仅 `#` 与 `#/$defs/...`；目标必须存在；链最大 64；纯 `$ref` 环 → ref-cycle。
 *
 * 调用前提：json-guard 已通过（schema 无 cycle、无超限、无非 JSON 值），因此本模块
 * 的递归遍历是安全的（图无环）。返回节点路径表 nodePaths（WeakMap<object, string>，
 * 首次遇到节点时记录），供 validator 在 `$ref` 目标上报告错误时使用。
 */
import type { SchemaIssue } from './types.ts';
export interface CheckSchemaResult {
    issues: SchemaIssue[];
    /** 首次遇到节点时的 schemaPath。 */
    nodePaths: WeakMap<object, string>;
    /** 通过编译/长度检查且在 100 个预算内的 pattern 源码集合（去重）。 */
    validPatterns: Set<string>;
}
/**
 * 对 schema 根执行预检查。调用方需先对 schema 运行 json-guard（无 cycle/超限）。
 */
export declare function checkSchema(schema: unknown): CheckSchemaResult;
