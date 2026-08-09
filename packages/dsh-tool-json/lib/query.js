/**
 * JMESPath-inspired 路径查询解析器 + 执行器 —— 零依赖，纯函数。
 *
 * 语法：点号访问 (foo.bar) | 方括号索引 (items[0]) | 方括号属性
 * (items['key'] | items["key"]，支持 \\ \' \" 转义) | 数组通配符投影 (items[*].name)
 *
 * 安全：无 eval/new Function；Object.hasOwn 防原型链；
 * 深度上限 20 层；查询长度上限 200；输入 1 MB 字节（对象/字符串统一累计）；投影元素上限 100k（含无尾路径）。
 *
 * 错误分类（审查 JSON-02）：JsonQueryError.code =
 *   MISSING_PROPERTY（投影时跳过）| TYPE_MISMATCH | INDEX_OUT_OF_BOUNDS | INVALID_QUERY
 * 通配符投影只吞 MISSING_PROPERTY，其余错误重新抛出。
 */
const MAX_DEPTH = 20;
const MAX_LENGTH = 200;
const MAX_INPUT_BYTES = 1_000_000; // 1 MB（1,000,000 UTF-8 字节）
const MAX_PROJECTION_ITEMS = 100_000; // 单次投影遍历上限（JSON-03）
export class JsonQueryError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'JsonQueryError';
        this.code = code;
    }
}
// ── 解析器 ──
function parseQuery(input) {
    if (input.length > MAX_LENGTH)
        throw new JsonQueryError('INVALID_QUERY', `Query too long (${input.length} > ${MAX_LENGTH})`);
    if (input === '')
        return [];
    const steps = [];
    let pos = 0;
    const peek = () => input.charAt(pos);
    const take = () => input.charAt(pos++);
    const err = (msg) => { throw new JsonQueryError('INVALID_QUERY', `json: ${msg} at position ${pos}`); };
    while (pos < input.length) {
        if (steps.length >= MAX_DEPTH)
            err(`query depth exceeds ${MAX_DEPTH}`);
        if (peek() === '.') {
            take(); // '.'
            const start = pos;
            while (pos < input.length && /[A-Za-z0-9_$\u0080-\uFFFF]/.test(input.charAt(pos)))
                pos++;
            if (pos === start)
                err('expected property name after "."');
            steps.push({ kind: 'dot', key: input.slice(start, pos) });
            continue;
        }
        if (peek() === '[') {
            take(); // '['
            if (peek() === '*') {
                take();
                if (peek() !== ']')
                    err('expected "]" after "*"');
                take();
                steps.push({ kind: 'wildcard' });
                continue;
            }
            if (peek() === "'" || peek() === '"') {
                // JSON-05：引号属性支持 \\ \' \" 转义；其他转义拒绝
                const quote = take();
                let key = '';
                while (pos < input.length) {
                    const c = input.charAt(pos);
                    if (c === '\\') {
                        const next = input.charAt(pos + 1);
                        if (next === '\\' || next === "'" || next === '"') {
                            key += next;
                            pos += 2;
                            continue;
                        }
                        err('invalid escape in quoted key');
                    }
                    if (c === quote)
                        break;
                    key += c;
                    pos++;
                }
                if (pos >= input.length)
                    err(`missing closing ${quote}`);
                take(); // closing quote
                if (peek() !== ']')
                    err('expected "]" after property key');
                take();
                steps.push({ kind: 'bracket', key });
                continue;
            }
            if (/[0-9]/.test(peek() ?? '')) {
                const start = pos;
                while (pos < input.length && /[0-9]/.test(input.charAt(pos)))
                    pos++;
                const raw = input.slice(start, pos);
                const idx = Number(raw);
                if (!Number.isSafeInteger(idx))
                    err('array index is too large');
                if (peek() !== ']')
                    err('expected "]" after index');
                take();
                steps.push({ kind: 'index', index: idx });
                continue;
            }
            err('expected "*", digit, or quote after "["');
        }
        // 起始位置：裸标识符（无前导 "." 的点号访问）
        if (pos === 0 && /[A-Za-z_$\u0080-\uFFFF]/.test(peek() ?? '')) {
            const start = pos;
            while (pos < input.length && /[A-Za-z0-9_$\u0080-\uFFFF]/.test(input.charAt(pos)))
                pos++;
            steps.push({ kind: 'dot', key: input.slice(start, pos) });
            continue;
        }
        err(`unexpected character "${peek()}"`);
    }
    return steps;
}
// ── 执行器 ──
function executeQuery(steps, value) {
    let current = value;
    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        if (current === null || current === undefined) {
            throw new JsonQueryError('TYPE_MISMATCH', 'json: cannot access property on null/undefined');
        }
        if (typeof current !== 'object') {
            throw new JsonQueryError('TYPE_MISMATCH', `json: cannot access property on ${typeof current}`);
        }
        if (step.kind === 'dot' || step.kind === 'bracket') {
            if (!Object.hasOwn(current, step.key)) {
                throw new JsonQueryError('MISSING_PROPERTY', `json: property "${step.key}" not found`);
            }
            current = current[step.key];
            continue;
        }
        if (step.kind === 'index') {
            if (!Array.isArray(current)) {
                throw new JsonQueryError('TYPE_MISMATCH', 'json: index access on non-array');
            }
            if (step.index >= current.length) {
                throw new JsonQueryError('INDEX_OUT_OF_BOUNDS', `json: index ${step.index} out of bounds (length ${current.length})`);
            }
            current = current[step.index];
            continue;
        }
        // 前三个分支均 continue，此处必为 wildcard
        if (!Array.isArray(current)) {
            throw new JsonQueryError('TYPE_MISMATCH', 'json: wildcard projection on non-array');
        }
        const arr = current;
        // RECHECK2-JSON-02：上限覆盖无尾路径（items[*] 直接返回数组同样受限）
        if (arr.length > MAX_PROJECTION_ITEMS) {
            throw new JsonQueryError('INVALID_QUERY', `json: wildcard projection exceeds ${MAX_PROJECTION_ITEMS} items`);
        }
        const remaining = steps.slice(i + 1);
        if (remaining.length === 0) {
            current = arr; // 无后续路径：返回全体元素（含标量）
        }
        else {
            // JSON-01：循环 push 保留合法的 null 结果（不用 null 作失败哨兵）
            // JSON-02：只跳过 MISSING_PROPERTY，类型/索引/内部错误重新抛出
            const projected = [];
            for (const item of arr) {
                if (item === null || item === undefined || typeof item !== 'object')
                    continue; // 非对象元素跳过
                try {
                    projected.push(executeQuery(remaining, item));
                }
                catch (error) {
                    if (error instanceof JsonQueryError && error.code === 'MISSING_PROPERTY')
                        continue;
                    throw error;
                }
            }
            current = projected;
        }
        return current; // 通配符是终态
    }
    return current;
}
/**
 * 累计 UTF-8 字节并即时检查上限（AUDIT-JSON-01：所有标量和结构分支统一检查，
 * 不再只在 string/key 分支触发——纯 number/boolean/null 数组也能被拦截）。
 */
function addBytes(state, amount) {
    state.bytes += amount;
    if (state.bytes > MAX_INPUT_BYTES) {
        throw new JsonQueryError('INVALID_QUERY', `json: input exceeds ${MAX_INPUT_BYTES} bytes`);
    }
}
/**
 * JSON-08 + RECHECK2-JSON-01/03.1 + AUDIT-JSON-04：只接受 JSON-compatible 值
 * （null/boolean/number/string/array/plain object），遍历时累计 UTF-8 字节数
 * （key + string value + 结构开销 + 按实际表示的 number 长度），用递归路径
 * WeakSet 检测循环引用，并拒绝不可枚举属性与 accessor（own-property 全量检查）。
 */
function assertJsonCompatible(value, depth, ancestors, state) {
    if (depth > 100)
        throw new JsonQueryError('INVALID_QUERY', 'json: input nesting too deep');
    if (value === null) {
        addBytes(state, 4);
        return;
    }
    if (typeof value === 'string') {
        addBytes(state, Buffer.byteLength(value, 'utf8') + 2); // 引号开销
        return;
    }
    if (typeof value === 'boolean') {
        addBytes(state, 5);
        return;
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value))
            throw new JsonQueryError('INVALID_QUERY', 'json: non-finite number in input');
        addBytes(state, String(value).length); // 按实际 JSON 表示长度（1e100 等长数字）
        return;
    }
    if (typeof value !== 'object') {
        // undefined / function / symbol / bigint
        throw new JsonQueryError('INVALID_QUERY', 'json: input must be JSON-compatible');
    }
    if (ancestors.has(value)) {
        throw new JsonQueryError('INVALID_QUERY', 'json: circular input');
    }
    ancestors.add(value);
    try {
        if (Array.isArray(value)) {
            addBytes(state, 2); // [ ]
            for (let i = 0; i < value.length; i++) {
                if (i > 0)
                    addBytes(state, 1); // 逗号
                assertJsonCompatible(value[i], depth + 1, ancestors, state);
            }
            return;
        }
        const proto = Object.getPrototypeOf(value);
        if (proto !== Object.prototype && proto !== null) {
            throw new JsonQueryError('INVALID_QUERY', 'json: input must be a plain JSON object');
        }
        // AUDIT-JSON-04：own-property 全量检查（含不可枚举与 accessor），
        // Object.keys 只查可枚举属性会让不可枚举 own 属性绕过校验
        const ownKeys = [
            ...Object.getOwnPropertyNames(value),
            ...Object.getOwnPropertySymbols(value),
        ];
        if (ownKeys.length > 0)
            addBytes(state, 2); // { }
        ownKeys.forEach((key, index) => {
            if (index > 0)
                addBytes(state, 1); // 逗号
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (descriptor === undefined)
                throw new JsonQueryError('INVALID_QUERY', 'json: input must be JSON-compatible');
            if (!descriptor.enumerable) {
                throw new JsonQueryError('INVALID_QUERY', 'json: non-enumerable property is not JSON-compatible');
            }
            if (typeof key === 'string') {
                addBytes(state, Buffer.byteLength(key, 'utf8') + 3); // key + 引号冒号
            }
            else {
                addBytes(state, 4); // symbol key 无 JSON 表示，拒绝
                throw new JsonQueryError('INVALID_QUERY', 'json: symbol property is not JSON-compatible');
            }
            if ('get' in descriptor || 'set' in descriptor) {
                throw new JsonQueryError('INVALID_QUERY', 'json: accessor property is not JSON-compatible');
            }
            assertJsonCompatible(descriptor.value, depth + 1, ancestors, state);
        });
    }
    finally {
        ancestors.delete(value); // 递归路径语义：共享非循环对象不误判
    }
}
export function normalizeInput(input) {
    if (typeof input === 'string') {
        // JSON-03：字符串输入字节上限（UTF-8 字节数）
        if (Buffer.byteLength(input, 'utf8') > MAX_INPUT_BYTES) {
            throw new JsonQueryError('INVALID_QUERY', `json: input exceeds ${MAX_INPUT_BYTES} bytes`);
        }
        try {
            const parsed = JSON.parse(input);
            assertJsonCompatible(parsed, 0, new WeakSet(), { bytes: 0 });
            return parsed;
        }
        catch (error) {
            if (error instanceof JsonQueryError)
                throw error; // 深度/类型错误如实透传
            throw new JsonQueryError('INVALID_QUERY', 'json: invalid JSON input');
        }
    }
    assertJsonCompatible(input, 0, new WeakSet(), { bytes: 0 });
    return input;
}
// ── 公开接口 ──
const MAX_OUTPUT_BYTES = 4_000_000; // 4 MB 输出保险丝（AUDIT-JSON-02）
export function query(jsonInput, queryStr) {
    if (typeof queryStr !== 'string') {
        throw new JsonQueryError('INVALID_QUERY', 'json: query must be a string');
    }
    const steps = parseQuery(queryStr);
    const result = executeQuery(steps, normalizeInput(jsonInput));
    // AUDIT-JSON-02：输入限制不等于输出限制（空查询返回整个输入、选中字段可接近输入上限）
    const text = JSON.stringify(result);
    if (Buffer.byteLength(text, 'utf8') > MAX_OUTPUT_BYTES) {
        throw new JsonQueryError('INVALID_QUERY', `json: output exceeds ${MAX_OUTPUT_BYTES} bytes`);
    }
    return result;
}
