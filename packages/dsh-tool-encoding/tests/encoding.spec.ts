import { describe, expect, it } from 'vitest'
import { executeAction } from '../src/encoding.ts'

function act(action: string, params: Record<string, unknown> = {}): string {
  return executeAction(action, params)
}

describe('encoding: base64', () => {
  it('round-trips empty, ascii, CJK, emoji', () => {
    for (const s of ['', 'foobar', '中文测试', 'emoji 🎉']) {
      expect(act('base64_decode', { input: act('base64_encode', { input: s }) })).toBe(s)
    }
  })

  it('RFC 4648 test vectors', () => {
    expect(act('base64_encode', { input: 'foobar' })).toBe('Zm9vYmFy')
    expect(act('base64_encode', { input: 'f' })).toBe('Zg==')
    expect(act('base64_encode', { input: 'fo' })).toBe('Zm8=')
    expect(act('base64_decode', { input: 'Zm9vYmFy' })).toBe('foobar')
  })

  it('decodes binary-ish base64 to valid UTF-8 text', () => {
    // "hello" 的 base64，含可打印字符
    expect(act('base64_decode', { input: 'aGVsbG8=' })).toBe('hello')
  })

  it('rejects non-base64 characters', () => {
    expect(() => act('base64_decode', { input: '!!!' })).toThrow('encoding: invalid base64 input')
    expect(() => act('base64_decode', { input: 'Zm9vY***' })).toThrow('encoding: invalid base64 input')
  })

  it('rejects whitespace in base64', () => {
    expect(() => act('base64_decode', { input: 'Zm9v YmFy' })).toThrow('encoding: invalid base64 input')
    expect(() => act('base64_decode', { input: 'Zm9v\nYmFy' })).toThrow('encoding: invalid base64 input')
  })

  it('rejects misplaced padding', () => {
    expect(() => act('base64_decode', { input: 'Zm9vYmFy@@' })).toThrow('encoding: invalid base64 input')
    expect(() => act('base64_decode', { input: '=Zm9v' })).toThrow('encoding: invalid base64 input')
  })

  it('rejects length not multiple of 4 (mod 1/2/3)', () => {
    expect(() => act('base64_decode', { input: 'Zm9vY' })).toThrow('encoding: invalid base64 input') // mod 1
    expect(() => act('base64_decode', { input: 'Zm9vYm' })).toThrow('encoding: invalid base64 input') // mod 3
    // 10 字符 = 8 数据 + 冗余 '=='：长度非 4 倍数，冗余 padding 拒绝
    expect(() => act('base64_decode', { input: 'Zm9vYmFy==' })).toThrow('encoding: invalid base64 input') // mod 2
    expect(() => act('base64url_decode', { input: 'Zm9vYmFy==' })).toThrow('encoding: invalid base64 input')
  })

  it('empty string is valid', () => {
    expect(act('base64_encode', { input: '' })).toBe('')
    expect(act('base64_decode', { input: '' })).toBe('')
  })
})

describe('encoding: base64url', () => {
  it('RFC 4648 §5 vectors (no padding, -/_ charset)', () => {
    expect(act('base64url_encode', { input: 'foobar' })).toBe('Zm9vYmFy')
    expect(act('base64url_encode', { input: 'f' })).toBe('Zg') // 无 padding
  })

  it('encodes / with -_ instead of standard base64', () => {
    // U+FEFF (BOM) 的 UTF-8 是 EF BB BF → base64 '77u/' 含 '/'
    const s = '\uFEFF'
    expect(act('base64_encode', { input: s })).toBe('77u/')
    expect(act('base64url_encode', { input: s })).toBe('77u_')
  })

  it('decodes JWT payload (standard chars, no padding)', () => {
    // {"sub":"123"} → base64 'eyJzdWIiOiIxMjMifQ==' → base64url 无 padding 'eyJzdWIiOiIxMjMifQ'
    expect(act('base64url_decode', { input: 'eyJzdWIiOiIxMjMifQ' })).toBe('{"sub":"123"}')
  })

  it('decodes compatibly with padding and standard +/', () => {
    // 'foo/bar' 的 base64 含 '/'：url 解码器应兼容标准字符与可选 padding
    expect(act('base64url_decode', { input: 'Zm9vL2Jhcg==' })).toBe('foo/bar')
    expect(act('base64url_decode', { input: 'Zm9vL2Jhcg' })).toBe('foo/bar')
  })

  it('round-trips', () => {
    for (const s of ['', 'JWT-style data', '中文']) {
      expect(act('base64url_decode', { input: act('base64url_encode', { input: s }) })).toBe(s)
    }
  })
})

describe('encoding: url', () => {
  it('encodes component semantics: space is %20, not +', () => {
    expect(act('url_encode', { input: 'a b&c=1' })).toBe('a%20b%26c%3D1')
  })

  it('does not escape ! \' ( ) *', () => {
    expect(act('url_encode', { input: "!'()*" })).toBe("!'()*")
  })

  it('decodes + as literal plus (component semantics)', () => {
    expect(act('url_decode', { input: '+' })).toBe('+')
  })

  it('round-trips CJK and special chars', () => {
    const s = '中文 ?&#=路径'
    expect(act('url_decode', { input: act('url_encode', { input: s }) })).toBe(s)
  })

  it('rejects invalid percent-encoding', () => {
    expect(() => act('url_decode', { input: '%zz' })).toThrow('encoding: invalid percent-encoding')
    expect(() => act('url_decode', { input: '%' })).toThrow('encoding: invalid percent-encoding')
  })
})

describe('encoding: hex', () => {
  it('round-trips ascii and CJK', () => {
    expect(act('hex_decode', { input: act('hex_encode', { input: 'AB' }) })).toBe('AB')
    expect(act('hex_decode', { input: act('hex_encode', { input: '中文' }) })).toBe('中文')
  })

  it('known vectors', () => {
    expect(act('hex_encode', { input: 'AB' })).toBe('4142')
    expect(act('hex_encode', { input: '' })).toBe('')
  })

  it('rejects odd length and non-hex chars', () => {
    expect(() => act('hex_decode', { input: 'abc' })).toThrow('encoding: invalid hex input')
    expect(() => act('hex_decode', { input: 'zz' })).toThrow('encoding: invalid hex input')
  })

  it('UTF-8 boundary vectors: NUL and newline are legal', () => {
    expect(act('hex_decode', { input: '00' })).toBe('\u0000')
    expect(act('hex_decode', { input: '0a' })).toBe('\n')
    expect(act('hex_decode', { input: 'c3a9' })).toBe('é')
  })

  it('UTF-8 boundary: U+FFFD bytes are legal input', () => {
    expect(act('hex_decode', { input: 'efbfbd' })).toBe('\uFFFD')
  })

  it('UTF-8 boundary: 0xff byte is invalid', () => {
    expect(() => act('hex_decode', { input: '00ff' })).toThrow('encoding: invalid UTF-8 output')
    expect(() => act('hex_decode', { input: 'ff' })).toThrow('encoding: invalid UTF-8 output')
  })
})

describe('encoding: hash', () => {
  it('known digest vectors', () => {
    expect(act('hash', { algorithm: 'md5', input: '' })).toBe('d41d8cd98f00b204e9800998ecf8427e')
    expect(act('hash', { algorithm: 'sha1', input: 'abc' })).toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
    expect(act('hash', { algorithm: 'sha256', input: '' })).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(act('hash', { algorithm: 'sha512', input: 'abc' })).toBe(
      'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a' +
      '2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
    )
  })

  it('rejects unknown algorithm including prototype names', () => {
    expect(() => act('hash', { algorithm: '__proto__', input: 'x' })).toThrow('encoding: unknown algorithm "__proto__"')
    expect(() => act('hash', { algorithm: 'constructor', input: 'x' })).toThrow('encoding: unknown algorithm')
    expect(() => act('hash', { algorithm: 'sha3-256', input: 'x' })).toThrow('encoding: unknown algorithm')
  })

  it('rejects missing parameters', () => {
    expect(() => act('hash', { input: 'x' })).toThrow('encoding: missing required parameter "algorithm"')
    expect(() => act('hash', { algorithm: 'sha256' })).toThrow('encoding: missing required parameter "input"')
  })
})

describe('encoding: uuid', () => {
  it('returns a string (contract) matching v4 format', () => {
    const id = act('uuid')
    expect(typeof id).toBe('string')
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('generates unique values across 100 calls', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 100; i++) seen.add(act('uuid'))
    expect(seen.size).toBe(100)
  })

  it('rejects stray parameters', () => {
    expect(() => act('uuid', { input: 'x' })).toThrow('encoding: uuid takes no parameters')
  })
})

describe('encoding: unicode and limits', () => {
  it('rejects lone surrogates uniformly across actions', () => {
    expect(() => act('base64_encode', { input: '\uD800' })).toThrow('encoding: invalid Unicode (lone surrogate)')
    expect(() => act('url_encode', { input: '\uD800' })).toThrow('encoding: invalid Unicode (lone surrogate)')
    expect(() => act('hash', { algorithm: 'sha256', input: '\uD800' })).toThrow('encoding: invalid Unicode (lone surrogate)')
  })

  it('round-trips NUL byte without truncation', () => {
    expect(act('hex_encode', { input: '\u0000' })).toBe('00')
    expect(act('hex_decode', { input: '00' })).toBe('\u0000')
  })

  it('rejects input over 1 MiB bytes', () => {
    const big = 'a'.repeat(1_000_001) // > 1 MiB UTF-8 bytes
    expect(() => act('base64_encode', { input: big })).toThrow('encoding: input exceeds')
  })

  it('rejects code-injection-shaped input as plain data (no eval)', () => {
    const payload = 'constructor.constructor("return process")()'
    expect(act('base64_decode', { input: act('base64_encode', { input: payload }) })).toBe(payload)
    expect(act('hex_decode', { input: act('hex_encode', { input: payload }) })).toBe(payload)
  })

  it('rejects unknown action', () => {
    expect(() => act('eval')).toThrow('encoding: unknown action "eval"')
  })

  it('rejects missing input for encode actions', () => {
    expect(() => act('base64_encode', {})).toThrow('encoding: missing required parameter "input"')
    expect(() => act('hex_decode', {})).toThrow('encoding: missing required parameter "input"')
  })
})

// ── 审查回归（2026-08-06，dsh-tool-encoding-time-review-report）──

describe('review regressions', () => {
  it('ENC-02: rejects non-canonical base64 (unused bits not zero)', () => {
    expect(() => act('base64_decode', { input: 'Zh==' })).toThrow('encoding: non-canonical base64 input')
    expect(() => act('base64_decode', { input: 'Zm9=' })).toThrow('encoding: non-canonical base64 input')
    expect(() => act('base64url_decode', { input: 'Zh==' })).toThrow('encoding: non-canonical base64 input')
    expect(() => act('base64url_decode', { input: 'Zh' })).toThrow('encoding: non-canonical base64 input')
  })

  it('ENC-02: canonical forms still decode', () => {
    expect(act('base64_decode', { input: 'Zg==' })).toBe('f')
    expect(act('base64_decode', { input: 'Zm8=' })).toBe('fo')
    expect(act('base64_decode', { input: 'Zm9vYmFy' })).toBe('foobar')
  })

  it('ENC-03: input limit constants are documented as MB (1000000 bytes)', () => {
    // 边界行为：1_000_000 字节内合法，超出拒绝
    const ok = 'a'.repeat(1_000_000)
    expect(() => act('base64_encode', { input: ok })).not.toThrow()
    expect(() => act('base64_encode', { input: ok + 'a' })).toThrow('encoding: input exceeds')
  })
})

describe('recheck regressions', () => {
  it('RECHECK-ENC-01: rejects malformed explicit base64url padding', () => {
    expect(() => act('base64url_decode', { input: 'Zg=' })).toThrow('encoding: invalid base64 input')
    expect(act('base64url_decode', { input: 'Zm8=' })).toBe('fo')
  })

  it('RECHECK-ENC-01: complete padding and no padding both decode', () => {
    expect(act('base64url_decode', { input: 'Zg' })).toBe('f')
    expect(act('base64url_decode', { input: 'Zg==' })).toBe('f')
  })
})

describe('audit regressions', () => {
  it('AUDIT-ENC-02: uuid rejects any extra parameter', () => {
    expect(() => act('uuid', { foo: 'bar' })).toThrow('encoding: uuid takes no parameters')
    expect(() => act('uuid', { algoritm: 'sha256' })).toThrow('encoding: uuid takes no parameters')
  })

  it('AUDIT-ENC-03: non-object params rejected with encoding: prefix', () => {
    expect(() => (executeAction as any)('base64_encode', undefined)).toThrow('encoding: parameters must be an object')
    expect(() => (executeAction as any)('hash', null)).toThrow('encoding: parameters must be an object')
    expect(() => (executeAction as any)(undefined, {})).toThrow('encoding: action must be a string')
  })

  it('AUDIT-ENC-04: base64 worst-case estimate matches actual padded length', () => {
    // 0/1/2/3/4 字节边界的实际输出长度
    for (const len of [0, 1, 2, 3, 4, 5]) {
      const input = 'a'.repeat(len)
      const actual = act('base64_encode', { input }).length
      const expected = 4 * Math.ceil(len / 3)
      expect(actual).toBe(expected)
    }
  })
})
