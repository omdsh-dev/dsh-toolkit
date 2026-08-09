/**
 * dsh-tool-encoding 核心实现 —— UTF-8 文本编解码 + 哈希 + UUID。
 *
 * 契约（v2，已冻结）：
 * - v1 是 UTF-8 文本工具：所有输入输出为字符串；解码结果必须合法 UTF-8（fatal 解码）
 * - 输入/输出上限按 UTF-8 字节数：MAX_INPUT_BYTES = 1 MB（1,000,000），MAX_OUTPUT_BYTES = 4 MB（4,000,000）
 * - 孤立 surrogate 统一拒绝（String.prototype.isWellFormed）
 * - base64：无空白、`=` 仅末尾且 ≤2、长度 4 的倍数、模 4 余 1 拒绝
 * - base64url：输出 canonical 无 padding；解码兼容 `+/` 与可选 padding
 * - url_encode 是 component 语义（encodeURIComponent）
 * - 错误统一 "encoding: " 前缀
 */
import { createHash, randomUUID } from 'node:crypto';
// ── 常量 ──
const MAX_INPUT_BYTES = 1_000_000; // 1 MB（1,000,000 UTF-8 字节）
const MAX_OUTPUT_BYTES = 4_000_000; // 4 MB（url 编码最坏 ~3 倍膨胀；保险丝，输入上限内不触发）
const ALGORITHMS = { md5: true, sha1: true, sha256: true, sha512: true };
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const HEX_RE = /^[0-9a-fA-F]*$/;
// ── 校验器 ──
/** 拒绝 well-formed Unicode 之外的孤立 surrogate（所有文本输入统一入口）。 */
function validateUnicode(input) {
    if (!input.isWellFormed())
        throw new Error('encoding: invalid Unicode (lone surrogate)');
}
/** 输入字节上限（UTF-8 字节数，非 UTF-16 code unit 数）。 */
function assertInputBytes(input) {
    if (Buffer.byteLength(input, 'utf8') > MAX_INPUT_BYTES) {
        throw new Error(`encoding: input exceeds ${MAX_INPUT_BYTES} bytes`);
    }
}
/** 输出字节上限（编码膨胀防护）。 */
function assertOutputBytes(output) {
    if (Buffer.byteLength(output, 'utf8') > MAX_OUTPUT_BYTES) {
        throw new Error(`encoding: output exceeds ${MAX_OUTPUT_BYTES} bytes`);
    }
}
/** fatal UTF-8 解码：非法序列抛错；合法 U+FFFD（ef bf bd）不误伤。 */
function decodeUtf8Strict(buffer) {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    }
    catch {
        throw new Error('encoding: invalid UTF-8 output');
    }
}
/** 标准 base64 输入校验（无空白、`=` 仅末尾 ≤2、长度必须为 4 的倍数、canonical unused bits）。 */
function assertBase64(input) {
    if (!BASE64_RE.test(input))
        throw new Error('encoding: invalid base64 input');
    // 长度非 4 倍数一律拒绝（含模 4 余 1/2/3）：Node 的宽容解码会静默截断，必须自己拦
    if (input.length % 4 !== 0)
        throw new Error('encoding: invalid base64 input');
    // RFC 4648 canonical（ENC-02）：最后量子的 unused bits 必须为 0
    //   xx== → 第二字符低 4 bit 为 0；xxx= → 第三字符低 2 bit 为 0
    // 否则多个编码映射到同一文本（如 'Zh==' 与 canonical 'Zg==' 都解出 'f'）
    const dataLen = input.length - (input.endsWith('==') ? 2 : input.endsWith('=') ? 1 : 0);
    if (dataLen % 4 === 2) {
        const second = BASE64_ALPHABET.indexOf(input.charAt(dataLen - 1));
        if (second === -1 || (second & 0b1111) !== 0)
            throw new Error('encoding: non-canonical base64 input');
    }
    else if (dataLen % 4 === 3) {
        const third = BASE64_ALPHABET.indexOf(input.charAt(dataLen - 1));
        if (third === -1 || (third & 0b11) !== 0)
            throw new Error('encoding: non-canonical base64 input');
    }
}
/** hex 输入校验（偶数长度 + 全 hex 字符集）。 */
function assertHex(input) {
    if (input.length % 2 !== 0 || !HEX_RE.test(input))
        throw new Error('encoding: invalid hex input');
}
// ── 操作 ──
function b64Encode(input) {
    return Buffer.from(input, 'utf8').toString('base64');
}
function b64Decode(input) {
    assertBase64(input);
    return decodeUtf8Strict(Buffer.from(input, 'base64'));
}
function b64UrlEncode(input) {
    // Node 18.14+ 支持 'base64url'：无 padding、-/_ 字符集
    return Buffer.from(input, 'utf8').toString('base64url');
}
function b64UrlDecode(input) {
    // 宽容读入：+/ 与 -_ 双字符集、可选 padding → 归一为标准 base64
    const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
    // RECHECK-ENC-01：显式 padding 必须完整（数据 + padding 为 4 的倍数），
    // 残缺 padding（如 'Zg='）拒绝而非自动补全；无 padding 时按量子补齐
    let padded;
    const firstPadding = normalized.indexOf('=');
    if (firstPadding !== -1) {
        const data = normalized.slice(0, firstPadding);
        const padding = normalized.slice(firstPadding);
        if (!/^={1,2}$/.test(padding))
            throw new Error('encoding: invalid base64 input');
        padded = data + padding;
        if (padded.length % 4 !== 0)
            throw new Error('encoding: invalid base64 input');
    }
    else {
        if (normalized.length % 4 === 1)
            throw new Error('encoding: invalid base64 input');
        padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    }
    assertBase64(padded); // 含 canonical unused bits 校验
    return decodeUtf8Strict(Buffer.from(padded, 'base64'));
}
function urlEncode(input) {
    return encodeURIComponent(input);
}
function urlDecode(input) {
    try {
        return decodeURIComponent(input);
    }
    catch {
        throw new Error('encoding: invalid percent-encoding');
    }
}
function hexEncode(input) {
    return Buffer.from(input, 'utf8').toString('hex');
}
function hexDecode(input) {
    assertHex(input);
    return decodeUtf8Strict(Buffer.from(input, 'hex'));
}
function digest(algorithm, input) {
    if (!Object.hasOwn(ALGORITHMS, algorithm)) {
        throw new Error(`encoding: unknown algorithm "${algorithm}"`);
    }
    return createHash(algorithm).update(input, 'utf8').digest('hex');
}
function newUuid() {
    return randomUUID();
}
function isPlainObject(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}
export function executeAction(action, params) {
    // AUDIT-ENC-03：纯函数入口自洽——action/params 类型错误统一 encoding: 前缀
    if (typeof action !== 'string') {
        throw new Error('encoding: action must be a string');
    }
    if (!isPlainObject(params)) {
        throw new Error('encoding: parameters must be an object');
    }
    const actionParams = params;
    switch (action) {
        case 'uuid': {
            // AUDIT-ENC-02：拒绝任意额外参数（含拼写错误字段），不只检查已知字段
            if (Object.keys(actionParams).length > 0) {
                throw new Error('encoding: uuid takes no parameters');
            }
            return newUuid();
        }
        case 'hash': {
            if (typeof actionParams.algorithm !== 'string')
                throw new Error('encoding: missing required parameter "algorithm"');
            if (typeof actionParams.input !== 'string')
                throw new Error('encoding: missing required parameter "input"');
            validateUnicode(actionParams.input);
            assertInputBytes(actionParams.input);
            return digest(actionParams.algorithm, actionParams.input);
        }
        case 'base64_encode':
        case 'base64url_encode':
        case 'url_encode':
        case 'hex_encode': {
            if (typeof actionParams.input !== 'string')
                throw new Error('encoding: missing required parameter "input"');
            validateUnicode(actionParams.input);
            assertInputBytes(actionParams.input);
            // ENC-04：分配前按精确最坏膨胀率预估输出（AUDIT-ENC-04 修正公式）
            const inputBytes = Buffer.byteLength(actionParams.input, 'utf8');
            const worstCase = action === 'hex_encode' ? inputBytes * 2
                : action === 'base64_encode' ? 4 * Math.ceil(inputBytes / 3)
                    : action === 'base64url_encode' ? 4 * Math.ceil(inputBytes / 3) - (inputBytes % 3 === 0 ? 0 : 4 - (inputBytes % 3))
                        : inputBytes * 3; // url_encode 最坏 ~3 倍
            if (worstCase > MAX_OUTPUT_BYTES)
                throw new Error('encoding: output would exceed limit');
            const output = action === 'base64_encode' ? b64Encode(actionParams.input)
                : action === 'base64url_encode' ? b64UrlEncode(actionParams.input)
                    : action === 'url_encode' ? urlEncode(actionParams.input)
                        : hexEncode(actionParams.input);
            assertOutputBytes(output);
            return output;
        }
        case 'base64_decode':
        case 'base64url_decode':
        case 'url_decode':
        case 'hex_decode': {
            if (typeof actionParams.input !== 'string')
                throw new Error('encoding: missing required parameter "input"');
            validateUnicode(actionParams.input);
            assertInputBytes(actionParams.input);
            // ENC-04：解码输出字节数 ≤ 输入字节数（base64/hex 输入为 ASCII），分配前预检
            if (Buffer.byteLength(actionParams.input, 'utf8') > MAX_OUTPUT_BYTES) {
                throw new Error('encoding: decoded output would exceed limit');
            }
            const output = action === 'base64_decode' ? b64Decode(actionParams.input)
                : action === 'base64url_decode' ? b64UrlDecode(actionParams.input)
                    : action === 'url_decode' ? urlDecode(actionParams.input)
                        : hexDecode(actionParams.input);
            assertOutputBytes(output);
            return output;
        }
        default:
            throw new Error(`encoding: unknown action "${action}"`);
    }
}
