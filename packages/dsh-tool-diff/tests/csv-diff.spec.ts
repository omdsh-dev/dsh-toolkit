import { describe, expect, it } from 'vitest'
import { parseCsv, csvDiff } from '../src/csv-diff.ts'

const BASE = 'id,name,status\n1,Alice,active\n2,Bob,inactive\n3,Carol,active'

describe('parseCsv: RFC 4180', () => {
  it('基本网格', () => {
    const r = parseCsv('a,b\n1,2')
    expect(r.header).toEqual(['a', 'b'])
    expect(r.rows.map(x => x.cells)).toEqual([['1', '2']])
  })

  it('引号内逗号', () => {
    const r = parseCsv('a,b\n"x,y",z')
    expect(r.rows[0]!.cells).toEqual(['x,y', 'z'])
  })

  it('引号内换行', () => {
    const r = parseCsv('a,b\n"line1\nline2",z')
    expect(r.rows[0]!.cells).toEqual(['line1\nline2', 'z'])
  })

  it('CRLF 与 BOM', () => {
    const r = parseCsv('\uFEFFa,b\r\n1,2\r\n')
    expect(r.header).toEqual(['a', 'b'])
    expect(r.rows[0]!.cells).toEqual(['1', '2'])
  })

  it('未闭合引号报错', () => {
    expect(() => parseCsv('a,b\n"oops,z')).toThrow(/unterminated/)
  })

  it('自定义分隔符（tab）', () => {
    const r = parseCsv('a\tb\n1\t2', '\t')
    expect(r.rows[0]!.cells).toEqual(['1', '2'])
  })

  it('单列数据（无逗号）', () => {
    const r = parseCsv('a\nb\nc')
    expect(r.header).toEqual(['a'])
    expect(r.rows.map(x => x.cells)).toEqual([['b'], ['c']])
  })
})

describe('csvDiff: keyed 模式', () => {
  it('主键行新增/删除/修改', () => {
    const after = 'id,name,status\n1,Alice,active\n4,Dana,active'
    const r = csvDiff(BASE, after, { key: 'id' })
    expect(r.mode).toBe('keyed')
    expect(r.key).toBe('id')
    expect(r.equal).toBe(false)
    expect(r.removedRows).toEqual([
      { id: '2', name: 'Bob', status: 'inactive' },
      { id: '3', name: 'Carol', status: 'active' },
    ])
    expect(r.addedRows).toEqual([{ id: '4', name: 'Dana', status: 'active' }])
    expect(r.changedRows).toEqual([])
  })

  it('行修改给出列级变更', () => {
    const after = 'id,name,status\n1,Alice,paused\n2,Bob,inactive\n3,Carol,active'
    const r = csvDiff(BASE, after, { key: 'id' })
    expect(r.changedRows).toEqual([
      { key: '1', changes: [{ column: 'status', before: 'active', after: 'paused' }] },
    ])
  })

  it('主键 1-based 索引', () => {
    const after = 'id,name,status\n1,Alice,active\n2,Bob,inactive\n4,Dana,active'
    const r = csvDiff(BASE, after, { key: '1' })
    expect(r.key).toBe('id')
    expect(r.addedRows).toHaveLength(1)
  })

  it('key 列名不存在报错', () => {
    expect(() => csvDiff(BASE, BASE, { key: 'nope' })).toThrow(/not found/)
  })

  it('重复 key 不静默覆盖', () => {
    const dup = 'id,name\n1,Alice\n1,Alicia\n2,Bob'
    const r = csvDiff('id,name\n1,Alice\n2,Bob', dup, { key: 'id' })
    expect(r.duplicateKeys).toEqual(['1'])
    expect(r.equal).toBe(false)
  })

  it('空 key 值处理（不混淆缺失）', () => {
    const a = 'id,name\n,empty\n1,one'
    const b = 'id,name\n,empty\n1,one'
    const r = csvDiff(a, b, { key: 'id' })
    expect(r.equal).toBe(true)
  })

  it('行顺序变化不产生变化', () => {
    const shuffled = 'id,name,status\n3,Carol,active\n1,Alice,active\n2,Bob,inactive'
    const r = csvDiff(BASE, shuffled, { key: 'id' })
    expect(r.equal).toBe(true)
  })

  it('列新增/删除单独报告', () => {
    const after = 'id,name,status,age\n1,Alice,active,30\n2,Bob,inactive,40\n3,Carol,active,50'
    const r = csvDiff(BASE, after, { key: 'id' })
    expect(r.addedColumns).toEqual(['age'])
    expect(r.removedColumns).toEqual([])
    const r2 = csvDiff(after, BASE, { key: 'id' })
    expect(r2.removedColumns).toEqual(['age'])
  })

  it('列数不一致（行对象缺失列 → null）', () => {
    const after = 'id,name\n1,Alice\n2,Bob\n3,Carol'
    const r = csvDiff(BASE, after, { key: 'id' })
    expect(r.equal).toBe(false)
    expect(r.removedColumns).toEqual(['status'])
    expect(r.changedRows).toHaveLength(3)
  })

  it('ignoreCase / ignoreWhitespace 生效', () => {
    const after = 'id,name,status\n1, alice ,active\n2,Bob,inactive\n3,Carol,active'
    const r = csvDiff(BASE, after, { key: 'id', ignoreCase: true, ignoreWhitespace: true })
    expect(r.changedRows).toEqual([])
  })
})

describe('csvDiff: positional 模式', () => {
  it('无 key → 按数据行号比较', () => {
    const r = csvDiff('a\n1\n2', 'a\n1\n3')
    expect(r.mode).toBe('positional')
    expect(r.changedRows).toEqual([
      { key: '2', changes: [{ column: 'column1', before: '2', after: '3' }] },
    ])
  })

  it('行增删按位置报告', () => {
    const r = csvDiff('a\n1\n2', 'a\n1')
    expect(r.mode).toBe('positional')
    expect(r.removedRows).toEqual([{ row: '2', cells: ['2'] }])
  })

  it('完全一致 → equal', () => {
    const r = csvDiff('a\n1', 'a\n1')
    expect(r.equal).toBe(true)
  })
})
