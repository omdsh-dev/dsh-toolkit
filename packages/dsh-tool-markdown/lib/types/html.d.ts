/**
 * 轻量递归下降 HTML 解析器 —— 零依赖，纯函数。
 *
 * 覆盖模型场景的 95%：标签/属性/文本/注释/实体/自闭合/大小写归一；
 * 畸形输入容错（未闭合标签 EOF 自动闭合、未知标签跳过、块级自动闭合）。
 *
 * 安全边界：
 * - script/style/iframe/object/noscript/template 内容整体剥离（不产出节点）；
 * - 注释 / DOCTYPE / CDATA 剥离；
 * - 嵌套深度超过 maxDepth 直接报错（防栈溢出，不静默）；
 * - 实体解码在解析期完成（命名 + 数字），未知实体按字面保留。
 */
export interface HtmlNode {
    type: 'element' | 'text';
    /** element 时的标签名（已小写归一）。 */
    tag?: string;
    /** 属性表（布尔属性值为 ''；值已实体解码）。 */
    attrs: Record<string, string>;
    children: HtmlNode[];
    /** text 节点时的文本（已实体解码）。 */
    text?: string;
}
/** 根节点 tag。 */
export declare const ROOT_TAG = "#root";
/** 解码文本中的全部实体引用；未知实体按字面保留。 */
export declare function decodeEntities(text: string): string;
export interface ParseOptions {
    maxDepth?: number;
}
/**
 * 解析 HTML 片段为树；畸形输入容错。根节点 tag 为 '#root'。
 * 深度超过 maxDepth（默认 64）抛 `markdown: HTML nesting exceeds ...` 错误。
 */
export declare function parseHtml(input: string, options?: ParseOptions): HtmlNode;
