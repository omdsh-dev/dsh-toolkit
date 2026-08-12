/**
 * 零依赖、无 eval / new Function 的数学表达式求值器。
 *
 * 安全模型：词法层只识别数字、白名单标识符、运算符；
 * 语法层按优先级递归下降求值；标识符按名查白名单表，查不到即抛错。
 * 任何形式的代码注入（constructor.constructor 链、process 全局、
 * 引号注入、分号语句等）均被词法/语法层拒绝。
 *
 * 白名单边界（审查 CALC-01）：FUNCTIONS/CONSTANTS 用 Object.hasOwn 判断，
 * 不落入 Object.prototype 继承属性（constructor/toString/__proto__ 等）。
 */
/**
 * 公开接口：求值表达式，返回有限数字；NaN/Infinity 或其他错误均抛错。
 * CALC-05：入口独立校验类型（不依赖上游 schema 校验）。
 */
export declare function evaluate(expression: unknown): number;
