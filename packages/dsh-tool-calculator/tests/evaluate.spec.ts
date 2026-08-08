import { describe, expect, it } from 'vitest'
import { evaluate } from '../src/evaluate.ts'

describe('evaluate', () => {
  // ── 功能用例 ──

  it('evaluates a simple integer expression', () => {
    expect(evaluate('15 + 27')).toBe(42)
  })

  it('respects operator precedence (multiplication before addition)', () => {
    expect(evaluate('2 + 3 * 4')).toBe(14)
  })

  it('handles parentheses', () => {
    expect(evaluate('(2 + 3) * 4')).toBe(20)
  })

  it('supports exponentiation (right-associative)', () => {
    expect(evaluate('2 ** 3 ** 2')).toBe(512) // 2 ** 9
  })

  it('evaluates a built-in function (sqrt)', () => {
    expect(evaluate('sqrt(9)')).toBe(3)
  })

  it('evaluates multi-argument functions (pow, max, min)', () => {
    expect(evaluate('pow(2, 3)')).toBe(8)
    expect(evaluate('max(2, 5, 1)')).toBe(5)
    expect(evaluate('min(2, 5, 1)')).toBe(1)
  })

  it('resolves constants (PI, E)', () => {
    expect(evaluate('PI')).toBeCloseTo(Math.PI, 10)
    expect(evaluate('E')).toBeCloseTo(Math.E, 10)
  })

  it('handles unary minus and plus', () => {
    expect(evaluate('-5 + 3')).toBe(-2)
    expect(evaluate('+5 + 3')).toBe(8)
    expect(evaluate('-(-5)')).toBe(5)
  })

  it('rejects expressions with trailing tokens', () => {
    expect(() => evaluate('1 2')).toThrow('Unexpected token')
  })

  it('rejects missing closing parenthesis', () => {
    expect(() => evaluate('(2 + 3')).toThrow('Missing closing parenthesis')
  })

  it('rejects unknown identifiers', () => {
    expect(() => evaluate('foo(1)')).toThrow('Unknown identifier')
  })

  // ── 攻击载荷（安全验证）──

  it('rejects constructor.constructor escape', () => {
    expect(() => evaluate('constructor.constructor("return 1")()')).toThrow()
  })

  it('rejects process global access', () => {
    expect(() => evaluate('process.exit(0)')).toThrow()
  })

  it('rejects globalThis access', () => {
    expect(() => evaluate('globalThis')).toThrow()
  })

  it('rejects quote injection', () => {
    expect(() => evaluate("'hello'")).toThrow('Invalid character')
  })

  it('rejects double-quote injection', () => {
    expect(() => evaluate('"hello"')).toThrow('Invalid character')
  })

  it('rejects semicolon-separated statements (1;2)', () => {
    expect(() => evaluate('1;2')).toThrow('Invalid character')
  })

  it('rejects String.fromCharCode trick', () => {
    // `.` is not a valid token — caught by the tokenizer before reaching identifiers
    expect(() => evaluate('String.fromCharCode(114)')).toThrow()
  })

  it('rejects eval-like patterns', () => {
    // `"` is not a valid token — caught by the tokenizer
    expect(() => evaluate('eval("1+1")')).toThrow()
  })

  it('rejects Function constructor pattern', () => {
    // `"` is not a valid token — caught by the tokenizer
    expect(() => evaluate('Function("return 1")()')).toThrow()
  })

  it('rejects __proto__ access', () => {
    expect(() => evaluate('({}).__proto__')).toThrow('Invalid character')
  })

  it('rejects expressions exceeding the 500-character limit', () => {
    const long = '1+' + '1+'.repeat(250) + '1'
    expect(long.length).toBeGreaterThan(500)
    expect(() => evaluate(long)).toThrow('Expression too long')
  })
})

// ── 审查回归（2026-08-06 review report）──

describe('review regressions', () => {
  it('CALC-01: rejects Object.prototype inherited names (own-property whitelist)', () => {
    for (const name of ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf']) {
      expect(() => evaluate(name)).toThrow('Unknown identifier')
    }
  })

  it('CALC-01: inherited names with call syntax are rejected as identifiers', () => {
    expect(() => evaluate('constructor(1)')).toThrow('Unknown identifier')
    expect(() => evaluate('toString(1)')).toThrow('Unknown identifier')
  })

  it('CALC-02: rejects wrong argument counts', () => {
    expect(() => evaluate('sqrt(9, 1)')).toThrow('argument count')
    expect(() => evaluate('pow(2)')).toThrow('argument count')
    expect(() => evaluate('pow(2, 3, 4)')).toThrow('argument count')
    expect(() => evaluate('sin(1, 2, 3)')).toThrow('argument count')
    expect(() => evaluate('abs()')).toThrow('argument count')
  })

  it('CALC-02: variadic max/min still accept multiple args', () => {
    expect(evaluate('max(1, 2, 3)')).toBe(3)
    expect(evaluate('min(4, 2, 9)')).toBe(2)
  })

  it('CALC-05: rejects non-string input at the pure-function boundary', () => {
    expect(() => evaluate(undefined as unknown as string)).toThrow('calculator: expression must be a string')
    expect(() => evaluate(42 as unknown as string)).toThrow('calculator: expression must be a string')
  })

  it('CALC-06: scientific notation gets a dedicated error', () => {
    expect(() => evaluate('1e5')).toThrow('Scientific notation is not supported')
    expect(() => evaluate('1e-5')).toThrow('Scientific notation is not supported')
    expect(() => evaluate('6.02e23')).toThrow('Scientific notation is not supported')
    expect(() => evaluate('1E+3')).toThrow('Scientific notation is not supported')
    expect(() => evaluate('1e')).toThrow('Scientific notation is not supported')
  })

  it('boundary: empty expression rejects', () => {
    expect(() => evaluate('')).toThrow()
  })
})
