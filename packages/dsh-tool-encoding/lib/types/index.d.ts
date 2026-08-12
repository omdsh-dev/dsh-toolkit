/**
 * DSH 编码/哈希工具插件。
 *
 * 注册 `encoding` 工具：UTF-8 文本的 base64/base64url/url/hex 编解码 + 哈希 + UUID。
 * 接入方式：在 cordis.yml 追加：
 *   - id: tool-encoding
 *     name: '@deepseek-ai/dsh-tool-encoding'
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "@deepseek-ai/dsh-tool-encoding";
export declare const inject: string[];
export declare function apply(ctx: Context): void;
