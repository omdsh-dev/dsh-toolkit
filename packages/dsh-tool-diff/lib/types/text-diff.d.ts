/**
 * 行级 Myers diff 与 unified diff 渲染 —— 零依赖，纯函数。
 *
 * - 输入按 \n 分行（CRLF 先归一为 LF），保留末尾换行信息；
 * - Myers O(ND) 迭代实现（非递归，避免大输入调用栈增长）；
 * - 高度差异输入设置 diagonal 预算：超限回退"全删全增"表示（结果仍正确，只是非最小）；
 * - unified diff 渲染：`--- before` / `+++ after` / `@@ -s,c +s,c @@`，
 *   无时间戳（可复现）；末尾无换行输出 `\ No newline at end of file`。
 */
export interface Line {
    text: string;
    hash: number;
}
export interface DiffOp {
    type: 'equal' | 'insert' | 'delete';
    text: string;
}
export interface DiffOptions {
    ignoreWhitespace?: boolean;
    ignoreCase?: boolean;
}
/** 把文本拆成带 hash 的行（保留末尾换行信息）。空文本：无行、无末尾换行。 */
export declare function splitLines(text: string): {
    lines: Line[];
    trailingNewline: boolean;
};
/**
 * Myers 行级 diff。
 * 返回操作序列；D 超预算或规模超限时回退"全删全增"（结果正确、非最小）。
 *
 * 复杂度防线（恶意重复/全异文本）：
 * 1. 公共前缀/后缀修剪（O(n+m)）；
 * 2. hash 快速拒绝：剩余两侧无公共行 → 立即回退，不进入 Myers；
 * 3. 剩余规模 np+mp > 4000 → 回退（trace 内存上限 ≈ 2001×8001×4B ≈ 64MB）；
 * 4. diagonal 预算 MAX_D=2000 超限 → 回退。
 */
export declare function diffLines(before: Line[], after: Line[], options?: DiffOptions): DiffOp[];
export declare function lineStats(ops: DiffOp[]): {
    addedLines: number;
    removedLines: number;
    unchangedLines: number;
};
/**
 * 实际渲染用的 op 序列：仅末尾换行差异（行级全 equal 但字节不同）时，
 * 把最后一行（或空文件占位）合成 delete+insert，使 diff 文本、stats、equal 三者同源。
 */
export declare function effectiveOps(ops: DiffOp[], beforeTrailing: boolean, afterTrailing: boolean): DiffOp[];
/** 渲染 unified diff（无时间戳，可复现，GNU 标记位置语义）。 */
export declare function renderUnified(beforeLabel: string, afterLabel: string, before: Line[], after: Line[], ops: DiffOp[], context: number, beforeTrailing: boolean, afterTrailing: boolean): string;
/** 便捷入口：两段文本 → unified diff 文本（空串表示相等）。 */
export declare function unifiedDiff(beforeText: string, afterText: string, options?: {
    context?: number;
    ignoreWhitespace?: boolean;
    ignoreCase?: boolean;
}): {
    diff: string;
    ops: DiffOp[];
    stats: {
        addedLines: number;
        removedLines: number;
        unchangedLines: number;
    };
};
