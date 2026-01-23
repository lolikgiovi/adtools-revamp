import { describe, it, expect, vi } from 'vitest'
import { QueryGenerationService } from '../services/QueryGenerationService.js'

vi.mock('../../../core/UsageTracker.js', () => ({
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

describe('QueryGenerationService - Running number PK SELECT generation', () => {
  const svc = new QueryGenerationService()
  const schema = buildLowercaseSchema()
  const headers = ['id','type','sequence','created_time','created_by','updated_time','updated_by']

  it('uses FETCH FIRST N ROWS when PK is a running number (max)', () => {
    // When user enters "max" for the PK, it generates a subquery like (SELECT NVL(MAX(id)+1, 1) FROM table)
    // The SELECT statement should use FETCH FIRST instead of WHERE IN with the subquery
    const row = ['max','menu','10','','', '', 'user1']
    const sql = svc.generateQuery('my_table', 'merge', schema, [headers, row], [])

    // Should NOT contain the nonsensical WHERE IN with subquery
    expect(sql).not.toContain('WHERE id IN ((SELECT NVL(MAX')

    // Should contain FETCH FIRST approach
    expect(sql).toContain('SELECT * FROM my_table ORDER BY updated_time DESC FETCH FIRST 1 ROWS ONLY')
  })

  it('uses FETCH FIRST with correct row count for multiple rows', () => {
    const row1 = ['max','menu1','10','','', '', 'user1']
    const row2 = ['max','menu2','20','','', '', 'user2']
    const row3 = ['max','menu3','30','','', '', 'user3']
    const sql = svc.generateQuery('my_table', 'merge', schema, [headers, row1, row2, row3], [])

    // Should use FETCH FIRST 3 for 3 rows
    expect(sql).toContain('SELECT * FROM my_table ORDER BY updated_time DESC FETCH FIRST 3 ROWS ONLY')
  })

  it('uses WHERE IN when PK is a regular value (not running number)', () => {
    const row = ['123','menu','10','','', '', 'user1']
    const sql = svc.generateQuery('my_table', 'merge', schema, [headers, row], [])

    // Should use regular WHERE IN approach
    expect(sql).toContain('SELECT * FROM my_table WHERE id IN (123)')
    expect(sql).not.toContain('FETCH FIRST')
  })
})

// =============================================================================
// NEW TESTS: SQL Injection Prevention & Identifier Validation
// =============================================================================

describe('QueryGenerationService - validateOracleIdentifier', () => {
  const svc = new QueryGenerationService()

  describe('valid identifiers', () => {
    it('accepts valid simple identifier', () => {
      expect(svc.validateOracleIdentifier('MY_TABLE', 'table name')).toBe(true)
      expect(svc.validateOracleIdentifier('column1', 'column name')).toBe(true)
    })

    it('accepts valid qualified identifier (schema.table)', () => {
      expect(svc.validateOracleIdentifier('SCHEMA.TABLE', 'table name')).toBe(true)
      expect(svc.validateOracleIdentifier('myschema.mytable', 'table name')).toBe(true)
    })

    it('accepts identifiers with $, #', () => {
      expect(svc.validateOracleIdentifier('TABLE$1', 'table name')).toBe(true)
      expect(svc.validateOracleIdentifier('COL#2', 'column name')).toBe(true)
      expect(svc.validateOracleIdentifier('MY$TABLE#1', 'table name')).toBe(true)
    })

    it('accepts identifiers with underscores in the middle', () => {
      expect(svc.validateOracleIdentifier('MY_TABLE_NAME', 'table name')).toBe(true)
      expect(svc.validateOracleIdentifier('A_B_C', 'table name')).toBe(true)
    })
  })

  describe('null/empty/whitespace rejection', () => {
    it('rejects null', () => {
      expect(() => svc.validateOracleIdentifier(null, 'table name')).toThrow('must be a non-empty string')
    })

    it('rejects undefined', () => {
      expect(() => svc.validateOracleIdentifier(undefined, 'table name')).toThrow('must be a non-empty string')
    })

    it('rejects empty string', () => {
      expect(() => svc.validateOracleIdentifier('', 'table name')).toThrow('must be a non-empty string')
    })

    it('rejects whitespace-only input', () => {
      expect(() => svc.validateOracleIdentifier('   ', 'table name')).toThrow('cannot be empty')
    })
  })

  describe('length validation', () => {
    it('rejects identifiers exceeding 128 characters', () => {
      const longName = 'A' + 'B'.repeat(128)
      expect(() => svc.validateOracleIdentifier(longName, 'table name')).toThrow('exceeds maximum length of 128 characters')
    })

    it('accepts identifiers at exactly 128 characters', () => {
      const exactName = 'A' + 'B'.repeat(127)
      expect(svc.validateOracleIdentifier(exactName, 'table name')).toBe(true)
    })
  })

  describe('SQL injection prevention', () => {
    it('rejects semicolon', () => {
      expect(() => svc.validateOracleIdentifier('TABLE; DROP TABLE users', 'table name')).toThrow('contains forbidden characters')
    })

    it('rejects single quotes', () => {
      expect(() => svc.validateOracleIdentifier("TABLE'--", 'table name')).toThrow('contains forbidden characters')
    })

    it('rejects double quotes', () => {
      expect(() => svc.validateOracleIdentifier('TABLE"test', 'table name')).toThrow('contains forbidden characters')
    })

    it('rejects backslash', () => {
      expect(() => svc.validateOracleIdentifier('TABLE\\test', 'table name')).toThrow('contains forbidden characters')
    })

    it('rejects backtick', () => {
      expect(() => svc.validateOracleIdentifier('TABLE`test', 'table name')).toThrow('contains forbidden characters')
    })

    it('rejects newlines', () => {
      expect(() => svc.validateOracleIdentifier('TABLE\ntest', 'table name')).toThrow('contains forbidden characters')
    })

    it('rejects carriage return', () => {
      expect(() => svc.validateOracleIdentifier('TABLE\rtest', 'table name')).toThrow('contains forbidden characters')
    })

    it('rejects tabs', () => {
      expect(() => svc.validateOracleIdentifier('TABLE\ttest', 'table name')).toThrow('contains forbidden characters')
    })
  })

  describe('identifier format validation', () => {
    it('rejects identifiers starting with a number', () => {
      expect(() => svc.validateOracleIdentifier('123TABLE', 'table name')).toThrow('must start with a letter')
    })

    it('rejects identifiers starting with underscore', () => {
      expect(() => svc.validateOracleIdentifier('_TABLE', 'table name')).toThrow('must start with a letter')
    })

    it('rejects identifiers with spaces', () => {
      expect(() => svc.validateOracleIdentifier('MY TABLE', 'table name')).toThrow('must start with a letter')
    })

    it('rejects identifiers with special characters', () => {
      expect(() => svc.validateOracleIdentifier('TABLE@NAME', 'table name')).toThrow('must start with a letter')
      expect(() => svc.validateOracleIdentifier('TABLE!NAME', 'table name')).toThrow('must start with a letter')
    })
  })

  describe('qualified name validation', () => {
    it('rejects multiple dots', () => {
      expect(() => svc.validateOracleIdentifier('A.B.C', 'table name')).toThrow('only one dot allowed')
    })

    it('rejects empty schema part', () => {
      expect(() => svc.validateOracleIdentifier('.TABLE', 'table name')).toThrow('cannot be empty')
    })

    it('rejects empty table part', () => {
      expect(() => svc.validateOracleIdentifier('SCHEMA.', 'table name')).toThrow('cannot be empty')
    })

    it('rejects invalid schema name in qualified identifier', () => {
      expect(() => svc.validateOracleIdentifier('123SCHEMA.TABLE', 'table name')).toThrow('must start with a letter')
    })

    it('rejects invalid table name in qualified identifier', () => {
      expect(() => svc.validateOracleIdentifier('SCHEMA.123TABLE', 'table name')).toThrow('must start with a letter')
    })
  })
})

// =============================================================================
// NEW TESTS: Composite Primary Key WHERE Clause
// =============================================================================

describe('QueryGenerationService - _buildCompositePkWhereClause', () => {
  const svc = new QueryGenerationService()

  it('returns 1=0 for empty tuples', () => {
    const result = svc._buildCompositePkWhereClause(['id'], [])
    expect(result).toBe('1=0')
  })

  it('builds simple IN clause for single PK', () => {
    const result = svc._buildCompositePkWhereClause(['id'], [['1'], ['2'], ['3']])
    expect(result).toBe('id IN (1, 2, 3)')
  })

  it('builds tuple-IN clause for composite PK (2 keys)', () => {
    const result = svc._buildCompositePkWhereClause(
      ['id', 'code'],
      [['1', "'A'"], ['2', "'B'"]]
    )
    expect(result).toBe("(id, code) IN ((1, 'A'), (2, 'B'))")
  })

  it('builds tuple-IN clause for composite PK (3 keys)', () => {
    const result = svc._buildCompositePkWhereClause(
      ['pk1', 'pk2', 'pk3'],
      [['1', "'X'", "'Y'"]]
    )
    expect(result).toBe("(pk1, pk2, pk3) IN ((1, 'X', 'Y'))")
  })

  it('handles reserved word field names with quoting', () => {
    const result = svc._buildCompositePkWhereClause(['type'], [["'A'"], ["'B'"]])
    expect(result).toBe("\"type\" IN ('A', 'B')")
  })
})

// =============================================================================
// NEW TESTS: MERGE with Empty Update Fields
// =============================================================================

describe('QueryGenerationService - MERGE with only PKs and created_* fields', () => {
  const svc = new QueryGenerationService()

  it('omits WHEN MATCHED clause when only PKs and created_* fields exist', () => {
    const schema = [
      ['id', 'NUMBER', 'No', '', '', 'Yes'],
      ['created_time', 'DATE', 'Yes', '', '', ''],
      ['created_by', 'VARCHAR2(50)', 'Yes', '', '', ''],
    ]
    const headers = ['id', 'created_time', 'created_by']
    const row = ['1', '', 'user1']
    const inputData = [headers, row]

    const sql = svc.generateQuery('my_table', 'merge', schema, inputData, [])

    expect(sql).not.toContain('WHEN MATCHED THEN UPDATE SET')
    expect(sql).toContain('WHEN NOT MATCHED THEN INSERT')
  })
})

// =============================================================================
// NEW TESTS: Schema-aware UPDATE/SELECT behavior
// =============================================================================

describe('QueryGenerationService - UPDATE schema-aware behavior', () => {
  const svc = new QueryGenerationService()

  const schemaWithoutUpdatedFields = [
    ['id', 'NUMBER', 'No', '', '', 'Yes'],
    ['name', 'VARCHAR2(50)', 'Yes', '', '', ''],
    ['value', 'NUMBER', 'Yes', '', '', ''],
  ]

  const schemaWithUpdatedFields = [
    ['id', 'NUMBER', 'No', '', '', 'Yes'],
    ['name', 'VARCHAR2(50)', 'Yes', '', '', ''],
    ['value', 'NUMBER', 'Yes', '', '', ''],
    ['updated_time', 'DATE', 'Yes', '', '', ''],
    ['updated_by', 'VARCHAR2(50)', 'Yes', '', '', ''],
  ]

  it('includes updated_time/updated_by when present in schema', () => {
    const headers = ['id', 'name', 'value', 'updated_time', 'updated_by']
    const row = ['1', 'test', '100', '', 'user1']
    const inputData = [headers, row]

    const sql = svc.generateQuery('my_table', 'update', schemaWithUpdatedFields, inputData, [])

    expect(sql).toContain('updated_time')
    expect(sql).toContain('updated_by')
  })

  it('omits updated_time/updated_by when not in schema', () => {
    const headers = ['id', 'name', 'value']
    const row = ['1', 'test', '100']
    const inputData = [headers, row]

    const sql = svc.generateQuery('my_table', 'update', schemaWithoutUpdatedFields, inputData, [])

    expect(sql).not.toContain('updated_time')
    expect(sql).not.toContain('updated_by')
  })

  it('uses composite PK tuple WHERE clause for multiple PKs', () => {
    const compositeSchema = [
      ['pk1', 'NUMBER', 'No', '', '', 'Yes'],
      ['pk2', 'VARCHAR2(10)', 'No', '', '', 'Yes'],
      ['value', 'NUMBER', 'Yes', '', '', ''],
    ]
    const headers = ['pk1', 'pk2', 'value']
    const row1 = ['1', 'A', '100']
    const row2 = ['2', 'B', '200']
    const inputData = [headers, row1, row2]

    const sql = svc.generateQuery('my_table', 'update', compositeSchema, inputData, [])

    expect(sql).toContain('(pk1, pk2) IN')
    expect(sql).toContain("(1, 'A')")
    expect(sql).toContain("(2, 'B')")
  })
})

describe('QueryGenerationService - SELECT schema-aware behavior', () => {
  const svc = new QueryGenerationService()

  const schemaWithoutUpdatedTime = [
    ['id', 'NUMBER', 'No', '', '', 'Yes'],
    ['name', 'VARCHAR2(50)', 'Yes', '', '', ''],
  ]

  const schemaWithUpdatedTime = [
    ['id', 'NUMBER', 'No', '', '', 'Yes'],
    ['name', 'VARCHAR2(50)', 'Yes', '', '', ''],
    ['updated_time', 'DATE', 'Yes', '', '', ''],
  ]

  it('orders by updated_time when present in schema', () => {
    const headers = ['id', 'name', 'updated_time']
    const row1 = ['1', 'test1', '']
    const row2 = ['2', 'test2', '']
    const inputData = [headers, row1, row2]

    const sql = svc.generateQuery('my_table', 'merge', schemaWithUpdatedTime, inputData, [])

    expect(sql).toContain('ORDER BY updated_time')
  })

  it('omits updated_time ordering when not in schema', () => {
    const headers = ['id', 'name']
    const row1 = ['1', 'test1']
    const row2 = ['2', 'test2']
    const inputData = [headers, row1, row2]

    const sql = svc.generateQuery('my_table', 'merge', schemaWithoutUpdatedTime, inputData, [])

    expect(sql).not.toContain('ORDER BY updated_time')
  })

  it('omits updated_time filter query when not in schema', () => {
    const headers = ['id', 'name']
    const row = ['1', 'test']
    const inputData = [headers, row]

    const sql = svc.generateQuery('my_table', 'merge', schemaWithoutUpdatedTime, inputData, [])

    expect(sql).not.toContain("SYSDATE - INTERVAL '5' MINUTE")
  })

  it('includes updated_time filter query when in schema', () => {
    const headers = ['id', 'name', 'updated_time']
    const row = ['1', 'test', '']
    const inputData = [headers, row]

    const sql = svc.generateQuery('my_table', 'merge', schemaWithUpdatedTime, inputData, [])

    expect(sql).toContain("SYSDATE - INTERVAL '5' MINUTE")
  })
})

// =============================================================================
// NEW TESTS: generateQuery Input Validation
// =============================================================================

describe('QueryGenerationService - generateQuery input validation', () => {
  const svc = new QueryGenerationService()
  const schema = [
    ['id', 'NUMBER', 'No', '', '', 'Yes'],
    ['name', 'VARCHAR2(50)', 'Yes', '', '', ''],
  ]

  it('throws when table name contains SQL injection characters', () => {
    const headers = ['id', 'name']
    const row = ['1', 'test']
    const inputData = [headers, row]

    expect(() => svc.generateQuery("my_table; DROP TABLE users--", 'insert', schema, inputData, [])).toThrow('contains forbidden characters')
  })

  it('throws when table name starts with number', () => {
    const headers = ['id', 'name']
    const row = ['1', 'test']
    const inputData = [headers, row]

    expect(() => svc.generateQuery('123table', 'insert', schema, inputData, [])).toThrow('must start with a letter')
  })

  it('throws when column name contains SQL injection characters', () => {
    const headers = ['id', "name'; DROP TABLE--"]
    const row = ['1', 'test']
    const inputData = [headers, row]

    expect(() => svc.generateQuery('my_table', 'insert', schema, inputData, [])).toThrow('contains forbidden characters')
  })

  it('throws when column name starts with number', () => {
    const headers = ['id', '123column']
    const row = ['1', 'test']
    const inputData = [headers, row]

    expect(() => svc.generateQuery('my_table', 'insert', schema, inputData, [])).toThrow('must start with a letter')
  })

  it('includes column letter in error message for invalid column', () => {
    const headers = ['id', 'valid', '3rdcolumn']
    const row = ['1', 'test', 'value']
    const inputData = [headers, row]

    expect(() => svc.generateQuery('my_table', 'insert', schema, inputData, [])).toThrow('Column C:')
  })

  it('throws when column exists in data but not in schema', () => {
    const headers = ['id', 'name', 'unknown_column']
    const row = ['1', 'test', 'value']
    const inputData = [headers, row]

    expect(() => svc.generateQuery('my_table', 'insert', schema, inputData, [])).toThrow('exists in data but not in schema')
  })

  it('includes column name in missing schema error message', () => {
    const headers = ['id', 'name', 'extra_field']
    const row = ['1', 'test', 'value']
    const inputData = [headers, row]

    expect(() => svc.generateQuery('my_table', 'insert', schema, inputData, [])).toThrow('extra_field')
  })
})

// =============================================================================
// NEW TESTS: columnIndexToLetter helper
// =============================================================================

describe('QueryGenerationService - columnIndexToLetter', () => {
  const svc = new QueryGenerationService()

  it('converts index 0 to A', () => {
    expect(svc.columnIndexToLetter(0)).toBe('A')
  })

  it('converts index 25 to Z', () => {
    expect(svc.columnIndexToLetter(25)).toBe('Z')
  })

  it('converts index 26 to AA', () => {
    expect(svc.columnIndexToLetter(26)).toBe('AA')
  })

  it('converts index 27 to AB', () => {
    expect(svc.columnIndexToLetter(27)).toBe('AB')
  })

  it('converts index 51 to AZ', () => {
    expect(svc.columnIndexToLetter(51)).toBe('AZ')
  })

  it('converts index 52 to BA', () => {
    expect(svc.columnIndexToLetter(52)).toBe('BA')
  })
})
