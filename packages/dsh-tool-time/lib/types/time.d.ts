/**
 * dsh-tool-time 核心实现 —— 严格 ISO 解析 + UTC 日历运算 + Intl 时区格式化。
 *
 * 契约（v2，已冻结）：
 * - 输入：严格 ISO 8601 子集（YYYY-MM-DD | YYYY-MM-DDTHH:mm:ssZ | ±HH:MM 偏移，
 *   可选 .SSS 毫秒）；不带时区的日期时间拒绝；日历溢出拒绝
 * - add：始终 UTC 运算；月/年先置 1 日→定位目标年月→按目标月最大天数钳制
 * - diff：仅固定时长（sign + 带符号总量 + absolute 余数分解），无月份/年份
 * - 时区：默认 UTC；timezoneSource: "explicit" | "default-utc"
 * - 错误统一 "time: " 前缀
 */
export interface ActionParams {
    value?: string;
    timezone?: string;
    from?: string;
    to?: string;
    amount?: number;
    unit?: string;
}
/** 默认时钟（测试可注入 fake clock） */
type Clock = () => number;
export declare function executeAction(action: string, params: ActionParams, clock?: Clock): unknown;
export {};
