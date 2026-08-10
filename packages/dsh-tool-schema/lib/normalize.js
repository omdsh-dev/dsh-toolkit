/**
 * normalize action —— 深拷贝数据，对缺失属性应用显式 `default` 后完整验证。
 *
 * 设计文档 §6（v1 严格限定）：
 * - 从不修改输入对象，先构造 JSON 深拷贝；所有新对象用 Object.create(null)，
 *   `__proto__`/`constructor`/`prototype` 作为普通 JSON 键处理（null-prototype
 *   对象无继承 setter，赋值天然安全）；
 * - 只应用 `properties` 中缺失字段的显式 `default`；
 * - 不做类型强制转换；不删除 additional properties；不猜测 enum/const；
 * - 不通过网络或代码计算 default；
 * - default 自身必须 JSON-compatible 且通过对应子 schema（否则跳过 + warning）；
 * - 对 oneOf/anyOf 不自动选分支应用 default：仅当恰好一个分支在不应用 default
 *   时已经匹配，才允许进入该分支；否则保持不变并给 warning；
 * - 返回 appliedDefaults 路径列表，再对结果运行完整 validate。
 */
import { escapeToken, isJsonCompatible, isJsonRecord } from "./json-guard.js";
import { resolveRef } from "./ref.js";
import { preflight, validateCore } from "./validator.js";
/** 深拷贝：新对象均为 null-prototype；WeakMap 防御输入环（守卫已拒绝，双保险）。 */
export function deepCopyJson(value) {
    const memo = new WeakMap();
    const copy = (v) => {
        if (v === null || typeof v !== 'object')
            return v;
        const cached = memo.get(v);
        if (cached !== undefined)
            return cached;
        if (Array.isArray(v)) {
            const arr = [];
            memo.set(v, arr);
            for (let i = 0; i < v.length; i++)
                arr.push(copy(v[i]));
            return arr;
        }
        const obj = Object.create(null);
        memo.set(v, obj);
        for (const key of Object.keys(v)) {
            obj[key] = copy(v[key]);
        }
        return obj;
    };
    return copy(value);
}
function warn(ctx, instancePath, schemaPath, code, message) {
    ctx.warnings.push({ instancePath, schemaPath, code, message });
}
/**
 * 递归应用 default。schema 为 boolean 时无操作；`$ref` 先解析目标再继续
 * sibling（draft 2020-12 语义）。
 */
async function applyDefaults(schema, instance, ip, ctx) {
    if (typeof schema === 'boolean')
        return;
    if (!isJsonRecord(schema))
        return;
    if (Object.hasOwn(schema, '$ref') && typeof schema.$ref === 'string') {
        const resolved = resolveRef(ctx.root, schema.$ref);
        if (resolved.ok) {
            await applyDefaults(resolved.value, instance, ip, ctx);
        }
        // 继续 sibling
    }
    if (typeof instance !== 'object' || instance === null)
        return;
    if (!Array.isArray(instance)) {
        const record = instance;
        if (Object.hasOwn(schema, 'properties') && isJsonRecord(schema.properties)) {
            const props = schema.properties;
            for (const key of Object.keys(props)) {
                const sub = props[key];
                const childIp = `${ip}/${escapeToken(key)}`;
                if (Object.hasOwn(record, key)) {
                    await applyDefaults(sub, record[key], childIp, ctx);
                }
                else if (isJsonRecord(sub) && Object.hasOwn(sub, 'default')) {
                    const def = sub.default;
                    const defSchemaPath = `${schemaPathOf(ctx, sub)}/default`;
                    if (!isJsonCompatible(def)) {
                        warn(ctx, childIp, defSchemaPath, 'default-invalid', 'default value is not JSON-compatible; not applied');
                        continue;
                    }
                    const verdict = await validateCore(def, sub, { maxErrors: 1, strictSchema: true });
                    if (verdict.valid === true) {
                        record[key] = deepCopyJson(def);
                        ctx.applied.push(childIp);
                    }
                    else {
                        warn(ctx, childIp, defSchemaPath, 'default-invalid', 'default value does not validate against its sub-schema; not applied');
                    }
                }
            }
        }
    }
    else {
        const arr = instance;
        if (typeof schema.items === 'boolean' || isJsonRecord(schema.items)) {
            for (let i = 0; i < arr.length; i++) {
                await applyDefaults(schema.items, arr[i], `${ip}/${i}`, ctx);
            }
        }
    }
    // oneOf / anyOf：恰好一个分支（不应用 default 时）匹配才进入
    for (const comb of ['oneOf', 'anyOf']) {
        if (Array.isArray(schema[comb])) {
            const branches = schema[comb];
            const matched = [];
            for (let i = 0; i < branches.length; i++) {
                const verdict = await validateCore(instance, branches[i], { maxErrors: 1, strictSchema: true });
                if (verdict.valid === true)
                    matched.push(i);
            }
            if (matched.length === 1) {
                await applyDefaults(branches[matched[0]], instance, ip, ctx);
            }
            else {
                warn(ctx, ip, `${schemaPathOf(ctx, schema)}/${comb}`, 'normalize-skip-branch', `${comb}: ${matched.length} branches match without defaults; defaults not applied`);
            }
        }
    }
}
function schemaPathOf(ctx, node) {
    return ctx.nodePaths.get(node) ?? '#';
}
/** normalize action。 */
export async function normalizeAction(data, schema, opts) {
    const pre = preflight(data, schema);
    const strictFail = pre.schemaIssues.length > 0 && opts.strictSchema;
    if (!pre.dataOk) {
        return {
            action: 'normalize',
            complete: false,
            valid: false,
            supportedSubsetValid: null,
            value: null,
            appliedDefaults: [],
            warnings: [],
            errors: pre.dataError ? [pre.dataError] : [],
            schemaIssues: pre.schemaIssues,
            truncated: false,
        };
    }
    if (!pre.schemaOk) {
        return {
            action: 'normalize',
            complete: false,
            valid: strictFail ? false : null,
            supportedSubsetValid: null,
            value: deepCopyJson(data),
            appliedDefaults: [],
            warnings: [],
            errors: [],
            schemaIssues: pre.schemaIssues,
            truncated: false,
        };
    }
    if (strictFail) {
        return {
            action: 'normalize',
            complete: false,
            valid: false,
            supportedSubsetValid: null,
            value: deepCopyJson(data),
            appliedDefaults: [],
            warnings: [],
            errors: [],
            schemaIssues: pre.schemaIssues,
            truncated: false,
        };
    }
    const value = deepCopyJson(data);
    const ctx = {
        root: schema,
        nodePaths: pre.nodePaths,
        applied: [],
        warnings: [],
        opts,
    };
    await applyDefaults(schema, value, '', ctx);
    const core = await validateCore(value, schema, opts);
    return {
        action: 'normalize',
        complete: core.complete,
        valid: core.valid,
        supportedSubsetValid: core.supportedSubsetValid,
        value,
        appliedDefaults: ctx.applied,
        warnings: ctx.warnings,
        errors: core.errors,
        schemaIssues: core.schemaIssues,
        truncated: core.truncated,
    };
}
