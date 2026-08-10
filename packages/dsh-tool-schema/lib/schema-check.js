/**
 * schema 预检查 —— 关键字类型校验、不支持关键字报告、pattern 预算、本地 `$ref`
 * 静态校验（解析、存在性、纯 `$ref` 链深/环）。
 *
 * 设计文档 §3.2 / §5.5 / §5.6：
 * - 遇到不支持的关键字绝不静默忽略：默认返回 schema issue（`unsupported-keyword`）；
 *   strictSchema=false 时为 warning 并继续处理已支持部分（结果必须 complete:false、
 *   valid:null + supportedSubsetValid）；strictSchema=true 时 schema 检查直接失败。
 * - pattern：最大 16 KiB、每个 schema 最多 100 个、必须能编译（非法 → pattern-invalid）。
 * - 本地 `$ref`：仅 `#` 与 `#/$defs/...`；目标必须存在；链最大 64；纯 `$ref` 环 → ref-cycle。
 *
 * 调用前提：json-guard 已通过（schema 无 cycle、无超限、无非 JSON 值），因此本模块
 * 的递归遍历是安全的（图无环）。返回节点路径表 nodePaths（WeakMap<object, string>，
 * 首次遇到节点时记录），供 validator 在 `$ref` 目标上报告错误时使用。
 */
import { MAX_PATTERN_BYTES, MAX_PATTERNS, MAX_REF_CHAIN } from "./limits.js";
import { escapeToken } from "./json-guard.js";
import { parseRef, resolveRef } from "./ref.js";
/** v1 支持的约束关键字（设计文档 §3.1）。 */
const CONSTRAINT_KEYWORDS = new Set([
    'type',
    'enum',
    'const',
    'required',
    'properties',
    'additionalProperties',
    'minProperties',
    'maxProperties',
    'items',
    'minItems',
    'maxItems',
    'uniqueItems',
    'minLength',
    'maxLength',
    'pattern',
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'multipleOf',
    'allOf',
    'anyOf',
    'oneOf',
    'not',
    '$ref',
    '$defs',
]);
/**
 * 标准 annotation 关键字（受支持但不参与验证）。`format` 的语义验证在 v1 明确
 * 不支持（设计文档 §3.2），关键字本身按 annotation 容忍；这一解读在 README/报告中
 * 记录为明确的边界决定。
 */
const ANNOTATION_KEYWORDS = new Set([
    'title',
    'description',
    'default',
    'examples',
    '$schema',
    '$id',
    '$comment',
    '$anchor',
    'deprecated',
    'readOnly',
    'writeOnly',
    'contentEncoding',
    'contentMediaType',
    'contentSchema',
    'format',
]);
const JSON_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
function issue(ctx, schemaPath, keyword, code, message) {
    ctx.issues.push({ schemaPath, keyword, code, message });
}
/** 记录节点路径（首个遇到者胜）。 */
function notePath(ctx, node, schemaPath) {
    if (!ctx.nodePaths.has(node))
        ctx.nodePaths.set(node, schemaPath);
}
/** 关键字类型校验 + 子 schema 递归。返回 false 表示已跳过递归（结构非法）。 */
function checkKeyword(ctx, node, key, sp) {
    const value = node[key];
    const kwPath = `${sp}/${escapeToken(key)}`;
    switch (key) {
        case 'type': {
            if (typeof value === 'string') {
                if (!JSON_TYPES.has(value)) {
                    issue(ctx, kwPath, key, 'schema-invalid', `invalid type "${value}"; expected one of ${[...JSON_TYPES].join(', ')}`);
                }
            }
            else if (Array.isArray(value)) {
                if (value.length === 0) {
                    issue(ctx, kwPath, key, 'schema-invalid', 'type array must not be empty');
                }
                for (const t of value) {
                    if (typeof t !== 'string' || !JSON_TYPES.has(t)) {
                        issue(ctx, kwPath, key, 'schema-invalid', `invalid type entry ${JSON.stringify(t)}; expected one of ${[...JSON_TYPES].join(', ')}`);
                    }
                }
            }
            else {
                issue(ctx, kwPath, key, 'schema-invalid', 'type must be a string or an array of strings');
            }
            break;
        }
        case 'enum': {
            if (!Array.isArray(value)) {
                issue(ctx, kwPath, key, 'schema-invalid', 'enum must be an array');
            }
            else if (value.length === 0) {
                issue(ctx, kwPath, key, 'schema-invalid', 'enum must not be empty');
            }
            break;
        }
        case 'required': {
            if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
                issue(ctx, kwPath, key, 'schema-invalid', 'required must be an array of strings');
            }
            break;
        }
        case 'properties': {
            if (!isRecord(value)) {
                issue(ctx, kwPath, key, 'schema-invalid', 'properties must be an object');
            }
            else {
                for (const name of Object.keys(value)) {
                    walk(ctx, value[name], `${kwPath}/${escapeToken(name)}`);
                }
            }
            break;
        }
        case 'additionalProperties': {
            if (typeof value === 'boolean')
                break;
            if (isSchemaValue(value)) {
                walk(ctx, value, `${kwPath}/additionalProperties`);
            }
            else {
                issue(ctx, kwPath, key, 'schema-invalid', 'additionalProperties must be a boolean or a schema');
            }
            break;
        }
        case 'items': {
            if (Array.isArray(value)) {
                issue(ctx, kwPath, key, 'schema-invalid', 'items must be a single schema; array (tuple) form is not supported');
            }
            else if (isSchemaValue(value)) {
                walk(ctx, value, `${kwPath}/items`);
            }
            else {
                issue(ctx, kwPath, key, 'schema-invalid', 'items must be a boolean or a schema');
            }
            break;
        }
        case 'minProperties':
        case 'maxProperties':
        case 'minItems':
        case 'maxItems':
        case 'minLength':
        case 'maxLength': {
            if (!Number.isInteger(value) || value < 0) {
                issue(ctx, kwPath, key, 'schema-invalid', `${key} must be a non-negative integer`);
            }
            break;
        }
        case 'uniqueItems': {
            if (typeof value !== 'boolean') {
                issue(ctx, kwPath, key, 'schema-invalid', 'uniqueItems must be a boolean');
            }
            break;
        }
        case 'pattern': {
            if (typeof value !== 'string') {
                issue(ctx, kwPath, key, 'schema-invalid', 'pattern must be a string');
                break;
            }
            if (Buffer.byteLength(value, 'utf8') > MAX_PATTERN_BYTES) {
                issue(ctx, kwPath, key, 'pattern-too-long', `pattern exceeds ${MAX_PATTERN_BYTES} bytes`);
                break;
            }
            if (ctx.patternCount >= MAX_PATTERNS) {
                issue(ctx, kwPath, key, 'pattern-limit', `schema has more than ${MAX_PATTERNS} patterns`);
                break;
            }
            ctx.patternCount++;
            try {
                // 编译校验（不含 flags）；真正匹配在 worker 内执行
                // eslint-disable-next-line no-new
                new RegExp(value);
                ctx.validPatterns.add(value);
            }
            catch (error) {
                issue(ctx, kwPath, key, 'pattern-invalid', `invalid regular expression: ${String(error.message)}`);
            }
            break;
        }
        case 'minimum':
        case 'maximum':
        case 'exclusiveMinimum':
        case 'exclusiveMaximum': {
            if (typeof value === 'boolean') {
                issue(ctx, kwPath, key, 'schema-invalid', `${key} must be a number (draft 2020-12 semantics); boolean form is not supported`);
            }
            else if (typeof value !== 'number' || !Number.isFinite(value)) {
                issue(ctx, kwPath, key, 'schema-invalid', `${key} must be a finite number`);
            }
            break;
        }
        case 'multipleOf': {
            if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
                issue(ctx, kwPath, key, 'schema-invalid', 'multipleOf must be a finite number greater than 0');
            }
            break;
        }
        case 'allOf': {
            if (!Array.isArray(value)) {
                issue(ctx, kwPath, key, 'schema-invalid', 'allOf must be an array of schemas');
            }
            else {
                value.forEach((sub, i) => walk(ctx, sub, `${kwPath}/${i}`));
            }
            break;
        }
        case 'anyOf':
        case 'oneOf': {
            if (!Array.isArray(value) || value.length === 0) {
                issue(ctx, kwPath, key, 'schema-invalid', `${key} must be a non-empty array of schemas`);
            }
            else {
                value.forEach((sub, i) => walk(ctx, sub, `${kwPath}/${i}`));
            }
            break;
        }
        case 'not': {
            if (!isSchemaValue(value)) {
                issue(ctx, kwPath, key, 'schema-invalid', 'not must be a boolean or a schema');
            }
            else {
                walk(ctx, value, `${kwPath}/not`);
            }
            break;
        }
        case '$ref': {
            if (typeof value !== 'string') {
                issue(ctx, kwPath, key, 'schema-invalid', '$ref must be a string');
                break;
            }
            checkRefStatic(ctx, value, kwPath);
            break;
        }
        case '$defs': {
            if (!isRecord(value)) {
                issue(ctx, kwPath, key, 'schema-invalid', '$defs must be an object of schemas');
            }
            else {
                for (const name of Object.keys(value)) {
                    walk(ctx, value[name], `${kwPath}/${escapeToken(name)}`);
                }
            }
            break;
        }
        default: {
            // annotation：不参与验证。default/examples 的 JSON-compatible 由 json-guard
            // 在 schema 整体检查时兜底（guard 失败 → schema-invalid）。
            break;
        }
    }
}
/**
 * `$ref` 静态校验：解析形式、目标存在、纯 `$ref` 链深 ≤ 64、纯 `$ref` 环。
 * 所有本地引用均锚定在 schema 根；纯链判定：目标对象仅有 `$ref` 一个 own 键。
 * 带 sibling 关键字的递归结构由 validator 的动态 (schemaNode, instance) 栈检测兜底。
 */
function checkRefStatic(ctx, ref, kwPath) {
    const parsed = parseRef(ref);
    if (!parsed.ok) {
        issue(ctx, kwPath, '$ref', parsed.code, parsed.message);
        return;
    }
    const resolved = resolveRef(ctx.root, ref);
    if (!resolved.ok) {
        issue(ctx, kwPath, '$ref', resolved.code, resolved.message);
        return;
    }
    let target = resolved.value;
    const chain = [target];
    while (typeof target === 'object' && target !== null && !Array.isArray(target)) {
        const keys = Object.keys(target);
        if (!(keys.length === 1 && keys[0] === '$ref'))
            break;
        const nextRef = target.$ref;
        if (typeof nextRef !== 'string')
            break;
        const next = resolveRef(ctx.root, nextRef);
        if (!next.ok)
            break;
        if (chain.includes(next.value)) {
            issue(ctx, kwPath, '$ref', 'ref-cycle', `circular $ref chain detected at "${ref}"`);
            return;
        }
        if (chain.length >= MAX_REF_CHAIN) {
            issue(ctx, kwPath, '$ref', 'ref-depth', `$ref chain exceeds ${MAX_REF_CHAIN}`);
            return;
        }
        chain.push(next.value);
        target = next.value;
    }
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** schema 值：boolean 或普通对象。 */
function isSchemaValue(value) {
    return typeof value === 'boolean' || (typeof value === 'object' && value !== null && !Array.isArray(value));
}
function walk(ctx, node, sp) {
    if (typeof node === 'boolean')
        return;
    if (!isRecord(node)) {
        issue(ctx, sp, 'schema', 'schema-invalid', `expected a boolean or an object schema, received ${describe(node)}`);
        return;
    }
    notePath(ctx, node, sp);
    for (const key of Object.keys(node)) {
        if (CONSTRAINT_KEYWORDS.has(key) || ANNOTATION_KEYWORDS.has(key)) {
            checkKeyword(ctx, node, key, sp);
        }
        else {
            issue(ctx, `${sp}/${escapeToken(key)}`, key, 'unsupported-keyword', `unsupported schema keyword "${key}"`);
        }
    }
}
function describe(value) {
    if (value === null)
        return 'null';
    if (Array.isArray(value))
        return 'an array';
    return typeof value;
}
/**
 * 对 schema 根执行预检查。调用方需先对 schema 运行 json-guard（无 cycle/超限）。
 */
export function checkSchema(schema) {
    const ctx = {
        issues: [],
        nodePaths: new WeakMap(),
        validPatterns: new Set(),
        patternCount: 0,
        root: schema,
    };
    if (typeof schema === 'object' && schema !== null && !Array.isArray(schema)) {
        notePath(ctx, schema, '#');
    }
    walk(ctx, schema, '#');
    return { issues: ctx.issues, nodePaths: ctx.nodePaths, validPatterns: ctx.validPatterns };
}
