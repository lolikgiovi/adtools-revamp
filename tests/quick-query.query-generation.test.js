import { describe, it, expect, vi } from 'vitest'
import { QueryGenerationService } from '../app/tools/quick-query/services/QueryGenerationService.js'

vi.mock('../app/core/UsageTracker.js', () => ({
  UsageTracker: {
    track: () => {},
    trackEvent: () => {},
    flushSync: () => {},
  },
}))

const buildLowercaseSchema = () => [
  ['id', 'NUMBER', 'No', '', '', 'Yes'],
  ['type', 'VARCHAR2(50)', 'Yes', '', '', ''],
  ['sequence', 'NUMBER', 'Yes', '', '', ''],
  ['created_time', 'DATE', 'Yes', '', '', ''],
  ['created_by', 'VARCHAR2(50)', 'Yes', '', '', ''],
  ['updated_time', 'DATE', 'Yes', '', '', ''],
  ['updated_by', 'VARCHAR2(50)', 'Yes', '', '', ''],
]

const buildUppercaseSchema = () => [
  ['ID', 'NUMBER', 'No', '', '', 'Yes'],
  ['TYPE', 'VARCHAR2(50)', 'Yes', '', '', ''],
  ['SEQUENCE', 'NUMBER', 'Yes', '', '', ''],
  ['CREATED_TIME', 'DATE', 'Yes', '', '', ''],
  ['CREATED_BY', 'VARCHAR2(50)', 'Yes', '', '', ''],
  ['UPDATED_TIME', 'DATE', 'Yes', '', '', ''],
  ['UPDATED_BY', 'VARCHAR2(50)', 'Yes', '', '', ''],
]

describe('QueryGenerationService - reserved words formatting', () => {
  const svc = new QueryGenerationService()

  it('quotes lowercase reserved words and lowers uppercase without quotes', () => {
    expect(svc.formatFieldName('type')).toBe('"type"')
    expect(svc.formatFieldName('sequence')).toBe('"sequence"')
    expect(svc.formatFieldName('TYPE')).toBe('type')
    expect(svc.formatFieldName('SEQUENCE')).toBe('sequence')
  })
})

describe('QueryGenerationService - MERGE generation (lowercase headers)', () => {
  const svc = new QueryGenerationService()
  const schema = buildLowercaseSchema()
  const headers = ['id','type','sequence','created_time','created_by','updated_time','updated_by']
  const row = ['1','menu','10','','', '', 'user1']
  const inputData = [headers, row]

  it('generates MERGE with correct quoting, update excludes created_* and insert includes all fields', () => {
    const sql = svc.generateQuery('my_table', 'merge', schema, inputData, [])

    expect(sql).toContain('SET DEFINE OFF;')

    expect(sql).toContain('USING (SELECT')
    expect(sql).toContain('AS "type"')
    expect(sql).toContain('AS "sequence"')

    expect(sql).toContain('ON (tgt.id = src.id)')

    expect(sql).toContain('WHEN MATCHED THEN UPDATE SET')
    expect(sql).toContain('tgt."type" = src."type"')
    expect(sql).toContain('tgt."sequence" = src."sequence"')
    expect(sql).toContain('tgt.updated_time = src.updated_time')
    expect(sql).toContain('tgt.updated_by = src.updated_by')
    expect(sql).not.toContain('created_time =')
    expect(sql).not.toContain('created_by =')
    

    expect(sql).toContain('WHEN NOT MATCHED THEN INSERT (')
    expect(sql).toContain('id, "type", "sequence", created_time, created_by, updated_time, updated_by')
    expect(sql).toContain('VALUES (src.id, src."type", src."sequence", src.created_time, src.created_by, src.updated_time, src.updated_by)')

    expect(sql).toContain('SELECT * FROM my_table WHERE id IN (1)')
  })
})

describe('QueryGenerationService - MERGE generation (uppercase headers)', () => {
  const svc = new QueryGenerationService()
  const schema = buildUppercaseSchema()
  const headers = ['ID','TYPE','SEQUENCE','CREATED_TIME','CREATED_BY','UPDATED_TIME','UPDATED_BY']
  const row = ['1','menu','10','','', '', 'user1']
  const inputData = [headers, row]

  it('uses unquoted lowercased names for uppercase reserved words', () => {
    const sql = svc.generateQuery('my_table', 'merge', schema, inputData, [])
    expect(sql).toContain('AS type')
    expect(sql).toContain('AS sequence')
    expect(sql).toContain('tgt.type = src.type')
    expect(sql).toContain('tgt.sequence = src.sequence')
    expect(sql).toContain('INSERT (id, type, sequence, created_time, created_by, updated_time, updated_by)')
  })
})

describe('QueryGenerationService - INSERT generation', () => {
  const svc = new QueryGenerationService()
  const schema = buildLowercaseSchema()
  const headers = ['id','type','sequence','created_time','created_by','updated_time','updated_by']
  const row = ['1','menu','10','','', '', 'user1']
  const inputData = [headers, row]

  it('includes all fields and quotes lowercase reserved words', () => {
    const sql = svc.generateQuery('my_table', 'insert', schema, inputData, [])
    expect(sql).toContain('INSERT INTO my_table (id, "type", "sequence", created_time, created_by, updated_time, updated_by)')
    expect(sql).toContain("VALUES (1, 'menu', 10, SYSDATE, 'SYSTEM', SYSDATE, 'USER1')")
  })
})

describe('QueryGenerationService - UPDATE generation', () => {
  const svc = new QueryGenerationService()
  const schema = buildLowercaseSchema()
  const headers = ['id','type','sequence','created_time','created_by','updated_time','updated_by']
  const row1 = ['1','menu','10','','', '', 'user1']
  const row2 = ['2','menu2','20','','', '', 'user2']
  const inputData = [headers, row1, row2]

  it('builds pre/post SELECTs and excludes created_* while including updated_* in SET', () => {
    const sql = svc.generateQuery('my_table', 'update', schema, inputData, [])
    expect(sql).toContain('SELECT')
    expect(sql).toContain('FROM my_table WHERE id IN (1, 2)')

    expect(sql).toContain('UPDATE my_table')
    expect(sql).toContain('SET')
    expect(sql).toContain('"type" =')
    expect(sql).toContain('"sequence" =')
    expect(sql).toContain('updated_time = SYSDATE')
    expect(sql).toContain("updated_by = 'USER1'")
    expect(sql).not.toContain('created_time =')
    expect(sql).not.toContain('created_by =')
    // PK used only in WHERE/ON clauses; not part of SET
  })

  it('throws when PK values are missing', () => {
    const inputMissingPk = [headers, ['', 'x', '1', '', '', '', 'user1']]
    expect(() => svc.generateQuery('my_table', 'update', schema, inputMissingPk, [])).toThrow('Primary key values are required for UPDATE operation.')
  })

  it('throws when no fields to update', () => {
    const inputNoFields = [headers, ['1', '', '', '', '', '', '']]
    expect(() => svc.generateQuery('my_table', 'update', schema, inputNoFields, [])).toThrow('No fields to update')
  })
})

describe('QueryGenerationService - NULL and whitespace handling', () => {
  const svc = new QueryGenerationService()
  const schema = buildLowercaseSchema()
  const headers = ['id','type','sequence','created_time','created_by','updated_time','updated_by']

  it('MERGE: empty nullable cell becomes NULL', () => {
    const row = ['1','menu','', '', '', '', 'user1']
    const sql = svc.generateQuery('my_table', 'merge', schema, [headers, row], [])
    expect(sql).toContain("NULL AS \"sequence\"")
  })

  it('INSERT: empty nullable cell becomes NULL', () => {
    const row = ['1','', '10', '', '', '', 'user1']
    const sql = svc.generateQuery('my_table', 'insert', schema, [headers, row], [])
    expect(sql).toContain("VALUES (1, NULL, 10, SYSDATE, 'SYSTEM', SYSDATE, 'USER1')")
  })

  it('MERGE: whitespace-only input is treated as literal string', () => {
    const row = ['1',' ', '10', '', '', '', 'user1']
    const sql = svc.generateQuery('my_table', 'merge', schema, [headers, row], [])
    expect(sql).toContain("' ' AS \"type\"")
  })

  it('INSERT: whitespace-only input is treated as literal string', () => {
    const row = ['1',' ', '10', '', '', '', 'user1']
    const sql = svc.generateQuery('my_table', 'insert', schema, [headers, row], [])
    expect(sql).toContain("VALUES (1, ' ', 10, SYSDATE, 'SYSTEM', SYSDATE, 'USER1')")
  })
})
