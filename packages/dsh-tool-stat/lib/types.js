/**
 * dsh-tool-stat 结果类型（canonical JSON 输出形状）。
 *
 * 所有数值字段都保证是有限 number（-0 已规范化为 0）；实现层在返回前
 * 再次做有限数检查，任何溢出都抛 `numeric-overflow` 错误，绝不让输出
 * 携带 Infinity / NaN。
 */
export {};
