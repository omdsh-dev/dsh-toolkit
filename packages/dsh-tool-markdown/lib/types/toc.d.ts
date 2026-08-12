/**
 * Markdown 目录生成 —— 从标题行生成嵌套列表 + 锚点链接。零依赖，纯函数。
 *
 * 审查 MD-05 修复：
 * - fenced code 状态机：围栏内 `# fake` 不进入目录；
 * - 重复标题锚点自动递增（GitHub 风格 `-1/-2` 后缀）；
 * - 尾部闭合井号只在前面有空白时才剥离（`# C#` 正确保留为文本 C#）；
 * - slug 前剥离行内 Markdown 语法（`code`→code、[x](url)→x、**b**→b），
 *   与 GitHub slug 方向一致（简化实现，CJK 保留）。
 */
/** GitHub 风格锚点（简化）：小写 + 去标点 + 空白转 '-'（下划线保留）；CJK 保留。 */
export declare function slugify(text: string): string;
export interface TocEntry {
    level: number;
    text: string;
    anchor: string;
}
/** 从 Markdown 提取标题序列（跳过 fenced code 内的伪标题；重复锚点递增）。 */
export declare function extractHeadings(markdown: string): TocEntry[];
/** 标题序列 → 嵌套目录列表（2 空格/层缩进）。无标题返回空字符串。 */
export declare function toc(markdown: string): string;
