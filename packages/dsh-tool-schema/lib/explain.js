/**
 * explain action —— 静态解释 schema 的约束树（有限节点列表，非自然语言长文）。
 *
 * 设计文档 §7：返回有限约束节点列表，如
 *   { "schemaPath": "#", "summary": "object; requires: name" }
 * 节点数上限 MAX_EXPLAIN_NODES，超出截断并置 truncated。explain 只做静态遍历，
 * 不构造 RegExp、不匹配、不执行任何代码。
 *
 * schema 预检查（checkSchema）与 explain 复用：不支持的 schema 关键字同样在
 * schemaIssues 中报告（绝不静默忽略）；节点摘要仅覆盖已支持关键字。
 */
import { MAX_EXPLAIN_NODES, MAX_SCHEMA_BYTES, MAX_DEPTH, MAX_SCHEMA_NODES } from './limits.js';
import { checkJsonValue, escapeToken, isJsonRecord } from './json-guard.js';
import { checkSchema } from './schema-check.js';
function summarize(node) {
    const parts = [];
    if (Object.hasOwn(node, 'type')) {
        const t = node.type;
        if (Array.isArray(t))
            parts.push(t.join(' | '));
        else if (typeof t === 'string')
            parts.push(t);
    }
    if (Object.hasOwn(node, 'enum') && Array.isArray(node.enum)) {
        parts.push(`enum: ${node.enum.map((v) => JSON.stringify(v)).join(', ')}`);
    }
    if (Object.hasOwn(node, 'const')) {
        parts.push(`const: ${JSON.stringify(node.const)}`);
    }
    if (Object.hasOwn(node, 'required') && Array.isArray(node.required) && node.required.length > 0) {
        parts.push(`requires: ${node.required.join(', ')}`);
    }
    if (Object.hasOwn(node, 'minProperties') && typeof node.minProperties === 'number') {
        parts.push(`minProperties: ${node.minProperties}`);
    }
    if (Object.hasOwn(node, 'maxProperties') && typeof node.maxProperties === 'number') {
        parts.push(`maxProperties: ${node.maxProperties}`);
    }
    if (Object.hasOwn(node, 'minItems') && typeof node.minItems === 'number') {
        parts.push(`minItems: ${node.minItems}`);
    }
    if (Object.hasOwn(node, 'maxItems') && typeof node.maxItems === 'number') {
        parts.push(`maxItems: ${node.maxItems}`);
    }
    if (node.uniqueItems === true)
        parts.push('uniqueItems');
    if (Object.hasOwn(node, 'minLength') && typeof node.minLength === 'number') {
        parts.push(`minLength: ${node.minLength}`);
    }
    if (Object.hasOwn(node, 'maxLength') && typeof node.maxLength === 'number') {
        parts.push(`maxLength: ${node.maxLength}`);
    }
    if (Object.hasOwn(node, 'pattern') && typeof node.pattern === 'string') {
        parts.push(`pattern: ${node.pattern}`);
    }
    if (Object.hasOwn(node, 'minimum') && typeof node.minimum === 'number') {
        parts.push(`minimum: ${node.minimum}`);
    }
    if (Object.hasOwn(node, 'maximum') && typeof node.maximum === 'number') {
        parts.push(`maximum: ${node.maximum}`);
    }
    if (Object.hasOwn(node, 'exclusiveMinimum') && typeof node.exclusiveMinimum === 'number') {
        parts.push(`exclusiveMinimum: ${node.exclusiveMinimum}`);
    }
    if (Object.hasOwn(node, 'exclusiveMaximum') && typeof node.exclusiveMaximum === 'number') {
        parts.push(`exclusiveMaximum: ${node.exclusiveMaximum}`);
    }
    if (Object.hasOwn(node, 'multipleOf') && typeof node.multipleOf === 'number') {
        parts.push(`multipleOf: ${node.multipleOf}`);
    }
    if (Object.hasOwn(node, 'items')) {
        const items = node.items;
        if (typeof items === 'boolean')
            parts.push(`items: ${items ? 'any' : 'none'}`);
        else if (isJsonRecord(items)) {
            const childSummary = summarize(items);
            parts.push(`items: ${childSummary.length > 60 ? `${childSummary.slice(0, 57)}...` : childSummary}`);
        }
    }
    if (Object.hasOwn(node, 'additionalProperties')) {
        const ap = node.additionalProperties;
        if (typeof ap === 'boolean')
            parts.push(`additionalProperties: ${ap ? 'allowed' : 'forbidden'}`);
        else
            parts.push('additionalProperties: schema');
    }
    if (Object.hasOwn(node, 'allOf') && Array.isArray(node.allOf)) {
        parts.push(`allOf: ${node.allOf.length} branches`);
    }
    if (Object.hasOwn(node, 'anyOf') && Array.isArray(node.anyOf)) {
        parts.push(`anyOf: ${node.anyOf.length} branches`);
    }
    if (Object.hasOwn(node, 'oneOf') && Array.isArray(node.oneOf)) {
        parts.push(`oneOf: ${node.oneOf.length} branches`);
    }
    if (Object.hasOwn(node, 'not')) {
        const not = node.not;
        if (typeof not === 'boolean')
            parts.push(`not: ${not ? 'true' : 'false'}`);
        else if (isJsonRecord(not)) {
            const childSummary = summarize(not);
            parts.push(`not: ${childSummary.length > 60 ? `${childSummary.slice(0, 57)}...` : childSummary}`);
        }
    }
    if (Object.hasOwn(node, '$ref') && typeof node.$ref === 'string') {
        parts.push(`ref: ${node.$ref}`);
    }
    return parts.length > 0 ? parts.join('; ') : 'any value';
}
function walkExplain(schema, sp, nodes, state) {
    if (state.truncated)
        return;
    if (nodes.length >= MAX_EXPLAIN_NODES) {
        state.truncated = true;
        return;
    }
    if (typeof schema === 'boolean') {
        nodes.push({ schemaPath: sp, summary: schema ? 'true (accepts everything)' : 'false (rejects everything)' });
        return;
    }
    if (!isJsonRecord(schema))
        return;
    nodes.push({ schemaPath: sp, summary: summarize(schema) });
    if (Object.hasOwn(schema, 'properties') && isJsonRecord(schema.properties)) {
        const props = schema.properties;
        for (const key of Object.keys(props)) {
            walkExplain(props[key], `${sp}/properties/${escapeToken(key)}`, nodes, state);
        }
    }
    if (Object.hasOwn(schema, 'additionalProperties')) {
        const ap = schema.additionalProperties;
        if (typeof ap === 'object' && ap !== null) {
            walkExplain(ap, `${sp}/additionalProperties`, nodes, state);
        }
    }
    if (Object.hasOwn(schema, 'items') && (typeof schema.items === 'boolean' || isJsonRecord(schema.items))) {
        walkExplain(schema.items, `${sp}/items`, nodes, state);
    }
    for (const comb of ['allOf', 'anyOf', 'oneOf']) {
        if (Array.isArray(schema[comb])) {
            ;
            schema[comb].forEach((branch, i) => {
                walkExplain(branch, `${sp}/${comb}/${i}`, nodes, state);
            });
        }
    }
    if (Object.hasOwn(schema, 'not') && (typeof schema.not === 'boolean' || isJsonRecord(schema.not))) {
        walkExplain(schema.not, `${sp}/not`, nodes, state);
    }
    if (Object.hasOwn(schema, '$defs') && isJsonRecord(schema.$defs)) {
        const defs = schema.$defs;
        for (const key of Object.keys(defs)) {
            walkExplain(defs[key], `${sp}/$defs/${escapeToken(key)}`, nodes, state);
        }
    }
}
/** explain action。 */
export function explainSchema(schema, _opts) {
    let schemaIssues = [];
    const schemaGuard = checkJsonValue(schema, {
        maxBytes: MAX_SCHEMA_BYTES,
        maxDepth: MAX_DEPTH,
        maxNodes: MAX_SCHEMA_NODES,
        label: 'schema',
    });
    if (!schemaGuard.ok) {
        schemaIssues = [
            { schemaPath: schemaGuard.failure.path, keyword: 'schema', code: schemaGuard.failure.code, message: schemaGuard.failure.message },
        ];
    }
    else {
        schemaIssues = checkSchema(schema).issues;
    }
    const nodes = [];
    const state = { truncated: false };
    if (schemaGuard.ok) {
        walkExplain(schema, '#', nodes, state);
    }
    return { action: 'explain', nodes, schemaIssues, truncated: state.truncated };
}
