/**
 * DSH 编码/哈希工具插件。
 *
 * 注册 `encoding` 工具：UTF-8 文本的 base64/base64url/url/hex 编解码 + 哈希 + UUID。
 * 接入方式：在 cordis.yml 追加：
 *   - id: tool-encoding
 *     name: '@deepseek-ai/dsh-tool-encoding'
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-tools'
import { executeAction } from './encoding.ts'

export const name = '@deepseek-ai/dsh-tool-encoding'
export const inject = ['tools']

export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'encoding',
    description:
      'Encoding and hashing utilities (UTF-8 text only). ' +
      'Actions: base64_encode, base64_decode, base64url_encode, base64url_decode, ' +
      'url_encode (encodes one URL component, not a complete query string), ' +
      'url_decode, hex_encode, hex_decode, hash (md5/sha1/sha256/sha512, ' +
      'non-security use only), uuid. Inputs and outputs are strings. ' +
      'Do not pass secrets or tokens (tool arguments are recorded in session logs).',
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: [
          'base64_encode', 'base64_decode', 'base64url_encode', 'base64url_decode',
          'url_encode', 'url_decode', 'hex_encode', 'hex_decode', 'hash', 'uuid',
        ],
        description: 'Operation to perform.',
      },
      input: {
        type: 'string',
        description: 'Input string for encode/decode/hash actions.',
      },
      algorithm: {
        type: 'string',
        enum: ['md5', 'sha1', 'sha256', 'sha512'],
        description: 'Hash algorithm (required for action=hash).',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute: (args) => {
      const { action, ...rest } = args
      return Promise.resolve(executeAction(action, rest) as JsonValue)
    },
    timeoutMs: 1000,
  }))
}
