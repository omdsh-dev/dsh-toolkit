/**
 * DSH JSON 查询工具插件。
 *
 * 注册 `json` 工具：JMESPath 核心子集查询。
 * 接入方式：在 cordis.yml 追加：
 *   - id: tool-json
 *     name: '@deepseek-ai/dsh-tool-json'
 */

import type { Context } from 'cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-tools'
import { query } from './query.ts'

export const name = '@deepseek-ai/dsh-tool-json'
export const inject = ['tools']

export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'json',
    description:
      'Query JSON with a JMESPath-inspired path expression. ' +
      'Supports dot-notation (foo.bar), bracket-indexing (items[0]), ' +
      "bracket-property (items['key'] or items[\"key\"]), and array " +
      'wildcard projection (items[*].name, arrays only; multi-level ' +
      'wildcards return nested arrays). Returns the matched value as JSON.',
    parameters: {
      input: {
        type: 'json',
        required: true,
        description: 'JSON value or JSON string to query.',
      },
      query: {
        type: 'string',
        required: true,
        description: 'Path expression, e.g. "data.items[0].name".',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute: (args) => {
      const { input, query: queryStr } = args
      // query() 内置 normalizeInput：字符串/对象双形态 + 友好错误包装
      return Promise.resolve(query(input, queryStr) as JsonValue)
    },
    timeoutMs: 1000,
  }))
}
