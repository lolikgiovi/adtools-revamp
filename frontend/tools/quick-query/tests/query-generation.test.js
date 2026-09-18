import { describe, it, expect, vi } from 'vitest'
import { QueryGenerationService, findReferencedBlobAttachments } from '../services/QueryGenerationService.js'
import { AttachmentProcessorService } from '../services/AttachmentProcessorService.js'

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

describe('QueryGenerationService - BLOB attachments', () => {
  const schema = [
    ['id', 'NUMBER', 'No', '', '', 'Yes'],
    ['document', 'BLOB', 'No', '', '', ''],
  ]
  const pdf = (name, bytes) => ({
    name,
    type: 'application/pdf',
    processedFormats: { base64: `data:application/pdf;base64,${Buffer.from(bytes).toString('base64')}` },
  })

  it.each(['insert', 'update', 'merge'])('embeds the actual PDF bytes for %s', (queryType) => {
    const attachment = pdf('first.pdf', [0x25, 0x50, 0x44, 0x46, 0x00, 0xff])
    const sql = new QueryGenerationService().generateQuery('documents', queryType, schema, [
      ['id', 'document'],
      ['1', 'first.pdf'],
    ], [attachment])

    expect(sql).toContain('DECLARE\n  quick_query_chunk RAW(32767);\n  quick_query_blob_1 BLOB;')
    expect(sql).toContain("UTL_ENCODE.BASE64_DECODE(UTL_RAW.CAST_TO_RAW('JVBERgD/'))")
    expect(sql).toContain('DBMS_LOB.WRITEAPPEND(quick_query_blob_1, UTL_RAW.LENGTH(quick_query_chunk), quick_query_chunk);')
    expect(sql).toContain('quick_query_blob_1')
    expect(sql).not.toContain("utl_raw.cast_to_raw('first.pdf')")
    expect(sql).toContain('END;\n/')
  })

  it('includes six different files once each and reuses an attachment across rows', () => {
    const attachments = Array.from({ length: 6 }, (_, index) => pdf(`file${index + 1}.pdf`, [index + 1]))
    const rows = attachments.map((file, index) => [String(index + 1), file.name])
    rows.push(['7', 'file1.pdf'])
    const sql = new QueryGenerationService().generateQuery('documents', 'insert', schema, [['id', 'document'], ...rows], attachments)

    expect((sql.match(/DBMS_LOB.CREATETEMPORARY/g) || [])).toHaveLength(6)
    expect((sql.match(/INSERT INTO documents/g) || [])).toHaveLength(7)
    expect((sql.match(/VALUES \(\d+, quick_query_blob_1\);/g) || [])).toHaveLength(2)
  })

  it('chunks a large attachment on complete Base64 groups', () => {
    const attachment = pdf('large.pdf', new Uint8Array(16000))
    const sql = new QueryGenerationService().generateQuery('documents', 'insert', schema, [
      ['id', 'document'], ['1', 'large.pdf'],
    ], [attachment])

    expect((sql.match(/DBMS_LOB.WRITEAPPEND/g) || [])).toHaveLength(2)
    expect(sql).not.toContain("utl_raw.cast_to_raw('large.pdf')")
  })

  it('generates regular SQL with filename bytes when that option is selected', () => {
    const attachment = pdf('first.pdf', [0x25, 0x50, 0x44, 0x46])
    const sql = new QueryGenerationService().generateQuery('documents', 'merge', schema, [
      ['id', 'document'], ['1', 'first.pdf'],
    ], [attachment], { blobAttachmentMode: 'filename' })

    expect(sql).toContain("utl_raw.cast_to_raw('first.pdf')")
    expect(sql).not.toContain('DECLARE')
    expect(sql).not.toContain('JVBERg==')
  })

  it('detects only attached filenames in BLOB cells, counting reused files once', () => {
    const attachments = [pdf('first.pdf', [1]), pdf('second.pdf', [2])]
    const input = [['id', 'document'], ['1', 'first.pdf'], ['2', 'FIRST.PDF'], ['3', 'unattached.pdf']]

    expect(findReferencedBlobAttachments(schema, input, attachments)).toEqual([attachments[0]])
    expect(findReferencedBlobAttachments([['id', 'NUMBER'], ['document', 'VARCHAR2(30)']], input, attachments)).toEqual([])
  })

  it('rejects an attached file whose binary content is unavailable', () => {
    const attachment = { name: 'missing.pdf', processedFormats: { base64: null } }
    expect(() => new QueryGenerationService().generateQuery('documents', 'insert', schema, [
      ['id', 'document'], ['1', 'missing.pdf'],
    ], [attachment])).toThrow('has no binary content')
  })

  it('rejects invalid Base64 before emitting a SQL block', () => {
    const attachment = { name: 'bad.pdf', processedFormats: { base64: 'data:application/pdf;base64,not valid' } }
    expect(() => new QueryGenerationService().generateQuery('documents', 'insert', schema, [
      ['id', 'document'], ['1', 'bad.pdf'],
    ], [attachment])).toThrow('invalid Base64 content')
  })

  it('uses the original UTF-8 bytes of an attached text file for a BLOB', async () => {
    const file = new File(['café'], 'note.txt', { type: 'text/plain' })
    const [attachment] = await new AttachmentProcessorService().processAttachments([file], 'documents')
    const sql = new QueryGenerationService().generateQuery('documents', 'insert', schema, [
      ['id', 'document'], ['1', 'note.txt'],
    ], [attachment])

    expect(sql).toContain("UTL_ENCODE.BASE64_DECODE(UTL_RAW.CAST_TO_RAW('Y2Fmw6k='))")
  })
})

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

    expect(sql.match(/------ SELECT Statement --------/g)).toHaveLength(1)
    expect(sql.indexOf('------ SELECT Statement --------')).toBeGreaterThan(sql.indexOf('MERGE INTO my_table'))
    expect(sql).toContain('SELECT * FROM my_table WHERE id IN (1)')
    expect(sql).toContain("SELECT id, updated_time FROM my_table WHERE updated_time >= SYSDATE - INTERVAL '2' MINUTE;")
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
    expect(sql.match(/------ SELECT Statement --------/g)).toHaveLength(1)
    expect(sql.indexOf('------ SELECT Statement --------')).toBeGreaterThan(sql.indexOf('INSERT INTO my_table'))
    expect(sql).toContain("SELECT id, updated_time FROM my_table WHERE updated_time >= SYSDATE - INTERVAL '2' MINUTE;")
  })
})

describe('QueryGenerationService - UPDATE generation', () => {
  const svc = new QueryGenerationService()
  const schema = buildLowercaseSchema()
  const headers = ['id','type','sequence','created_time','created_by','updated_time','updated_by']
  const row1 = ['1','menu','10','','', '', 'user1']
  const row2 = ['2','menu2','20','','', '', 'user2']
  const inputData = [headers, row1, row2]

  it('places UPDATE statements before one labeled SELECT section', () => {
    const sql = svc.generateQuery('my_table', 'update', schema, inputData, [])

    expect(sql).toContain('UPDATE my_table')
    expect(sql).toContain('SET')
    expect(sql).toContain('"type" =')
    expect(sql).toContain('"sequence" =')
    expect(sql).toContain('updated_time = SYSDATE')
    expect(sql).toContain("updated_by = 'USER1'")
    expect(sql).not.toContain('created_time =')
    expect(sql).not.toContain('created_by =')
    expect(sql).not.toContain('Selected fields before update')
    expect(sql).not.toContain('Selected fields after update')
    expect(sql.match(/------ SELECT Statement --------/g)).toHaveLength(1)
    expect(sql.indexOf('------ SELECT Statement --------')).toBeGreaterThan(sql.lastIndexOf('UPDATE my_table'))
    expect(sql).toContain('SELECT "type", "sequence", updated_time, updated_by FROM my_table WHERE id IN (1, 2);')
    expect(sql).toContain("SELECT id, updated_time FROM my_table WHERE updated_time >= SYSDATE - INTERVAL '2' MINUTE;")
    // PK used only in WHERE/ON clauses; not part of SET
  })

  it('matches the requested UPDATE and SELECT layout', () => {
    const custodySchema = [
      ['custody_order_id', 'VARCHAR2(20)', 'No', '', '', 'Yes'],
      ['updated_by', 'VARCHAR2(50)', 'Yes', '', '', ''],
      ['updated_time', 'DATE', 'Yes', '', '', ''],
      ['pickup_branch_code', 'VARCHAR2(10)', 'Yes', '', '', ''],
      ['pickup_branch_name', 'VARCHAR2(100)', 'Yes', '', '', ''],
      ['pickup_branch_address', 'VARCHAR2(200)', 'Yes', '', '', ''],
    ]
    const custodyInput = [
      ['custody_order_id', 'updated_by', 'updated_time', 'pickup_branch_code', 'pickup_branch_name', 'pickup_branch_address'],
      ['ORD000000003225', 'PATCHING_CABANG', '', '32500', 'KC Cipeli pam pam', 'Jl. Jendral Sudirman No.7, Opas Indah'],
    ]

    const sql = svc.generateQuery('BULLION.CUSTODY_ACCOUNT', 'update', custodySchema, custodyInput, [])

    expect(sql).toBe(`SET DEFINE OFF;

UPDATE BULLION.CUSTODY_ACCOUNT
SET
  updated_by = 'PATCHING_CABANG',
  updated_time = SYSDATE,
  pickup_branch_code = '32500',
  pickup_branch_name = 'KC Cipeli pam pam',
  pickup_branch_address = 'Jl. Jendral Sudirman No.7, Opas Indah'
WHERE custody_order_id = 'ORD000000003225';


------ SELECT Statement --------
SELECT pickup_branch_code, pickup_branch_name, pickup_branch_address, updated_time, updated_by FROM BULLION.CUSTODY_ACCOUNT WHERE custody_order_id IN ('ORD000000003225');
SELECT * FROM BULLION.CUSTODY_ACCOUNT WHERE custody_order_id IN ('ORD000000003225');
SELECT custody_order_id, updated_time FROM BULLION.CUSTODY_ACCOUNT WHERE updated_time >= SYSDATE - INTERVAL '2' MINUTE;`)
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

    expect(sql).not.toContain("SYSDATE - INTERVAL '2' MINUTE")
  })

  it('includes updated_time filter query when in schema', () => {
    const headers = ['id', 'name', 'updated_time']
    const row = ['1', 'test', '']
    const inputData = [headers, row]

    const sql = svc.generateQuery('my_table', 'merge', schemaWithUpdatedTime, inputData, [])

    expect(sql).toContain("SYSDATE - INTERVAL '2' MINUTE")
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
