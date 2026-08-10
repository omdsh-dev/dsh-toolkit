/**
 * 资源限制常量（设计文档 §8）。
 *
 * 所有限制均为硬边界：超限即报错/截断，绝不无限增长。
 */
/** data UTF-8 估算大小上限（字节）。 */
export const MAX_DATA_BYTES = 256 * 1024;
/** schema UTF-8 估算大小上限（字节）。 */
export const MAX_SCHEMA_BYTES = 256 * 1024;
/** data/schema 最大嵌套深度。 */
export const MAX_DEPTH = 64;
/** 最大 schema 节点数（去重后的对象图节点）。 */
export const MAX_SCHEMA_NODES = 10_000;
/** 最大 instance 遍历节点数（验证过程中的访问次数，含组合分支重访）。 */
export const MAX_INSTANCE_NODES = 100_000;
/** 默认/最大错误数。 */
export const DEFAULT_MAX_ERRORS = 100;
export const MAX_ERRORS = 1_000;
/** 组合关键字（anyOf/oneOf/not）单分支摘要最多保留的错误数。 */
export const MAX_BRANCH_ERRORS = 3;
/** 最大 `$ref` 链长。 */
export const MAX_REF_CHAIN = 64;
/** 最大 pattern 数（每个 schema）。 */
export const MAX_PATTERNS = 100;
/** 单 pattern 长度上限（字节，UTF-8）。 */
export const MAX_PATTERN_BYTES = 16 * 1024;
/** pattern 验证总硬预算（ms）；到期 worker.terminate()。 */
export const PATTERN_BUDGET_MS = 1_000;
/** 工具 timeoutMs。 */
export const TOOL_TIMEOUT_MS = 3_000;
/** 最大 canonical 输出（字节，JSON.stringify 后）。 */
export const MAX_OUTPUT_BYTES = 1_000_000;
/** explain 节点数上限。 */
export const MAX_EXPLAIN_NODES = 4_096;
/** multipleOf 缩放/容差策略的相对容差（见 validator.ts isMultipleOf 实现说明）。 */
export const MULTIPLE_OF_TOLERANCE = 1e-9;
