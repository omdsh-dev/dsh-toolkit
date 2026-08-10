/**
 * normalize action —— 深拷贝数据，对缺失属性应用显式 `default` 后完整验证。
 *
 * 设计文档 §6（v1 严格限定）：
 * - 从不修改输入对象，先构造 JSON 深拷贝；所有新对象用 Object.create(null)，
 *   `__proto__`/`constructor`/`prototype` 作为普通 JSON 键处理（null-prototype
 *   对象无继承 setter，赋值天然安全）；
 * - 只应用 `properties` 中缺失字段的显式 `default`；
 * - 不做类型强制转换；不删除 additional properties；不猜测 enum/const；
 * - 不通过网络或代码计算 default；
 * - default 自身必须 JSON-compatible 且通过对应子 schema（否则跳过 + warning）；
 * - 对 oneOf/anyOf 不自动选分支应用 default：仅当恰好一个分支在不应用 default
 *   时已经匹配，才允许进入该分支；否则保持不变并给 warning；
 * - 返回 appliedDefaults 路径列表，再对结果运行完整 validate。
 */
import { type ValidateOptions } from './validator.ts';
import type { NormalizeResult } from './types.ts';
/** 深拷贝：新对象均为 null-prototype；WeakMap 防御输入环（守卫已拒绝，双保险）。 */
export declare function deepCopyJson<T>(value: T): T;
/** normalize action。 */
export declare function normalizeAction(data: unknown, schema: unknown, opts: ValidateOptions): Promise<NormalizeResult>;
