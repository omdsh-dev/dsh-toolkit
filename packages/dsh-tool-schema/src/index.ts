/**
 * DSH JSON Schema 验证工具插件。
 *
 * 注册 `schema` 工具：validate / paths / explain / normalize。
 * 接入方式：在 cordis.yml 追加：
 *   - id: tool-schema
 *     name: '@deepseek-ai/dsh-tool-schema'
 *
 * 设计文档要点：
 * - 统一 `{ type: 'json' }` canonical output；render 为 JSON.stringify；
 * - execute 非 async：同步构造并返回 Promise.resolve(结果 as JsonValue)；
 * - timeoutMs 3000（pattern worker 另有 1000ms 硬预算）；
 * - validate/paths/normalize 必须显式提供 `data`（null 是合法数据）；
 * - strictSchema 默认 true；maxErrors 默认 100、范围 1..1000；
 * - 输出上限 1 MiB：超限时截断 errors/schemaIssues 等数组并置 truncated。
 */

import type { Context } from 'cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-tools'
import { DEFAULT_MAX_ERRORS, MAX_ERRORS, MAX_OUTPUT_BYTES, TOOL_TIMEOUT_MS } from './limits.ts'
import { validateCore } from './validator.ts'
import { normalizeAction } from './normalize.ts'
import { explainSchema } from './explain.ts'

export const name = '@deepseek-ai/dsh-tool-schema'
export const inject = ['tools']

interface SchemaActionArgs {
  action: string
  data?: unknown
  schema: unknown
  strictSchema?: boolean
  maxErrors?: number
}

interface ActionOptions {
  strictSchema: boolean
  maxErrors: number
}

function clampMaxErrors(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return DEFAULT_MAX_ERRORS
  return Math.min(Math.max(value, 1), MAX_ERRORS)
}

function ensureData(args: SchemaActionArgs, action: string): void {
  if (!Object.hasOwn(args, 'data')) {
    throw new Error(`schema: action "${action}" requires "data" (null is valid data)`)
  }
}

/**
 * canonical 输出上限：JSON.stringify 后超过 MAX_OUTPUT_BYTES 时，渐进截断
 * 可裁剪数组（errors/schemaIssues/nodes/warnings/paths/appliedDefaults）并置
 * truncated。value 恒 ≤ data 上限（256 KiB），无需裁剪。
 */
export function capJsonOutput<T>(value: T): T {
  let text = JSON.stringify(value)
  if (Buffer.byteLength(text, 'utf8') <= MAX_OUTPUT_BYTES) return value
  const out = value as Record<string, unknown>
  const trimmable = ['errors', 'schemaIssues', 'nodes', 'warnings', 'paths', 'appliedDefaults']
  let trimmed = false
  while (Buffer.byteLength(text, 'utf8') > MAX_OUTPUT_BYTES) {
    // 每次把最大的可裁剪数组减半
    let bestKey: string | undefined
    let bestLen = 1
    for (const key of trimmable) {
      const arr = out[key]
      if (Array.isArray(arr) && arr.length > bestLen) {
        bestKey = key
        bestLen = arr.length
      }
    }
    if (bestKey === undefined) break
    const arr = out[bestKey] as unknown[]
    out[bestKey] = arr.slice(0, Math.ceil(arr.length / 2))
    trimmed = true
    text = JSON.stringify(value)
  }
  if (trimmed) out.truncated = true
  return value
}

async function dispatch(args: SchemaActionArgs): Promise<unknown> {
  const action = args.action
  const opts: ActionOptions = {
    strictSchema: args.strictSchema !== false,
    maxErrors: clampMaxErrors(args.maxErrors),
  }
  const schema = args.schema

  switch (action) {
    case 'validate': {
      ensureData(args, action)
      const core = await validateCore(args.data, schema, opts)
      return capJsonOutput({ action: 'validate', ...core })
    }
    case 'paths': {
      ensureData(args, action)
      const core = await validateCore(args.data, schema, opts)
      const byPath = new Map<string, Set<string>>()
      for (const e of core.errors) {
        let set = byPath.get(e.instancePath)
        if (!set) {
          set = new Set()
          byPath.set(e.instancePath, set)
        }
        set.add(e.keyword)
      }
      const paths = [...byPath.entries()]
        .map(([path, keywords]) => ({ path, keywords: [...keywords].sort() }))
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      return capJsonOutput({
        action: 'paths',
        valid: core.valid,
        paths,
        errorCount: core.errors.length,
        truncated: core.truncated,
      })
    }
    case 'normalize': {
      ensureData(args, action)
      return capJsonOutput(await normalizeAction(args.data, schema, opts))
    }
    case 'explain': {
      return capJsonOutput(explainSchema(schema, { strictSchema: opts.strictSchema }))
    }
    default:
      throw new Error(`schema: unknown action "${action}"`)
  }
}

export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'schema',
    description:
      'JSON Schema validation over explicit JSON data (draft 2020-12 subset, zero network, zero dynamic code). ' +
      'Actions: validate (verdict with RFC 6901 instancePath/schemaPath errors), paths (failure paths with keyword ' +
      'summaries), explain (static constraint-tree nodes), normalize (deep copy + apply explicit `default` for missing ' +
      'properties, then validate; never mutates input, never coerces types). Supported keywords: type/enum/const, object ' +
      '(required/properties/additionalProperties/minProperties/maxProperties), array (items/minItems/maxItems/' +
      'uniqueItems), string (minLength/maxLength/pattern), number (minimum/maximum/exclusive*/multipleOf), ' +
      'allOf/anyOf/oneOf/not, local $ref (# and #/$defs/...). Unsupported schema keywords are NEVER silently ignored: ' +
      'they are reported as schemaIssues (code unsupported-keyword); with strictSchema=true (default) validation fails, ' +
      'with strictSchema=false the supported subset is validated and valid=null with complete=false is returned. ' +
      'Pattern validation runs in an isolated worker with a shared 1000ms hard budget (ReDoS guard); data/schema size ' +
      '(256KiB each), nesting depth (64), schema nodes (10000), traversal nodes (100000), errors (100 default, max ' +
      '1000), $ref chain (64), and canonical output (1MiB) are all bounded.',
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['validate', 'paths', 'explain', 'normalize'],
        description: 'Operation to perform.',
      },
      data: {
        type: 'json',
        description: 'Instance to validate/normalize (required for validate/paths/normalize; null is valid data).',
      },
      schema: {
        type: 'json',
        required: true,
        description: 'JSON Schema (boolean or object; draft 2020-12 subset).',
      },
      strictSchema: {
        type: 'boolean',
        description: 'Fail when the schema uses unsupported keywords. Default true.',
      },
      maxErrors: {
        type: 'integer',
        description: 'Maximum errors to report. Default 100, range 1..1000.',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute: (args) => {
      // 非 async execute：同步构造 Promise.resolve(结果 as JsonValue)
      return Promise.resolve(dispatch(args as SchemaActionArgs) as unknown as JsonValue)
    },
    timeoutMs: TOOL_TIMEOUT_MS,
  }))
}
