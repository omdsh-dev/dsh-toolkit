/**
 * DSH Diff 文本差异工具插件。
 *
 * 注册 `diff` 工具：对两段文本做行级 / 结构化差异对比。
 * 接入方式：在 cordis.yml 追加：
 *   - id: tool-diff
 *     name: '@deepseek-ai/dsh-tool-diff'
 *
 * 安全边界：零依赖、纯函数（不读文件/不联网/不写文件/不调 git）；
 * 输入单侧 256KB 上限、输出 64KB 上限（超限按 maxChanges 与字节预算截断并注明）；
 * Myers diagonal 预算 2000、行数 50K 上限；timeoutMs 2000 兜底。
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "@deepseek-ai/dsh-tool-diff";
export declare const inject: string[];
export declare function apply(ctx: Context): void;
