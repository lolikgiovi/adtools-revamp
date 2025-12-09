import { describe, it, expect } from 'vitest'
import {
  splitSqlStatementsSafely,
  calcUtf8Bytes,
  groupBySize,
  groupByQueryCount,
  deriveBaseName,
} from '../app/tools/quick-query/services/SplitService.js'

describe('splitSqlStatementsSafely - INSERT statements', () => {
  it('splits basic INSERT statements', () => {
    const sql = 'INSERT INTO t1 VALUES (1); INSERT INTO t2 VALUES (2);'
    const result = splitSqlStatementsSafely(sql)
    expect(result).toHaveLength(2)
    expect(result[0]).toBe('INSERT INTO t1 VALUES (1);')
    expect(result[1]).toBe('INSERT INTO t2 VALUES (2);')
  })

  it('handles multi-row INSERT statements', () => {
    const sql = `INSERT INTO users (id, name) VALUES 
      (1, 'Alice'),
      (2, 'Bob'),
      (3, 'Charlie');
    INSERT INTO products VALUES (1, 'Laptop');`
    const result = splitSqlStatementsSafely(sql)
    expect(result).toHaveLength(2)
    expect(result[0]).toContain('Alice')
    expect(result[0]).toContain('Bob')
    expect(result[0]).toContain('Charlie')
    expect(result[1]).toContain('Laptop')
  })

  it('handles INSERT with subquery', () => {
    const sql = `INSERT INTO archive SELECT * FROM users WHERE created < '2020-01-01';`
    const result = splitSqlStatementsSafely(sql)
    expect(result).toHaveLength(1)
    expect(result[0]).toContain('SELECT * FROM users')
  })

  it('handles INSERT with semicolons in string values', () => {
    const sql = "INSERT INTO t VALUES ('a;b;c'); INSERT INTO t2 VALUES (1);"
    const result = splitSqlStatementsSafely(sql)
    expect(result).toHaveLength(2)
    expect(result[0]).toContain("'a;b;c'")
  })

  it('handles INSERT with escaped quotes', () => {
    const sql = "INSERT INTO t VALUES ('don''t'); INSERT INTO t2 VALUES ('can''t');"
    const result = splitSqlStatementsSafely(sql)
    expect(result).toHaveLength(2)
    expect(result[0]).toContain("don''t")
    expect(result[1]).toContain("can''t")
  })

  it('handles INSERT with NULL values', () => {
    const sql = 'INSERT INTO t VALUES (NULL, 123, NULL);'
    const result = splitSqlStatementsSafely(sql)
    expect(result).toHaveLength(1)
    expect(result[0]).toContain('NULL')
  })

  it('handles INSERT with TO_DATE functions', () => {
    const sql = "INSERT INTO events VALUES (1, TO_DATE('2024-01-01', 'YYYY-MM-DD'));"
    const result = splitSqlStatementsSafely(sql)
    expect(result).toHaveLength(1)
    expect(result[0]).toContain('TO_DATE')
  })

  it('handles INSERT with complex nested parentheses', () => {
    const sql = "INSERT INTO t VALUES ((SELECT MAX(id) FROM t2), 'test');"
    const result = splitSqlStatementsSafely(sql)
    expect(result).toHaveLength(1)
    expect(result[0]).toContain('SELECT MAX(id)')
  })
})

describe('splitSqlStatementsSafely - MERGE statements', () => {
  it('splits basic MERGE statements', () => {
    const sql = `MERGE INTO target t USING source s ON (t.id = s.id) 
      WHEN MATCHED THEN UPDATE SET t.val = s.val;
    MERGE INTO target2 t USING source2 s ON (t.id = s.id) 
      WHEN MATCHED THEN UPDATE SET t.val = s.val;`
    const result = splitSqlStatementsSafely(sql)
    expect(result).toHaveLength(2)
    expect(result[0]).toContain('target')
    expect(result[1]).toContain('target2')
  })

  it('handles MERGE with WHEN MATCHED and WHEN NOT MATCHED', () => {
    const sql = `MERGE INTO inventory i USING shipments s ON (i.product_id = s.product_id)
      WHEN MATCHED THEN UPDATE SET i.quantity = i.quantity + s.quantity
      WHEN NOT MATCHED THEN INSERT (product_id, quantity) VALUES (s.product_id, s.quantity);`
    const result = splitSqlStatementsSafely(sql)
    expect(result).toHaveLength(1)
    expect(result[0]).toContain('WHEN MATCHED')
    expect(result[0]).toContain('WHEN NOT MATCHED')
  })

  it('handles MERGE with complex USING clause', () => {
    const sql = `MERGE INTO users u USING (
      SELECT id, name, email FROM staging_users WHERE active = 1
    ) s ON (u.id = s.id)
    WHEN MATCHED THEN UPDATE SET u.email = s.email;`
    const result = splitSqlStatementsSafely(sql)
    expect(result).toHaveLength(1)
    expect(result[0]).toContain('staging_users')
  })

  it('handles MERGE with DELETE clause', () => {
    const sql = `MERGE INTO products p USING updates u ON (p.id = u.id)
      WHEN MATCHED AND u.discontinued = 1 THEN DELETE
      WHEN MATCHED THEN UPDATE SET p.price = u.price;`
    const result = splitSqlStatementsSafely(sql)
    expect(result).toHaveLength(1)
    expect(result[0]).toContain('DELETE')
  })

  it('handles MERGE with schema-qualified names', () => {
    const sql = `MERGE INTO SCHEMA1.TABLE1 t USING SCHEMA2.TABLE2 s ON (t.id = s.id)
      WHEN MATCHED THEN UPDATE SET t.value = s.value;`
    const result = splitSqlStatementsSafely(sql)
    expect(result).toHaveLength(1)
    expect(result[0]).toContain('SCHEMA1.TABLE1')
    expect(result[0]).toContain('SCHEMA2.TABLE2')
  })

  it('handles MERGE with string literals containing ON', () => {
    const sql = `MERGE INTO t USING s ON (t.id = s.id)
      WHEN MATCHED THEN UPDATE SET t.status = 'ON HOLD';`
    const result = splitSqlStatementsSafely(sql)
    expect(result).toHaveLength(1)
    expect(result[0]).toContain("'ON HOLD'")
  })

  it('handles MERGE with semicolons in values', () => {
    const sql = `MERGE INTO config c USING new_config n ON (c.key = n.key)
      WHEN MATCHED THEN UPDATE SET c.value = 'path/to;file;';`
    const result = splitSqlStatementsSafely(sql)
    expect(result).toHaveLength(1)
    expect(result[0]).toContain("'path/to;file;'")
  })
})

describe('splitSqlStatementsSafely - Mixed statements', () => {
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

  it('handles mix of INSERT and MERGE', () => {
    const sql = `INSERT INTO log VALUES (1, 'start');
    MERGE INTO users u USING temp t ON (u.id = t.id)
      WHEN MATCHED THEN UPDATE SET u.name = t.name;
    INSERT INTO log VALUES (2, 'end');`
    const result = splitSqlStatementsSafely(sql)
    expect(result).toHaveLength(3)
    expect(result[0]).toContain('log')
    expect(result[1]).toContain('MERGE')
    expect(result[2]).toContain('log')
  })

  it('preserves statement format with newlines', () => {
    const sql = `INSERT INTO users 
      (id, name, email) 
    VALUES 
      (1, 'Alice', 'alice@example.com');`
    const result = splitSqlStatementsSafely(sql)
    expect(result).toHaveLength(1)
    expect(result[0]).toContain('Alice')
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

  it('handles Chinese characters (3 bytes each)', () => {
    expect(calcUtf8Bytes('你好')).toBe(6) // 2 chars * 3 bytes
  })

  it('handles emoji (4 bytes)', () => {
    expect(calcUtf8Bytes('😀')).toBe(4)
  })
})

describe('groupBySize - INSERT statements', () => {
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

  it('handles large multi-row INSERT statements', () => {
    const statements = [
      `INSERT INTO users VALUES (1, 'Alice', 'alice@example.com'), (2, 'Bob', 'bob@example.com');`,
      `INSERT INTO products VALUES (1, 'Laptop', 999.99);`
    ]
    const chunks = groupBySize(statements, 200, HEADER)
    expect(chunks.length).toBeGreaterThan(0)
    chunks.forEach(chunk => {
      expect(chunk.startsWith('SET DEFINE OFF;')).toBe(true)
    })
  })
})

describe('groupBySize - MERGE statements', () => {
  const HEADER = 'SET DEFINE OFF;\n'

  it('splits large MERGE statements across chunks', () => {
    const statements = [
      `MERGE INTO t1 USING s1 ON (t1.id = s1.id) WHEN MATCHED THEN UPDATE SET t1.val = s1.val WHEN NOT MATCHED THEN INSERT VALUES (s1.id, s1.val);`,
      `MERGE INTO t2 USING s2 ON (t2.id = s2.id) WHEN MATCHED THEN UPDATE SET t2.val = s2.val;`,
    ]
    const chunks = groupBySize(statements, 150, HEADER)
    expect(chunks.length).toBeGreaterThan(1)
  })

  it('keeps complex MERGE in single chunk if size allows', () => {
    const statements = [
      `MERGE INTO inventory i USING shipments s ON (i.product_id = s.product_id) WHEN MATCHED THEN UPDATE SET i.quantity = i.quantity + s.quantity WHEN NOT MATCHED THEN INSERT (product_id, quantity) VALUES (s.product_id, s.quantity);`
    ]
    const chunks = groupBySize(statements, 5000, HEADER)
    expect(chunks).toHaveLength(1)
  })
})

describe('groupByQueryCount - INSERT statements', () => {
  const HEADER = 'SET DEFINE OFF;\n'

  it('splits by INSERT count', () => {
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

  it('handles multi-row INSERT as single statement', () => {
    const statements = [
      "INSERT INTO users VALUES (1, 'Alice'), (2, 'Bob'), (3, 'Charlie');",
      "INSERT INTO products VALUES (1, 'Laptop');",
      "INSERT INTO orders VALUES (1, 100);"
    ]
    const chunks = groupByQueryCount(statements, 2, HEADER)
    expect(chunks).toHaveLength(2)
  })
})

describe('groupByQueryCount - MERGE statements', () => {
  const HEADER = 'SET DEFINE OFF;\n'

  it('counts MERGE statements', () => {
    const statements = [
      'MERGE INTO t USING s ON (t.id = s.id) WHEN MATCHED THEN UPDATE SET t.x = s.x;',
      'MERGE INTO t2 USING s2 ON (t2.id = s2.id) WHEN MATCHED THEN UPDATE SET t2.x = s2.x;',
      'MERGE INTO t3 USING s3 ON (t3.id = s3.id) WHEN MATCHED THEN UPDATE SET t3.x = s3.x;',
    ]
    const chunks = groupByQueryCount(statements, 2, HEADER)
    expect(chunks).toHaveLength(2)
  })

  it('counts complex MERGE with INSERT and DELETE', () => {
    const statements = [
      `MERGE INTO inventory USING shipments ON (inventory.id = shipments.id) 
       WHEN MATCHED AND shipments.discontinued = 1 THEN DELETE
       WHEN MATCHED THEN UPDATE SET inventory.qty = shipments.qty
       WHEN NOT MATCHED THEN INSERT VALUES (shipments.id, shipments.qty);`,
      `MERGE INTO products USING updates ON (products.id = updates.id)
       WHEN MATCHED THEN UPDATE SET products.price = updates.price;`,
    ]
    const chunks = groupByQueryCount(statements, 1, HEADER)
    expect(chunks).toHaveLength(2)
  })

  it('mixes INSERT, MERGE, and UPDATE in count', () => {
    const statements = [
      'INSERT INTO log VALUES (1);',
      'MERGE INTO users USING temp ON (users.id = temp.id) WHEN MATCHED THEN UPDATE SET users.name = temp.name;',
      'UPDATE config SET value = 1 WHERE key = \'test\';',
      'INSERT INTO log VALUES (2);',
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

describe('deriveBaseName - INSERT statements', () => {
  it('extracts table name from simple INSERT', () => {
    const chunk = 'SET DEFINE OFF;\nINSERT INTO SCHEMA_NAME.TABLE_NAME VALUES (1);'
    const baseName = deriveBaseName(chunk, 0)
    expect(baseName).toBe('SCHEMA_NAME.TABLE_NAME')
  })

  it('returns fallback for INSERT without schema qualifier', () => {
    const chunk = 'SET DEFINE OFF;\nINSERT INTO users (id, name, email) VALUES (1, \'Alice\', \'alice@ex.com\');'
    const baseName = deriveBaseName(chunk, 0, 'MY_SCHEMA.USERS')
    expect(baseName).toBe('MY_SCHEMA.USERS')
  })

  it('returns default for INSERT without schema qualifier and no fallback', () => {
    const chunk = `SET DEFINE OFF;\nINSERT INTO products VALUES (1, 'A'), (2, 'B'), (3, 'C');`
    const baseName = deriveBaseName(chunk, 0)
    expect(baseName).toBe('CHUNK_1')
  })
})

describe('deriveBaseName - MERGE statements', () => {
  it('extracts table name from MERGE INTO', () => {
    const chunk = 'SET DEFINE OFF;\nMERGE INTO CFG.APP_CONFIG USING ...;'
    const baseName = deriveBaseName(chunk, 0)
    expect(baseName).toBe('CFG.APP_CONFIG')
  })

  it('returns default for MERGE without schema qualifier', () => {
    const chunk = 'SET DEFINE OFF;\nMERGE INTO inventory i USING shipments s ON (i.id = s.id) ...;'
    const baseName = deriveBaseName(chunk, 0)
    expect(baseName).toBe('CHUNK_1')
  })

  it('extracts schema-qualified name from MERGE', () => {
    const chunk = 'SET DEFINE OFF;\nMERGE INTO PROD_SCHEMA.USERS USING TEMP_SCHEMA.USER_UPDATES ...;'
    const baseName = deriveBaseName(chunk, 0)
    expect(baseName).toBe('PROD_SCHEMA.USERS')
  })
})

describe('deriveBaseName - Edge cases', () => {
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

  it('handles chunk with only comments', () => {
    const chunk = 'SET DEFINE OFF;\n-- Just a comment\n/* Another comment */'
    const baseName = deriveBaseName(chunk, 5)
    expect(baseName).toBe('CHUNK_6')
  })
})
