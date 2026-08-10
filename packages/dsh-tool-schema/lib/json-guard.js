/**
 * JSON 守卫 —— 带 cycle 检测的迭代遍历，同时统计估算 UTF-8 字节、嵌套深度与
 * 节点数，并校验值是否 JSON-compatible。
 *
 * 设计文档 §8：JSON value 可能以已解析对象传入，不能只检查 JSON.stringify 后
 * 的大小；需要带 cycle 检测的迭代遍历，同时统计节点、深度和估算 UTF-8 字节。
 * 虽然 DSH canonical JSON 理论上排除 cycle，独立核心函数仍应防御直接调用。
 *
 * 安全属性：
 * - 只接受 plain object（原型为 null 或 Object.prototype）、数组与 JSON 基本类型；
 *   类实例 / Date / Map / Set / 函数 / symbol / bigint / undefined / NaN / Infinity
 *   均视为非 JSON（cycle 也在此报告）。
 * - 所有对象访问使用 Object.hasOwn，`__proto__`/`constructor`/`prototype` 不会
 *   产生原型链误判。
 */
/** plain object 判定：原型为 null 或 Object.prototype（不接收数组）。 */
export function isJsonRecord(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return false;
    const proto = Object.getPrototypeOf(value);
    return proto === null || proto === Object.prototype;
}
/** 字符串的 UTF-8 字节估算。 */
function utf8Bytes(s) {
    return Buffer.byteLength(s, 'utf8');
}
/** 非字符串标量的 UTF-8 字节估算。 */
function scalarBytes(value) {
    if (value === null)
        return 4;
    if (typeof value === 'boolean')
        return value ? 4 : 5;
    // 数字：String() 长度是 JSON 文本长度的合理估算
    return String(value).length;
}
/**
 * 校验值并统计。遇第一个问题即返回（ok=false + failure）。
 */
export function checkJsonValue(value, opts) {
    const { maxBytes, maxDepth, maxNodes, label } = opts;
    const ancestors = new Set();
    let nodes = 0;
    let bytes = 0;
    let maxDepthSeen = 0;
    const fail = (code, message, path) => ({
        ok: false,
        nodes,
        depth: maxDepthSeen,
        bytes,
        failure: { path, code, message },
    });
    const stack = [{ value, path: '', depth: 0, enter: true }];
    while (stack.length > 0) {
        const frame = stack.pop();
        const { value: current, path, depth } = frame;
        if (!frame.enter) {
            if (typeof current === 'object' && current !== null)
                ancestors.delete(current);
            continue;
        }
        if (depth > maxDepthSeen)
            maxDepthSeen = depth;
        if (depth > maxDepth) {
            return fail(`${label}-depth`, `${label} nesting exceeds ${maxDepth}`, path);
        }
        // ── 标量 ──
        if (current === null || typeof current === 'boolean' || typeof current === 'string') {
            nodes++;
            if (nodes > maxNodes) {
                return fail(`${label}-nodes`, `${label} exceeds ${maxNodes} nodes`, path);
            }
            bytes += typeof current === 'string' ? utf8Bytes(current) : scalarBytes(current);
            if (bytes > maxBytes) {
                return fail(`${label}-size`, `${label} exceeds ${maxBytes} bytes (UTF-8 estimate)`, path);
            }
            continue;
        }
        if (typeof current === 'number') {
            if (!Number.isFinite(current)) {
                return fail(`${label}-invalid`, `${label} contains a non-finite number (NaN/Infinity) which is not JSON`, path);
            }
            nodes++;
            if (nodes > maxNodes) {
                return fail(`${label}-nodes`, `${label} exceeds ${maxNodes} nodes`, path);
            }
            bytes += scalarBytes(current);
            if (bytes > maxBytes) {
                return fail(`${label}-size`, `${label} exceeds ${maxBytes} bytes (UTF-8 estimate)`, path);
            }
            continue;
        }
        // ── 对象 / 数组 ──
        if (typeof current !== 'object' || current === null) {
            return fail(`${label}-invalid`, `${label} contains a value that is not JSON-compatible (${typeof current})`, path);
        }
        const obj = current;
        if (ancestors.has(obj)) {
            return fail(`${label}-cycle`, `${label} contains a reference cycle`, path);
        }
        if (!Array.isArray(obj) && !isJsonRecord(obj)) {
            return fail(`${label}-invalid`, `${label} contains a value that is not a plain JSON object or array (${obj.constructor?.name ?? 'unknown'})`, path);
        }
        ancestors.add(obj);
        nodes++;
        if (nodes > maxNodes) {
            return fail(`${label}-nodes`, `${label} exceeds ${maxNodes} nodes`, path);
        }
        if (bytes > maxBytes) {
            return fail(`${label}-size`, `${label} exceeds ${maxBytes} bytes (UTF-8 estimate)`, path);
        }
        if (Array.isArray(obj)) {
            for (let i = 0; i < obj.length; i++) {
                if (!Object.hasOwn(obj, i))
                    continue;
                stack.push({ value: obj[i], path: `${path}/${i}`, depth: depth + 1, enter: false });
                stack.push({ value: obj[i], path: `${path}/${i}`, depth: depth + 1, enter: true });
            }
        }
        else {
            const record = obj;
            for (const key of Object.keys(record)) {
                bytes += utf8Bytes(key);
                if (bytes > maxBytes) {
                    return fail(`${label}-size`, `${label} exceeds ${maxBytes} bytes (UTF-8 estimate)`, `${path}/${escapeToken(key)}`);
                }
                const childPath = `${path}/${escapeToken(key)}`;
                stack.push({ value: record[key], path: childPath, depth: depth + 1, enter: false });
                stack.push({ value: record[key], path: childPath, depth: depth + 1, enter: true });
            }
        }
    }
    if (bytes > maxBytes) {
        return fail(`${label}-size`, `${label} exceeds ${maxBytes} bytes (UTF-8 estimate)`, '');
    }
    return { ok: true, nodes, depth: maxDepthSeen, bytes };
}
/** RFC 6901 指针 token 转义：`~` → `~0`，`/` → `~1`。 */
export function escapeToken(token) {
    return token.replace(/~/g, '~0').replace(/\//g, '~1');
}
/** 仅做 JSON-compatible 判定（无大小/深度限制；含 cycle 检测）。 */
export function isJsonCompatible(value) {
    const seen = new Set();
    const visit = (v) => {
        if (v === null || typeof v === 'string' || typeof v === 'boolean')
            return true;
        if (typeof v === 'number')
            return Number.isFinite(v);
        if (typeof v !== 'object')
            return false;
        if (seen.has(v))
            return false;
        if (!Array.isArray(v) && !isJsonRecord(v))
            return false;
        seen.add(v);
        if (Array.isArray(v)) {
            for (const item of v)
                if (!visit(item))
                    return false;
        }
        else {
            for (const key of Object.keys(v)) {
                if (!visit(v[key]))
                    return false;
            }
        }
        seen.delete(v);
        return true;
    };
    return visit(value);
}
