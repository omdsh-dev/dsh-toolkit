/**
 * dsh-tool-encoding 核心实现 —— UTF-8 文本编解码 + 哈希 + UUID。
 *
 * 契约（v2，已冻结）：
 * - v1 是 UTF-8 文本工具：所有输入输出为字符串；解码结果必须合法 UTF-8（fatal 解码）
 * - 输入/输出上限按 UTF-8 字节数：MAX_INPUT_BYTES = 1 MB（1,000,000），MAX_OUTPUT_BYTES = 4 MB（4,000,000）
 * - 孤立 surrogate 统一拒绝（String.prototype.isWellFormed）
 * - base64：无空白、`=` 仅末尾且 ≤2、长度 4 的倍数、模 4 余 1 拒绝
 * - base64url：输出 canonical 无 padding；解码兼容 `+/` 与可选 padding
 * - url_encode 是 component 语义（encodeURIComponent）
 * - 错误统一 "encoding: " 前缀
 */
export interface ActionParams {
    input?: string;
    algorithm?: string;
}
export declare function executeAction(action: unknown, params: unknown): string;
