/**
 * 正则静态解释器 —— 轻量 tokenizer，把 pattern 拆成人读解释节点。
 *
 * 关键安全属性：**不构造 RegExp 实例、不执行匹配**——即使面对 (?=…)、嵌套量词等
 * 复杂结构也绝不会触发回溯，天然免疫 ReDoS。
 *
 * 识别规则（按顺序）：锚点 ^ $ → 字符类 [...]（含取反/范围）→ 分组 (…) (?:…) (?<name>…)
 * (?=…) (?!…) (?<=…) (?<!…) → 量词 * + ? {n} {n,} {n,m}（含 lazy 后缀）→ 转义类
 * \d \w \s \b 等 → 交替 | → 其余字面量。
 */
export interface ExplainNode {
    kind: 'literal' | 'class' | 'group' | 'quantifier' | 'anchor' | 'alternation' | 'escape';
    /** 原始切片（含定界符）。 */
    text: string;
    /** 人读含义（英文）。 */
    meaning: string;
}
/** 解析 pattern 为解释节点序列；结构性错误（未闭合括号/字符类）抛 regex: 错误。 */
export declare function explainPattern(pattern: unknown): ExplainNode[];
