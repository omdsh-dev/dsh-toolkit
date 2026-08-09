/**
 * unified patch 生成与内存校验。
 *
 * - generatePatch：复用 text-diff 的 unified 渲染，可自定义文件标签（默认 before/after）；
 * - validatePatch：解析 `---`/`+++`/`@@`/上下文行，在内存中把补丁应用到 before，
 *   与 after 逐行比对；绝不写文件、不调用 git（read-only）。
 */
import { type DiffOp } from './text-diff.ts';
export interface PatchValidationResult {
    valid: boolean;
    hunks: number;
    appliedLines: number;
    targetMatchesAfter: boolean;
    errors: string[];
}
/**
 * 生成 unified patch（D-03 契约：patch 是精确文本协议，不做 ignore 归一化——
 * 归一化比较请用 text action；ignore 选项会在工具入口被拒绝）。
 */
export declare function generatePatch(beforeLabel: string, afterLabel: string, beforeText: string, afterText: string, context: number): {
    patch: string;
    ops: DiffOp[];
};
interface ParsedHunk {
    oldStart: number;
    oldCount: number;
    newStart: number;
    newCount: number;
    /** 每个元素: { kind: 'ctx'|'del'|'add', text } */
    lines: Array<{
        kind: 'ctx' | 'del' | 'add';
        text: string;
    }>;
}
/**
 * 解析 unified diff 文本。
 * - strict（默认 true，D-14）：要求 `---`/`+++` 文件头；每个 body 行必须以
 *   ` `（ctx）/`-`（del）/`+`（add）/`\`（no-newline 标记）开头，否则报错；
 *   hunk 行数与 header 计数不一致报错。
 * - lenient：容忍缺失文件头与空行（内部生成 patch 自检场景）。
 * 忽略 `\ No newline at end of file` 标记行（行级校验不依赖字节末尾）。
 */
export declare function parsePatch(patchText: string, options?: {
    strict?: boolean;
}): {
    hunks: ParsedHunk[];
    errors: string[];
};
/**
 * 内存中应用补丁并校验：把 hunks 应用到 before 行数组，
 * 若所有上下文/删除行匹配且结果与 after 逐行一致 → 补丁有效。
 *
 * 两阶段（D-02/D-09 修复）：
 * 1) 结构验证：所有 hunk 的 oldStart/newStart 单调不重叠、old/new 坐标间隙一致
 *    （newStart 与累积 new 坐标对齐），任何不一致 → 整体拒绝，不进入应用阶段；
 * 2) 应用：上下文/删除行逐行匹配后应用，任一 hunk 失配 → 整体拒绝并停止。
 */
export declare function validatePatch(beforeText: string, patchText: string, afterText: string): PatchValidationResult;
export {};
