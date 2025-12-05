import { describe, it, expect } from 'vitest'
import {
  splitSqlStatementsSafely,
  calcUtf8Bytes,
  groupBySize,
  groupByQueryCount,
  deriveBaseName,
} from '../app/tools/quick-query/services/SplitService.js'

describe('splitSqlStatementsSafely', () => {
  it('splits basic SQL statements', () => {
    const sql = 'INSERT INTO t1 VALUES (1); INSERT INTO t2 VALUES (2);'
    const result = splitSqlStatementsSafely(sql)
    expect(result).toHaveLength(2)
    expect(result[0]).toBe('INSERT INTO t1 VALUES (1);')
    expect(result[1]).toBe('INSERT INTO t2 VALUES (2);')
  })

  it('handles semicolons inside single quotes', () => {
    const sql = "INSERT INTO t VALUES ('a;b'); INSERT INTO t2 VALUES (1);"
    const result = splitSqlStatementsSafely(sql)
    expect(result).toHaveLength(2)
    expect(result[0]).toContain("'a;b'")
  })

  it('handles semicolons inside double quotes', () => {
    const sql = 'INSERT INTO t VALUES ("a;b"); INSERT INTO t2 VALUES (1);'
    const result = splitSqlStatementsSafely(sql)
    expect(result).toHaveLength(2)
    expect(result[0]).toContain('"a;b"')
  })

  it('handles line comments (--)', () => {
    const sql = 'INSERT INTO t VALUES (1); -- comment\nINSERT INTO t2 VALUES (2);'
    const result = splitSqlStatementsSafely(sql)
    expect(result).toHaveLength(2)
    expect(result[0]).toBe('INSERT INTO t VALUES (1);')
  })

  it('handles block comments (/* */)', () => {
    const sql = 'INSERT INTO t /* comment */ VALUES (1);'
    const result = splitSqlStatementsSafely(sql)
    expect(result).toHaveLength(1)
    expect(result[0]).toContain('/* comment */')
  })

  it('adds missing semicolons to statements', () => {
    const sql = 'INSERT INTO t VALUES (1)'
    const result = splitSqlStatementsSafely(sql)
    expect(result[0]).toBe('INSERT INTO t VALUES (1);')
  })
})

describe('calcUtf8Bytes', () => {
  it('calculates ASCII string bytes correctly', () => {
    expect(calcUtf8Bytes('hello')).toBe(5)
  })

  it('calculates multi-byte characters correctly', () => {
    expect(calcUtf8Bytes('héllo')).toBe(6) // é = 2 bytes
  })

  it('handles empty string', () => {
    expect(calcUtf8Bytes('')).toBe(0)
  })
})

describe('groupBySize', () => {
  const HEADER = 'SET DEFINE OFF;\n'

  it('creates chunks respecting max size', () => {
    const statements = [
      'INSERT INTO t VALUES (1);',
      'INSERT INTO t VALUES (2);',
      'INSERT INTO t VALUES (3);',
    ]
    const chunks = groupBySize(statements, 60, HEADER)
    expect(chunks.length).toBeGreaterThan(1)
  })

  it('each chunk starts with header', () => {
    const statements = ['INSERT INTO t VALUES (1);']
    const chunks = groupBySize(statements, 1000, HEADER)
    expect(chunks[0].startsWith('SET DEFINE OFF;')).toBe(true)
  })

  it('fits all statements in one chunk when size allows', () => {
    const statements = [
      'INSERT INTO t VALUES (1);',
      'INSERT INTO t VALUES (2);',
    ]
    const chunks = groupBySize(statements, 10000, HEADER)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toContain('VALUES (1)')
    expect(chunks[0]).toContain('VALUES (2)')
  })
})

describe('groupByQueryCount', () => {
  const HEADER = 'SET DEFINE OFF;\n'

  it('splits by MERGE/INSERT/UPDATE count', () => {
    const statements = [
      'INSERT INTO t VALUES (1);',
      'INSERT INTO t VALUES (2);',
      'INSERT INTO t VALUES (3);',
      'INSERT INTO t VALUES (4);',
    ]
    const chunks = groupByQueryCount(statements, 2, HEADER)
    expect(chunks).toHaveLength(2)
  })

  it('ignores SELECT statements in count', () => {
    const statements = [
      'SELECT * FROM t;',
      'INSERT INTO t VALUES (1);',
      'SELECT * FROM t2;',
      'INSERT INTO t VALUES (2);',
    ]
    const chunks = groupByQueryCount(statements, 2, HEADER)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toContain('SELECT * FROM t;')
  })

  it('each chunk starts with header', () => {
    const statements = ['INSERT INTO t VALUES (1);']
    const chunks = groupByQueryCount(statements, 100, HEADER)
    expect(chunks[0].startsWith('SET DEFINE OFF;')).toBe(true)
  })

  it('counts MERGE statements', () => {
    const statements = [
      'MERGE INTO t USING s ON (t.id = s.id) WHEN MATCHED THEN UPDATE SET t.x = s.x;',
      'MERGE INTO t2 USING s2 ON (t2.id = s2.id) WHEN MATCHED THEN UPDATE SET t2.x = s2.x;',
      'MERGE INTO t3 USING s3 ON (t3.id = s3.id) WHEN MATCHED THEN UPDATE SET t3.x = s3.x;',
    ]
    const chunks = groupByQueryCount(statements, 2, HEADER)
    expect(chunks).toHaveLength(2)
  })

  it('counts UPDATE statements', () => {
    const statements = [
      'UPDATE t SET x = 1;',
      'UPDATE t SET x = 2;',
      'UPDATE t SET x = 3;',
    ]
    const chunks = groupByQueryCount(statements, 2, HEADER)
    expect(chunks).toHaveLength(2)
  })
})

describe('deriveBaseName', () => {
  it('extracts table name from INTO clause', () => {
    const chunk = 'SET DEFINE OFF;\nINSERT INTO SCHEMA_NAME.TABLE_NAME VALUES (1);'
    const baseName = deriveBaseName(chunk, 0)
    expect(baseName).toBe('SCHEMA_NAME.TABLE_NAME')
  })

  it('extracts table name from MERGE INTO', () => {
    const chunk = 'SET DEFINE OFF;\nMERGE INTO CFG.APP_CONFIG USING ...;'
    const baseName = deriveBaseName(chunk, 0)
    expect(baseName).toBe('CFG.APP_CONFIG')
  })

  it('uses fallback when no INTO clause', () => {
    const chunk = 'SET DEFINE OFF;\nSELECT * FROM t;'
    const baseName = deriveBaseName(chunk, 0, 'MY_TABLE')
    expect(baseName).toBe('MY_TABLE')
  })

  it('returns default when no INTO clause and no fallback', () => {
    const chunk = 'SET DEFINE OFF;\nSELECT * FROM t;'
    const baseName = deriveBaseName(chunk, 0)
    expect(baseName).toBe('CHUNK_1')
  })
})
