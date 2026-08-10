/**
 * 验证内核 —— 递归/迭代的 JSON Schema 验证 + action 共用的 preflight。
 *
 * 设计文档 §5：
 * - 错误同时提供 instancePath / schemaPath（RFC 6901 JSON Pointer）；
 * - 所有对象访问使用 Object.hasOwn，`__proto__`/`constructor`/`prototype`
 *   不会产生原型链误判；
 * - 错误排序稳定：instancePath 字典序 → schemaPath 字典序 → keyword 字典序；
 * - 数字语义：JSON number 必须有限；integer 用 Number.isInteger；multipleOf
 *   使用缩放/容差策略（见 isMultipleOf）；
 * - 字符串长度按 Unicode code point 计（不按 UTF-16 code unit）；
 * - pattern 在 worker 内共享总预算执行（见 pattern-worker.ts）；
 * - 本地 `$ref` 动态检测：引用链最大 64，纯 `$ref` 环通过
 *   (schemaNodeIdentity, instanceIdentity) 栈检测报 ref-cycle。
 *
 * 组合关键字（allOf/anyOf/oneOf/not）见 combinators.ts；anyOf/oneOf/not 的
 * 判定依赖 pattern 结果，因此以 deferred finalizer 形式在 pattern 阶段之后结算。
 */
import { MAX_BRANCH_ERRORS, MAX_DATA_BYTES, MAX_DEPTH, MAX_ERRORS, MAX_INSTANCE_NODES, MAX_PATTERNS, MAX_REF_CHAIN, MAX_SCHEMA_BYTES, MAX_SCHEMA_NODES, MULTIPLE_OF_TOLERANCE, PATTERN_BUDGET_MS, } from "./limits.js";
import { checkJsonValue, escapeToken, isJsonRecord } from "./json-guard.js";
import { checkSchema } from "./schema-check.js";
import { resolveRef } from "./ref.js";
import { runPatternChecksInWorker } from "./pattern-worker.js";
import { checkAllOf, checkAnyOf, checkNot, checkOneOf } from "./combinators.js";
/** 把错误推入缓冲；缓冲已满则置 truncated 并返回 false。 */
export function pushError(buf, err) {
    if (buf.errors.length >= buf.cap) {
        buf.truncated = true;
        return false;
    }
    buf.errors.push(err);
    return true;
}
/** 稳定错误排序：instancePath → schemaPath → keyword（字典序）。 */
export function compareErrors(a, b) {
    if (a.instancePath !== b.instancePath)
        return a.instancePath < b.instancePath ? -1 : 1;
    if (a.schemaPath !== b.schemaPath)
        return a.schemaPath < b.schemaPath ? -1 : 1;
    if (a.keyword !== b.keyword)
        return a.keyword < b.keyword ? -1 : 1;
    return 0;
}
function sortErrors(errors) {
    return [...errors].sort(compareErrors);
}
/** JSON 类型名（用于 type 错误与 `type` 关键字判定）。 */
function jsonTypeOf(value) {
    if (value === null)
        return 'null';
    if (Array.isArray(value))
        return 'array';
    if (typeof value === 'object')
        return 'object';
    if (typeof value === 'string')
        return 'string';
    if (typeof value === 'boolean')
        return 'boolean';
    if (typeof value === 'number')
        return 'number';
    return 'unknown';
}
function matchesType(t, instance) {
    switch (t) {
        case 'object':
            return typeof instance === 'object' && instance !== null && !Array.isArray(instance);
        case 'array':
            return Array.isArray(instance);
        case 'string':
            return typeof instance === 'string';
        case 'number':
            return typeof instance === 'number';
        case 'integer':
            return typeof instance === 'number' && Number.isInteger(instance);
        case 'boolean':
            return typeof instance === 'boolean';
        case 'null':
            return instance === null;
        default:
            return false;
    }
}
/** Unicode code point 长度（`[...]` 按 code point 迭代，非 UTF-16 code unit）。 */
function codePointLength(value) {
    return [...value].length;
}
/** 结构相等（JSON Schema enum/const/uniqueItems 语义；对象键集合 + 值递归）。 */
export function deepEqual(a, b) {
    if (a === b)
        return true;
    if (typeof a !== typeof b)
        return false;
    if (a === null || b === null)
        return false;
    if (typeof a === 'number')
        return false; // a !== b 且同类型数字 → 不等（-0/0 已在 === 处理）
    if (Array.isArray(a) !== Array.isArray(b))
        return false;
    if (Array.isArray(a)) {
        const arrA = a;
        const arrB = b;
        if (arrA.length !== arrB.length)
            return false;
        for (let i = 0; i < arrA.length; i++) {
            if (!deepEqual(arrA[i], arrB[i]))
                return false;
        }
        return true;
    }
    if (typeof a === 'object') {
        const keysA = Object.keys(a);
        const keysB = Object.keys(b);
        if (keysA.length !== keysB.length)
            return false;
        for (const key of keysA) {
            if (!Object.hasOwn(b, key))
                return false;
            if (!deepEqual(a[key], b[key]))
                return false;
        }
        return true;
    }
    return false;
}
/**
 * multipleOf：不使用 `% === 0`（浮点误差）。使用缩放/容差策略：
 * q = value / divisor，n = round(q)，当 |q - n| 相对容差内视为倍数。
 *
 * 实现限制（设计文档 §5.4 要求记录）：不承诺任意精度 JSON number；极端浮点数
 * （如 1e308 与极小 divisor 导致 q 溢出为 Infinity）返回一致的可测试结果
 * （非倍数，因为 diff 为 NaN）。
 */
export function isMultipleOf(value, divisor) {
    if (divisor === 0 || !Number.isFinite(divisor))
        return false;
    const quotient = value / divisor;
    const nearest = Math.round(quotient);
    const diff = Math.abs(quotient - nearest);
    return diff <= MULTIPLE_OF_TOLERANCE * Math.max(1, Math.abs(quotient));
}
/** (schemaNode, instance) 同对重入检测：对象按身份，基本类型按值。 */
function sameInstancePair(a, b) {
    if (a === b)
        return true;
    if (typeof a === 'number' && typeof b === 'number')
        return a === b;
    if (typeof a === 'string' && typeof b === 'string')
        return a === b;
    if (typeof a === 'boolean' && typeof b === 'boolean')
        return a === b;
    return false;
}
function isRefCycle(ctx, target, instance) {
    return ctx.state.refStack.some((p) => p.schema === target && sameInstancePair(p.instance, instance));
}
function typeExpectedText(schemaType) {
    if (Array.isArray(schemaType))
        return schemaType.join('|');
    return String(schemaType);
}
/** `type` 关键字检查。 */
function checkType(ctx, schemaType, instance, ip, sp) {
    const actual = jsonTypeOf(instance);
    let matched;
    if (Array.isArray(schemaType)) {
        matched = schemaType.some((t) => matchesType(t, instance));
    }
    else {
        matched = typeof schemaType === 'string' && matchesType(schemaType, instance);
    }
    if (!matched) {
        pushError(ctx.buf, {
            instancePath: ip,
            schemaPath: `${sp}/type`,
            keyword: 'type',
            code: 'type-mismatch',
            message: `expected ${typeExpectedText(schemaType)}, received ${actual}`,
            expected: Array.isArray(schemaType) ? schemaType : String(schemaType),
            actual,
        });
    }
}
function checkEnum(ctx, enumValues, instance, ip, sp) {
    if (!enumValues.some((v) => deepEqual(v, instance))) {
        pushError(ctx.buf, {
            instancePath: ip,
            schemaPath: `${sp}/enum`,
            keyword: 'enum',
            code: 'enum-mismatch',
            message: 'value is not one of the allowed enum values',
        });
    }
}
function checkConst(ctx, constValue, instance, ip, sp) {
    if (!deepEqual(constValue, instance)) {
        pushError(ctx.buf, {
            instancePath: ip,
            schemaPath: `${sp}/const`,
            keyword: 'const',
            code: 'const-mismatch',
            message: 'value does not equal const',
        });
    }
}
/** 组合分支评估：独立错误缓冲（≤ MAX_BRANCH_ERRORS），共享 state。 */
export function evalBranch(ctx, schema, instance, ip, sp) {
    const buf = { errors: [], cap: MAX_BRANCH_ERRORS, truncated: false };
    const subCtx = { ...ctx, buf };
    ctx.validateNode(subCtx, schema, instance, ip, sp);
    return buf;
}
function queuePatternCheck(ctx, pattern, value, ip, sp) {
    if (ctx.state.patternCount >= MAX_PATTERNS) {
        ctx.state.patternCount++;
        return;
    }
    if (!ctx.validPatterns.has(pattern)) {
        ctx.state.patternCount++;
        return;
    }
    ctx.state.patternCount++;
    ctx.state.patternChecks.push({
        id: ctx.state.nextPatternId++,
        pattern,
        value,
        instancePath: ip,
        schemaPath: `${sp}/pattern`,
        owner: ctx.buf,
    });
}
/**
 * 核心递归验证。schema 为 boolean 或对象；未知关键字忽略（schema-check 已
 * 报告 unsupported-keyword；strictSchema=false 的 subset 模式继续处理已支持部分）。
 */
export function validateNode(ctx, schema, instance, ip, sp) {
    if (ctx.state.stopped)
        return;
    ctx.state.checkedNodes++;
    if (ctx.state.checkedNodes > MAX_INSTANCE_NODES) {
        ctx.state.stopped = true;
        pushError(ctx.buf, {
            instancePath: '',
            schemaPath: '#',
            keyword: 'limit',
            code: 'data-nodes',
            message: `instance traversal exceeds ${MAX_INSTANCE_NODES} nodes`,
        });
        ctx.buf.truncated = true;
        return;
    }
    if (ctx.buf.errors.length >= ctx.buf.cap) {
        ctx.buf.truncated = true;
        // 分支缓冲满只截断该分支（有限摘要）；主缓冲满才停止整个遍历
        if (ctx.buf === ctx.state.main)
            ctx.state.stopped = true;
        return;
    }
    if (schema === true)
        return;
    if (schema === false) {
        pushError(ctx.buf, {
            instancePath: ip,
            schemaPath: sp,
            keyword: 'false',
            code: 'boolean-false',
            message: 'false schema rejects all values',
        });
        return;
    }
    if (!isJsonRecord(schema))
        return; // 防御：非 schema 值（schema-check 已报告）
    const node = schema;
    // ── $ref（draft 2020-12：first-class 关键字，siblings 一并生效）──
    if (Object.hasOwn(node, '$ref')) {
        const ref = node.$ref;
        if (typeof ref === 'string') {
            const resolved = resolveRef(ctx.root, ref);
            if (!resolved.ok) {
                pushError(ctx.buf, {
                    instancePath: ip,
                    schemaPath: `${sp}/$ref`,
                    keyword: '$ref',
                    code: resolved.code,
                    message: resolved.message,
                });
            }
            else {
                const target = resolved.value;
                const isObjectTarget = typeof target === 'object' && target !== null && !Array.isArray(target);
                if (ctx.state.refStack.length >= MAX_REF_CHAIN) {
                    pushError(ctx.buf, {
                        instancePath: ip,
                        schemaPath: `${sp}/$ref`,
                        keyword: '$ref',
                        code: 'ref-depth',
                        message: `$ref chain exceeds ${MAX_REF_CHAIN}`,
                    });
                }
                else if (isObjectTarget && isRefCycle(ctx, target, instance)) {
                    pushError(ctx.buf, {
                        instancePath: ip,
                        schemaPath: `${sp}/$ref`,
                        keyword: '$ref',
                        code: 'ref-cycle',
                        message: `circular $ref detected at "${ref}" without instance progress`,
                    });
                }
                else {
                    if (isObjectTarget)
                        ctx.state.refStack.push({ schema: target, instance });
                    const targetPath = ctx.nodePaths.get(target) ?? sp;
                    ctx.validateNode(ctx, target, instance, ip, targetPath);
                    if (isObjectTarget)
                        ctx.state.refStack.pop();
                }
            }
        }
        // 继续处理 sibling 关键字
    }
    // ── type ──
    if (Object.hasOwn(node, 'type')) {
        checkType(ctx, node.type, instance, ip, sp);
    }
    // ── enum / const ──
    if (Object.hasOwn(node, 'enum') && Array.isArray(node.enum)) {
        checkEnum(ctx, node.enum, instance, ip, sp);
    }
    if (Object.hasOwn(node, 'const')) {
        checkConst(ctx, node.const, instance, ip, sp);
    }
    // ── 对象关键字（仅当 instance 为对象）──
    if (typeof instance === 'object' && instance !== null && !Array.isArray(instance)) {
        const record = instance;
        if (Object.hasOwn(node, 'required') && Array.isArray(node.required)) {
            for (const name of node.required) {
                if (typeof name === 'string' && !Object.hasOwn(record, name)) {
                    pushError(ctx.buf, {
                        instancePath: ip,
                        schemaPath: `${sp}/required`,
                        keyword: 'required',
                        code: 'required-missing',
                        message: `missing required property "${name}"`,
                    });
                }
            }
        }
        if (Object.hasOwn(node, 'properties') && isJsonRecord(node.properties)) {
            const props = node.properties;
            for (const key of Object.keys(props)) {
                if (Object.hasOwn(record, key)) {
                    ctx.validateNode(ctx, props[key], record[key], `${ip}/${escapeToken(key)}`, `${sp}/properties/${escapeToken(key)}`);
                }
            }
        }
        if (Object.hasOwn(node, 'additionalProperties')) {
            const declared = Object.hasOwn(node, 'properties') && isJsonRecord(node.properties)
                ? new Set(Object.keys(node.properties))
                : new Set();
            const extra = Object.keys(record).filter((k) => !declared.has(k));
            const ap = node.additionalProperties;
            if (ap === false) {
                for (const key of extra) {
                    pushError(ctx.buf, {
                        instancePath: `${ip}/${escapeToken(key)}`,
                        schemaPath: `${sp}/additionalProperties`,
                        keyword: 'additionalProperties',
                        code: 'additional-properties',
                        message: `additional property "${key}" is not allowed`,
                    });
                }
            }
            else if (typeof ap === 'object' && ap !== null) {
                for (const key of extra) {
                    ctx.validateNode(ctx, ap, record[key], `${ip}/${escapeToken(key)}`, `${sp}/additionalProperties`);
                }
            }
        }
        if (Object.hasOwn(node, 'minProperties')) {
            const count = Object.keys(record).length;
            if (typeof node.minProperties === 'number' && count < node.minProperties) {
                pushError(ctx.buf, {
                    instancePath: ip,
                    schemaPath: `${sp}/minProperties`,
                    keyword: 'minProperties',
                    code: 'min-properties',
                    message: `object has fewer than ${node.minProperties} properties`,
                    expected: String(node.minProperties),
                    actual: String(count),
                });
            }
        }
        if (Object.hasOwn(node, 'maxProperties')) {
            const count = Object.keys(record).length;
            if (typeof node.maxProperties === 'number' && count > node.maxProperties) {
                pushError(ctx.buf, {
                    instancePath: ip,
                    schemaPath: `${sp}/maxProperties`,
                    keyword: 'maxProperties',
                    code: 'max-properties',
                    message: `object has more than ${node.maxProperties} properties`,
                    expected: String(node.maxProperties),
                    actual: String(count),
                });
            }
        }
    }
    // ── 数组关键字（仅当 instance 为数组）──
    if (Array.isArray(instance)) {
        if (Object.hasOwn(node, 'items')) {
            const items = node.items;
            if (typeof items === 'boolean' || (typeof items === 'object' && items !== null)) {
                for (let i = 0; i < instance.length; i++) {
                    ctx.validateNode(ctx, items, instance[i], `${ip}/${i}`, `${sp}/items`);
                }
            }
        }
        if (Object.hasOwn(node, 'minItems')) {
            if (typeof node.minItems === 'number' && instance.length < node.minItems) {
                pushError(ctx.buf, {
                    instancePath: ip,
                    schemaPath: `${sp}/minItems`,
                    keyword: 'minItems',
                    code: 'min-items',
                    message: `array has fewer than ${node.minItems} items`,
                    expected: String(node.minItems),
                    actual: String(instance.length),
                });
            }
        }
        if (Object.hasOwn(node, 'maxItems')) {
            if (typeof node.maxItems === 'number' && instance.length > node.maxItems) {
                pushError(ctx.buf, {
                    instancePath: ip,
                    schemaPath: `${sp}/maxItems`,
                    keyword: 'maxItems',
                    code: 'max-items',
                    message: `array has more than ${node.maxItems} items`,
                    expected: String(node.maxItems),
                    actual: String(instance.length),
                });
            }
        }
        if (node.uniqueItems === true) {
            for (let i = 1; i < instance.length; i++) {
                for (let j = 0; j < i; j++) {
                    if (deepEqual(instance[i], instance[j])) {
                        pushError(ctx.buf, {
                            instancePath: `${ip}/${i}`,
                            schemaPath: `${sp}/uniqueItems`,
                            keyword: 'uniqueItems',
                            code: 'unique-items',
                            message: `array items must be unique (item at index ${i} duplicates index ${j})`,
                        });
                        break;
                    }
                }
            }
        }
    }
    // ── 字符串关键字（仅当 instance 为字符串）──
    if (typeof instance === 'string') {
        if (Object.hasOwn(node, 'minLength')) {
            const len = codePointLength(instance);
            if (typeof node.minLength === 'number' && len < node.minLength) {
                pushError(ctx.buf, {
                    instancePath: ip,
                    schemaPath: `${sp}/minLength`,
                    keyword: 'minLength',
                    code: 'min-length',
                    message: `string has fewer than ${node.minLength} code points`,
                    expected: String(node.minLength),
                    actual: String(len),
                });
            }
        }
        if (Object.hasOwn(node, 'maxLength')) {
            const len = codePointLength(instance);
            if (typeof node.maxLength === 'number' && len > node.maxLength) {
                pushError(ctx.buf, {
                    instancePath: ip,
                    schemaPath: `${sp}/maxLength`,
                    keyword: 'maxLength',
                    code: 'max-length',
                    message: `string has more than ${node.maxLength} code points`,
                    expected: String(node.maxLength),
                    actual: String(len),
                });
            }
        }
        if (Object.hasOwn(node, 'pattern') && typeof node.pattern === 'string') {
            queuePatternCheck(ctx, node.pattern, instance, ip, sp);
        }
    }
    // ── 数字关键字（仅当 instance 为 number）──
    if (typeof instance === 'number') {
        if (Object.hasOwn(node, 'minimum') && typeof node.minimum === 'number') {
            if (instance < node.minimum) {
                pushError(ctx.buf, {
                    instancePath: ip,
                    schemaPath: `${sp}/minimum`,
                    keyword: 'minimum',
                    code: 'minimum',
                    message: `must be >= ${node.minimum}`,
                    expected: String(node.minimum),
                    actual: String(instance),
                });
            }
        }
        if (Object.hasOwn(node, 'maximum') && typeof node.maximum === 'number') {
            if (instance > node.maximum) {
                pushError(ctx.buf, {
                    instancePath: ip,
                    schemaPath: `${sp}/maximum`,
                    keyword: 'maximum',
                    code: 'maximum',
                    message: `must be <= ${node.maximum}`,
                    expected: String(node.maximum),
                    actual: String(instance),
                });
            }
        }
        if (Object.hasOwn(node, 'exclusiveMinimum') && typeof node.exclusiveMinimum === 'number') {
            if (instance <= node.exclusiveMinimum) {
                pushError(ctx.buf, {
                    instancePath: ip,
                    schemaPath: `${sp}/exclusiveMinimum`,
                    keyword: 'exclusiveMinimum',
                    code: 'exclusive-minimum',
                    message: `must be > ${node.exclusiveMinimum}`,
                    expected: String(node.exclusiveMinimum),
                    actual: String(instance),
                });
            }
        }
        if (Object.hasOwn(node, 'exclusiveMaximum') && typeof node.exclusiveMaximum === 'number') {
            if (instance >= node.exclusiveMaximum) {
                pushError(ctx.buf, {
                    instancePath: ip,
                    schemaPath: `${sp}/exclusiveMaximum`,
                    keyword: 'exclusiveMaximum',
                    code: 'exclusive-maximum',
                    message: `must be < ${node.exclusiveMaximum}`,
                    expected: String(node.exclusiveMaximum),
                    actual: String(instance),
                });
            }
        }
        if (Object.hasOwn(node, 'multipleOf') && typeof node.multipleOf === 'number') {
            if (!isMultipleOf(instance, node.multipleOf)) {
                pushError(ctx.buf, {
                    instancePath: ip,
                    schemaPath: `${sp}/multipleOf`,
                    keyword: 'multipleOf',
                    code: 'multiple-of',
                    message: `must be a multiple of ${node.multipleOf}`,
                    expected: String(node.multipleOf),
                    actual: String(instance),
                });
            }
        }
    }
    // ── 组合关键字 ──
    if (Object.hasOwn(node, 'allOf') && Array.isArray(node.allOf))
        checkAllOf(ctx, node.allOf, instance, ip, sp);
    if (Object.hasOwn(node, 'anyOf') && Array.isArray(node.anyOf))
        checkAnyOf(ctx, node.anyOf, instance, ip, sp);
    if (Object.hasOwn(node, 'oneOf') && Array.isArray(node.oneOf))
        checkOneOf(ctx, node.oneOf, instance, ip, sp);
    if (Object.hasOwn(node, 'not'))
        checkNot(ctx, node.not, instance, ip, sp);
}
/** 执行验证遍历 + pattern 阶段 + deferred 结算。 */
async function runWalk(data, schema, opts) {
    const main = { errors: [], cap: opts.maxErrors, truncated: false };
    const state = {
        checkedNodes: 0,
        stopped: false,
        patternChecks: [],
        nextPatternId: 0,
        patternCount: 0,
        deferred: [],
        refStack: [],
        main,
    };
    const ctx = {
        root: schema,
        buf: main,
        validPatterns: opts.validPatterns,
        nodePaths: opts.nodePaths,
        state,
        validateNode,
    };
    validateNode(ctx, schema, data, '', '#');
    const budgetMs = opts.patternBudgetMs ?? PATTERN_BUDGET_MS;
    if (!state.stopped && !main.truncated && state.patternChecks.length > 0) {
        const result = await runPatternChecksInWorker(state.patternChecks, budgetMs);
        for (const check of state.patternChecks) {
            const m = result.matched[check.id];
            if (m === undefined) {
                pushError(check.owner, {
                    instancePath: check.instancePath,
                    schemaPath: check.schemaPath,
                    keyword: 'pattern',
                    code: 'pattern-timeout',
                    message: `pattern validation timed out (${budgetMs}ms shared budget)`,
                });
            }
            else if (!m) {
                pushError(check.owner, {
                    instancePath: check.instancePath,
                    schemaPath: check.schemaPath,
                    keyword: 'pattern',
                    code: 'pattern-mismatch',
                    message: 'string does not match pattern',
                    expected: check.pattern,
                });
            }
        }
    }
    if (!state.stopped && !main.truncated) {
        for (const d of state.deferred)
            d.run();
    }
    return {
        errors: sortErrors(main.errors),
        valid: main.errors.length === 0 && !main.truncated,
        checkedNodes: state.checkedNodes,
        truncated: main.truncated,
    };
}
/** 预检查（data/schema 守卫 + schema 关键字检查）；validateCore 与 normalize 共用。 */
export function preflight(data, schema) {
    const dataGuard = checkJsonValue(data, { maxBytes: MAX_DATA_BYTES, maxDepth: MAX_DEPTH, maxNodes: MAX_INSTANCE_NODES, label: 'data' });
    let dataError;
    if (!dataGuard.ok) {
        dataError = {
            instancePath: dataGuard.failure.path,
            schemaPath: '#',
            keyword: 'data',
            code: dataGuard.failure.code,
            message: dataGuard.failure.message,
        };
    }
    const schemaGuard = checkJsonValue(schema, { maxBytes: MAX_SCHEMA_BYTES, maxDepth: MAX_DEPTH, maxNodes: MAX_SCHEMA_NODES, label: 'schema' });
    let schemaIssues = [];
    let nodePaths = new WeakMap();
    let validPatterns = new Set();
    if (!schemaGuard.ok) {
        schemaIssues = [
            { schemaPath: schemaGuard.failure.path, keyword: 'schema', code: schemaGuard.failure.code, message: schemaGuard.failure.message },
        ];
    }
    else {
        const checked = checkSchema(schema);
        schemaIssues = checked.issues;
        nodePaths = checked.nodePaths;
        validPatterns = checked.validPatterns;
    }
    return { dataOk: dataGuard.ok, schemaOk: schemaGuard.ok, dataError, schemaIssues, nodePaths, validPatterns };
}
/** 完整验证（validate action 的核心；paths/normalize 复用）。 */
export async function validateCore(data, schema, opts) {
    const maxErrors = Math.min(Math.max(Math.trunc(opts.maxErrors), 1), MAX_ERRORS);
    const pre = preflight(data, schema);
    if (!pre.dataOk) {
        return {
            complete: false,
            valid: false,
            supportedSubsetValid: null,
            errors: pre.dataError ? [pre.dataError] : [],
            schemaIssues: pre.schemaIssues,
            checkedNodes: 0,
            truncated: false,
        };
    }
    if (!pre.schemaOk) {
        // schema 守卫失败（过大/过深/环/非 JSON）：strict 直接失败；非 strict 无法安全遍历
        return {
            complete: false,
            valid: pre.schemaIssues.length > 0 && opts.strictSchema ? false : null,
            supportedSubsetValid: null,
            errors: [],
            schemaIssues: pre.schemaIssues,
            checkedNodes: 0,
            truncated: false,
        };
    }
    if (pre.schemaIssues.length > 0 && opts.strictSchema) {
        return {
            complete: false,
            valid: false,
            supportedSubsetValid: null,
            errors: [],
            schemaIssues: pre.schemaIssues,
            checkedNodes: 0,
            truncated: false,
        };
    }
    // schema 根既非 boolean 也非对象（如数字）：subset 模式也无从验证
    if (!(typeof schema === 'boolean' || (typeof schema === 'object' && schema !== null && !Array.isArray(schema)))) {
        return {
            complete: false,
            valid: null,
            supportedSubsetValid: null,
            errors: [],
            schemaIssues: pre.schemaIssues,
            checkedNodes: 0,
            truncated: false,
        };
    }
    const outcome = await runWalk(data, schema, {
        maxErrors,
        strictSchema: opts.strictSchema,
        ...(opts.patternBudgetMs !== undefined ? { patternBudgetMs: opts.patternBudgetMs } : {}),
        nodePaths: pre.nodePaths,
        validPatterns: pre.validPatterns,
    });
    if (pre.schemaIssues.length > 0) {
        // strictSchema=false：subset 模式（valid 恒为 null，绝不表述为整个 schema 有效）
        return {
            complete: false,
            valid: null,
            supportedSubsetValid: outcome.valid,
            errors: outcome.errors,
            schemaIssues: pre.schemaIssues,
            checkedNodes: outcome.checkedNodes,
            truncated: outcome.truncated,
        };
    }
    return {
        complete: true,
        valid: outcome.valid,
        supportedSubsetValid: outcome.valid,
        errors: outcome.errors,
        schemaIssues: [],
        checkedNodes: outcome.checkedNodes,
        truncated: outcome.truncated,
    };
}
