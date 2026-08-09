/**
 * Markdown 结构化 diff —— 零依赖，纯函数。
 *
 * - 轻量块级 tokenizer：ATX 标题、围栏代码块、列表项、引用块、表格、分隔线、
 *   内联 HTML 注释；其余按空行分段落；无法识别的语法按普通文本块保留，不丢弃；
 * - 输出协议（§3.5）：
 *   - headingChanges：[{ op: add|remove|rename, before, after, level, index }]；
 *   - blockChanges：[{ op: add|remove|replace, path, before, after }]，path 形如 `h2[1]/p[0]`；
 *   - codeBlockChanges：[{ language, beforeLines, afterLines }]；
 *   - diff：两块文档的 unified diff（可选）。
 */
export interface MdBlock {
    kind: 'heading' | 'fence' | 'list' | 'quote' | 'table' | 'paragraph' | 'hr' | 'html' | 'blank';
    line: number;
    level?: number;
    headingText?: string;
    path?: string;
    language?: string;
    text: string;
}
export interface MdHeadingChange {
    op: 'add' | 'remove' | 'rename';
    before?: string;
    after?: string;
    level: number;
    index: number;
}
export interface MdBlockChange {
    op: 'add' | 'remove' | 'replace';
    path: string;
    before?: string;
    after?: string;
}
export interface MdCodeBlockChange {
    language: string;
    beforeLines: number;
    afterLines: number;
    /** 内容是否变化（语言/行数相同但代码内容不同，D-04 修复） */
    changed?: boolean;
}
export interface MdReport {
    equal: boolean;
    headingChanges: MdHeadingChange[];
    blockChanges: MdBlockChange[];
    codeBlockChanges: MdCodeBlockChange[];
    diff: string;
}
export interface MdDiffOptions {
    context?: number;
    ignoreWhitespace?: boolean;
    ignoreCase?: boolean;
}
export declare function tokenizeMarkdown(text: string): MdBlock[];
export declare function markdownDiff(beforeText: string, afterText: string, options?: MdDiffOptions): MdReport;
