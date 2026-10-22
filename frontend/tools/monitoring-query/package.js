const SCHEMA_NAME = "MONITORING";
const SOURCE_NAME = "ad-tools.monitoring-query";
const CLOB_CHUNK_UTF8_LIMIT = 2000;

const TABLE_DEFINITIONS = {
  DSH_MENU: {
    primaryKey: "MENU_ID",
    rank: 0,
    parentColumns: {},
    immutableColumns: ["MENU_ID", "CREATED_BY", "CREATED_AT", "UPDATED_BY", "UPDATED_AT"],
    editableColumns: ["CHANNEL_NAME", "MENU_LABEL", "DISPLAY_ORDER", "IS_ACTIVE"],
    generatedColumns: ["CREATED_BY", "CREATED_AT", "UPDATED_BY", "UPDATED_AT"],
    columns: {
      MENU_ID: ["VARCHAR2", false, 50],
      CHANNEL_NAME: ["VARCHAR2", false, 100],
      MENU_LABEL: ["VARCHAR2", false, 100],
      DISPLAY_ORDER: ["NUMBER", false, 3, 0],
      IS_ACTIVE: ["CHAR", false, 1],
      CREATED_BY: ["VARCHAR2", true, 50],
      CREATED_AT: ["TIMESTAMP", false, 6],
      UPDATED_BY: ["VARCHAR2", true, 50],
      UPDATED_AT: ["TIMESTAMP", true, 6],
    },
  },
  DSH_SUMMARY_GROUP: {
    primaryKey: "GROUP_ID",
    rank: 1,
    parentColumns: { MENU_ID: ["DSH_MENU", "MENU_ID"], DATASOURCE_ID: ["DSH_DATASOURCE", "DATASOURCE_ID"] },
    immutableColumns: ["GROUP_ID", "MENU_ID", "DATASOURCE_ID"],
    editableColumns: ["GROUP_TITLE", "SQL_TEXT", "TIMEOUT_MS", "DISPLAY_ORDER"],
    generatedColumns: [],
    columns: {
      GROUP_ID: ["VARCHAR2", false, 50],
      MENU_ID: ["VARCHAR2", false, 50],
      DATASOURCE_ID: ["VARCHAR2", false, 30],
      GROUP_TITLE: ["VARCHAR2", true, 100],
      SQL_TEXT: ["CLOB", false],
      TIMEOUT_MS: ["NUMBER", false, 6, 0],
      DISPLAY_ORDER: ["NUMBER", false, 3, 0],
    },
  },
  DSH_SUMMARY_FIELD: {
    primaryKey: "FIELD_ID",
    rank: 2,
    parentColumns: { GROUP_ID: ["DSH_SUMMARY_GROUP", "GROUP_ID"] },
    immutableColumns: ["FIELD_ID", "GROUP_ID"],
    editableColumns: ["FIELD_TITLE", "SOURCE_FIELD", "VALUE_FORMAT", "TONE", "DISPLAY_ORDER"],
    generatedColumns: [],
    columns: {
      FIELD_ID: ["VARCHAR2", false, 50],
      GROUP_ID: ["VARCHAR2", false, 50],
      FIELD_TITLE: ["VARCHAR2", false, 100],
      SOURCE_FIELD: ["VARCHAR2", false, 50],
      VALUE_FORMAT: ["VARCHAR2", false, 20],
      TONE: ["VARCHAR2", true, 10],
      DISPLAY_ORDER: ["NUMBER", false, 3, 0],
    },
  },
  DSH_DETAIL_TABLE: {
    primaryKey: "TABLE_ID",
    rank: 1,
    parentColumns: { MENU_ID: ["DSH_MENU", "MENU_ID"], DATASOURCE_ID: ["DSH_DATASOURCE", "DATASOURCE_ID"] },
    immutableColumns: ["TABLE_ID", "MENU_ID", "DATASOURCE_ID"],
    editableColumns: [
      "TABLE_TITLE",
      "TONE",
      "PAGE_SIZE",
      "SQL_TEXT",
      "TIMEOUT_MS",
      "DISPLAY_ORDER",
      "SHOW_CHART",
      "CHART_TYPE",
      "CHART_TITLE",
      "CHART_SQL",
      "CHART_LABEL_FIELD",
      "CHART_VALUE_FIELD",
      "CHART_VALUE_FORMAT",
    ],
    generatedColumns: [],
    columns: {
      TABLE_ID: ["VARCHAR2", false, 50],
      MENU_ID: ["VARCHAR2", false, 50],
      DATASOURCE_ID: ["VARCHAR2", false, 30],
      TABLE_TITLE: ["VARCHAR2", false, 150],
      TONE: ["VARCHAR2", true, 10],
      PAGE_SIZE: ["NUMBER", false, 3, 0],
      SQL_TEXT: ["CLOB", false],
      TIMEOUT_MS: ["NUMBER", false, 6, 0],
      DISPLAY_ORDER: ["NUMBER", false, 3, 0],
      SHOW_CHART: ["CHAR", false, 1],
      CHART_TYPE: ["VARCHAR2", true, 10],
      CHART_TITLE: ["VARCHAR2", true, 150],
      CHART_SQL: ["CLOB", true],
      CHART_LABEL_FIELD: ["VARCHAR2", true, 50],
      CHART_VALUE_FIELD: ["VARCHAR2", true, 50],
      CHART_VALUE_FORMAT: ["VARCHAR2", true, 20],
    },
  },
  DSH_DETAIL_COLUMN: {
    primaryKey: "COLUMN_ID",
    rank: 2,
    parentColumns: { TABLE_ID: ["DSH_DETAIL_TABLE", "TABLE_ID"] },
    immutableColumns: ["COLUMN_ID", "TABLE_ID"],
    editableColumns: ["COLUMN_TITLE", "SOURCE_FIELD", "VALUE_FORMAT", "ALIGN", "DISPLAY_ORDER"],
    generatedColumns: [],
    columns: {
      COLUMN_ID: ["VARCHAR2", false, 50],
      TABLE_ID: ["VARCHAR2", false, 50],
      COLUMN_TITLE: ["VARCHAR2", false, 100],
      SOURCE_FIELD: ["VARCHAR2", false, 50],
      VALUE_FORMAT: ["VARCHAR2", false, 20],
      ALIGN: ["VARCHAR2", true, 6],
      DISPLAY_ORDER: ["NUMBER", false, 3, 0],
    },
  },
  DSH_CONFIG_AUDIT: {
    primaryKey: "AUDIT_ID",
    rank: 3,
    parentColumns: {},
    immutableColumns: [],
    editableColumns: [],
    generatedColumns: ["AUDIT_ID"],
    columns: {
      AUDIT_ID: ["NUMBER", false],
      TABLE_NAME: ["VARCHAR2", false, 30],
      RECORD_ID: ["VARCHAR2", false, 50],
      ACTION: ["VARCHAR2", false, 10],
      OLD_VALUE: ["CLOB", true],
      NEW_VALUE: ["CLOB", true],
      CHANGED_BY: ["VARCHAR2", true, 50],
      CHANGED_AT: ["TIMESTAMP", false, 6],
    },
  },
};

const AUDIT_TABLE_NAME = "DSH_CONFIG_AUDIT";
/**
 * Builds an immutable, standalone Oracle package for the reviewed monitoring
 * operations. This function serializes only: it never connects to or executes
 * SQL against Oracle.
 *
 * Input contracts:
 * - identity is { database, service, schema, username, characterSet? }. These
 *   are expected DB_NAME, SERVICE_NAME, CURRENT_SCHEMA, SESSION_USER and the
 *   Oracle database character set respectively.
 * - metadata is { schema, characterSet, tables }. Each table has { name, primaryKey,
 *   columns }, and each column has { name, type, nullable, length, precision,
 *   scale, charUsed, dataLength }. type is VARCHAR2, CHAR, NUMBER, DATE,
 *   TIMESTAMP or CLOB. Oracle dictionary aliases dataType, charLength,
 *   dataPrecision and dataScale are also accepted.
 * - actor is { source: 'configured-editor' | 'oracle-username', name,
 *   databaseUsername }. databaseUsername must match identity.username.
 * - operations use uppercase allowlisted table names and action INSERT/UPDATE.
 *   baseline and desired are complete uppercase-column row objects for UPDATE.
 *   INSERT desired contains all columns, except DSH_MENU's four generated
 *   audit columns may be omitted. DSH_CONFIG_AUDIT also requires
 *   default:'GENERATED ALWAYS AS IDENTITY' on AUDIT_ID (or an equivalent
 *   identity/generationType metadata field).
 *   Values use the PRD typed
 *   contract: null, strings for CHAR/VARCHAR2, or number/date/timestamp/clob
 *   wrappers for their Oracle types.
 * - baselineReadAt and readAt are optional ISO-8601 timestamps with an explicit
 *   timezone. When supplied, they are retained in the package manifest.
 *
 * @param {object} input
 * @returns {Promise<{manifest: object, sql: string, verifySql: string,
 *   changes: object, packageId: string, scriptSha256: string}>}
 */
export async function createPackage({ identity, fingerprint, metadata, operations, revision, actor, baselineReadAt, readAt } = {}) {
  const normalizedIdentity = validateIdentity(identity);
  const normalizedActor = validateActor(actor, normalizedIdentity.username);
  const normalizedSchema = validateMetadata(metadata, normalizedIdentity.characterSet);
  normalizedIdentity.characterSet = normalizedSchema.databaseCharacterSet;
  const normalizedFingerprint = requireText(fingerprint, "fingerprint");
  const normalizedRevision = validateRevision(revision);
  const normalizedBaselineReadAt = optionalIsoTimestamp(baselineReadAt, "baselineReadAt");
  const normalizedReadAt = optionalIsoTimestamp(readAt, "readAt");
  const sourceOperations = Array.isArray(operations) ? operations : fail("operations must be an array");
  if (sourceOperations.length === 0) fail("operations must include at least one reviewed INSERT or UPDATE");
  const packageId = createUuid();
  const markers = createMarkers(packageId, sourceOperations);
  const normalizedOperations = normalizeOperations(sourceOperations, normalizedSchema, normalizedActor, markers);
  validateUnicodeSupport(normalizedIdentity, normalizedActor, normalizedOperations, normalizedSchema.databaseCharacterSet);
  const orderedOperations = [...normalizedOperations].sort(compareOperations);
  const parentLocks = collectParentLocks(orderedOperations);
  const sql = buildApplySql({
    identity: normalizedIdentity,
    actor: normalizedActor,
    databaseCharacterSet: normalizedSchema.databaseCharacterSet,
    operations: orderedOperations,
    parentLocks,
    packageId,
    markers,
  });
  const verifySql = buildVerifySql(orderedOperations);
  const scriptSha256 = await sha256(sql);
  const createdAt = new Date().toISOString();
  const changes = {
    formatVersion: 1,
    packageId,
    operations: orderedOperations.map(toChangeRecord),
  };
  const warnings = [
    {
      code: "RUNNER_UNVERIFIED",
      message: "The target Run Query runner has not passed the required PL/SQL, CLOB, atomicity, and stop-on-error checks.",
    },
  ];
  const manifest = {
    formatVersion: 1,
    format: SOURCE_NAME,
    packageId,
    createdAt,
    sourceIdentity: normalizedIdentity,
    schema: SCHEMA_NAME,
    databaseCharacterSet: normalizedSchema.databaseCharacterSet ?? null,
    schemaFingerprint: normalizedFingerprint,
    baselineReadAt: normalizedBaselineReadAt,
    readAt: normalizedReadAt,
    draftRevision: normalizedRevision,
    declaredActor: normalizedActor,
    operations: orderedOperations.map(({ action, table, primaryKey, primaryKeyValue, changedColumns, operationId }) => ({
      operationId,
      table,
      action,
      primaryKey: { column: primaryKey, value: primaryKeyValue },
      changedColumns,
    })),
    warnings,
    expectedStateComparisonRules: {
      scalarValues: "Compare exact PRD typed values, preserving SQL NULL and Oracle DATE/TIMESTAMP precision.",
      clobs: "Compare complete CLOB contents; SQL NULL and a non-null empty CLOB are distinct.",
      timestamps: "DSH_MENU CREATED_AT/UPDATED_AT and audit CHANGED_AT use the script transaction timestamp.",
    },
    runnerCompatibility: { verified: false, handoffReady: false },
    scriptSha256,
  };

  return { manifest, sql, verifySql, changes, packageId, scriptSha256 };
}

function validateIdentity(identity) {
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) fail("identity must be an object");
  const normalized = {};
  for (const key of ["database", "service", "schema", "username"]) normalized[key] = requireText(identity[key], `identity.${key}`);
  if (normalized.schema.toUpperCase() !== SCHEMA_NAME) fail(`identity.schema must be ${SCHEMA_NAME}`);
  const characterSet = pick(identity, ["characterSet", "databaseCharacterSet", "database_character_set"]);
  normalized.characterSet = characterSet == null || characterSet === "" ? null : String(characterSet).trim().toUpperCase();
  return normalized;
}

function validateActor(actor, identityUsername) {
  if (!actor || typeof actor !== "object" || Array.isArray(actor)) fail("actor must be an object");
  if (!["configured-editor", "oracle-username"].includes(actor.source)) {
    fail("actor.source must be 'configured-editor' or 'oracle-username'");
  }
  const name = requireText(actor.name, "actor.name");
  const databaseUsername = requireText(actor.databaseUsername, "actor.databaseUsername");
  if (!sameOracleIdentifier(databaseUsername, identityUsername)) fail("actor.databaseUsername must match identity.username");
  if (actor.source === "oracle-username" && !sameOracleIdentifier(name, databaseUsername)) {
    fail("actor.name must match actor.databaseUsername when actor.source is oracle-username");
  }
  if (new TextEncoder().encode(name).length > 50) fail("actor.name exceeds DSH_CONFIG_AUDIT.CHANGED_BY VARCHAR2(50)");
  return { source: actor.source, name, databaseUsername };
}

function validateMetadata(metadata, identityCharacterSet) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) fail("metadata must be an object");
  const schemaName = pick(metadata, ["schema", "SCHEMA"]);
  if (typeof schemaName !== "string" || schemaName.toUpperCase() !== SCHEMA_NAME) {
    fail(`metadata.schema must be ${SCHEMA_NAME}`);
  }
  let tables;
  const tableSource = pick(metadata, ["tables", "TABLES"]);
  if (Array.isArray(tableSource)) {
    tables = tableSource;
  } else if (tableSource && typeof tableSource === "object") {
    tables = Object.entries(tableSource).map(([name, table]) => ({ name, ...table }));
  } else {
    fail("metadata.tables must be an array or table-name map");
  }
  const byName = new Map();
  for (const table of tables) {
    if (!table || typeof table !== "object") fail("metadata contains an invalid table descriptor");
    const name = String(pick(table, ["name", "tableName", "table_name", "TABLE_NAME"]) ?? "").toUpperCase();
    if (!Object.hasOwn(TABLE_DEFINITIONS, name)) continue;
    if (byName.has(name)) fail(`metadata contains duplicate table ${name}`);
    byName.set(name, normalizeTableMetadata(name, table));
  }
  for (const tableName of Object.keys(TABLE_DEFINITIONS)) {
    if (!byName.has(tableName)) fail(`metadata is missing ${tableName}`);
  }
  if (byName.size !== Object.keys(TABLE_DEFINITIONS).length) fail("metadata includes an unsupported managed table");
  const rawCharacterSet = pick(metadata, ["databaseCharacterSet", "database_character_set", "NLS_CHARACTERSET", "characterSet"]);
  const metadataCharacterSet = rawCharacterSet == null || rawCharacterSet === "" ? null : String(rawCharacterSet).trim().toUpperCase();
  if (metadataCharacterSet && identityCharacterSet && metadataCharacterSet !== identityCharacterSet) {
    fail("identity.characterSet and metadata.characterSet do not match");
  }
  byName.databaseCharacterSet = metadataCharacterSet ?? identityCharacterSet ?? null;
  return byName;
}

function normalizeTableMetadata(name, table) {
  const definition = TABLE_DEFINITIONS[name];
  const pkValue = pick(table, ["primaryKey", "primaryKeyColumn", "primary_key", "PRIMARY_KEY", "pk"]);
  const pk = Array.isArray(pkValue) ? pkValue.map(String) : [String(pkValue ?? "")];
  if (pk.length !== 1 || pk[0].toUpperCase() !== definition.primaryKey) {
    fail(`metadata ${name} primaryKey must be ${definition.primaryKey}`);
  }
  let columns;
  const columnSource = pick(table, ["columns", "COLUMNS"]);
  if (Array.isArray(columnSource)) {
    columns = columnSource;
  } else if (columnSource && typeof columnSource === "object") {
    columns = Object.entries(columnSource).map(([columnName, column]) => ({ name: columnName, ...column }));
  } else {
    fail(`metadata ${name}.columns must be an array or column-name map`);
  }
  const normalizedColumns = [];
  const seen = new Set();
  for (const column of columns) {
    if (!column || typeof column !== "object") fail(`metadata ${name} contains an invalid column descriptor`);
    const columnName = String(pick(column, ["name", "columnName", "column_name", "COLUMN_NAME"]) ?? "").toUpperCase();
    if (!/^[A-Z][A-Z0-9_]*$/.test(columnName)) fail(`metadata ${name} has an invalid column name`);
    if (seen.has(columnName)) fail(`metadata ${name} contains duplicate column ${columnName}`);
    seen.add(columnName);
    const expected = definition.columns[columnName];
    if (!expected) fail(`metadata ${name} contains unsupported column ${columnName}`);
    const type = normalizeColumnType(column);
    const nullable = normalizeNullable(pick(column, ["nullable", "isNullable", "is_nullable", "NULLABLE"]));
    if (type !== expected[0]) fail(`metadata ${name}.${columnName} type must be ${expected[0]}, got ${type}`);
    if (nullable !== expected[1]) fail(`metadata ${name}.${columnName} nullability does not match the supported schema`);
    const length = optionalInteger(
      pick(column, ["length", "charLength", "char_length", "CHAR_LENGTH", "dataLength", "data_length", "DATA_LENGTH"]),
    );
    const precision = optionalInteger(
      pick(column, ["precision", "dataPrecision", "data_precision", "DATA_PRECISION"]) ?? parseTypePrecision(column),
    );
    const scale = optionalInteger(pick(column, ["scale", "dataScale", "data_scale", "DATA_SCALE"]));
    if (type === "VARCHAR2" || type === "CHAR") {
      if (length !== expected[2]) fail(`metadata ${name}.${columnName} length must be ${expected[2]}`);
    }
    if (type === "NUMBER" || type === "TIMESTAMP") {
      if (expected[2] !== undefined && precision !== expected[2]) fail(`metadata ${name}.${columnName} precision must be ${expected[2]}`);
      if (type === "NUMBER" && expected[3] !== undefined && scale !== expected[3]) {
        fail(`metadata ${name}.${columnName} scale must be ${expected[3]}`);
      }
    }
    const charUsed = normalizeCharUsed(pick(column, ["charUsed", "char_used", "CHAR_USED", "lengthSemantics"]));
    const dataLength = optionalInteger(pick(column, ["dataLength", "data_length", "DATA_LENGTH"]));
    if ((type === "VARCHAR2" || type === "CHAR") && (!charUsed || dataLength === undefined)) {
      fail(`metadata ${name}.${columnName} must include CHAR_USED and DATA_LENGTH`);
    }
    normalizedColumns.push({ name: columnName, type, nullable, length, precision, scale, charUsed, dataLength });
  }
  const expectedNames = Object.keys(definition.columns);
  for (const columnName of expectedNames) {
    if (!seen.has(columnName)) fail(`metadata ${name} is missing column ${columnName}`);
  }
  if (seen.size !== expectedNames.length) fail(`metadata ${name} has an unsupported column set`);
  if (name === AUDIT_TABLE_NAME) validateAuditMetadata(table, normalizedColumns, columns);
  return { name, primaryKey: definition.primaryKey, columns: normalizedColumns };
}

function validateAuditMetadata(table, columns, rawColumns) {
  const descriptor = columns.find((column) => column.name === "AUDIT_ID");
  const rawIdColumn = rawColumns.find(
    (column) => String(pick(column, ["name", "columnName", "column_name", "COLUMN_NAME"]) ?? "").toUpperCase() === "AUDIT_ID",
  );
  const rawIdentity =
    pick(table, ["identity", "generated", "identityGeneration", "identityGenerationType", "generationType", "IDENTITY"]) ??
    pick(rawIdColumn ?? {}, [
      "identity",
      "generated",
      "identityGeneration",
      "identityGenerationType",
      "generationType",
      "generation_type",
      "GENERATION_TYPE",
      "default",
      "DEFAULT",
    ]);
  const identity = String(rawIdentity?.generationType ?? rawIdentity?.generation_type ?? rawIdentity ?? "").toUpperCase();
  if (descriptor?.name !== "AUDIT_ID") fail("DSH_CONFIG_AUDIT.AUDIT_ID metadata is missing");
  if (identity !== "ALWAYS" && !/\bGENERATED\s+ALWAYS\s+AS\s+IDENTITY\b/.test(identity)) {
    fail("DSH_CONFIG_AUDIT.AUDIT_ID must be GENERATED ALWAYS AS IDENTITY");
  }
}

function normalizeOperations(operations, schema, actor, markers) {
  const normalized = [];
  const keys = new Set();
  const operationIds = new Set();
  operations.forEach((operation, index) => {
    if (!operation || typeof operation !== "object" || Array.isArray(operation)) fail(`operations[${index}] must be an object`);
    const table = String(operation.table ?? "").toUpperCase();
    const definition = TABLE_DEFINITIONS[table];
    if (!definition || table === AUDIT_TABLE_NAME) fail(`operations[${index}].table is not a writable allowlisted table`);
    const action = String(operation.action ?? "").toUpperCase();
    if (!["INSERT", "UPDATE"].includes(action)) fail(`operations[${index}].action must be INSERT or UPDATE`);
    if (action === "INSERT" && operation.baseline !== null) fail(`operations[${index}] INSERT baseline must be null`);
    if (action === "UPDATE" && (!operation.baseline || typeof operation.baseline !== "object")) {
      fail(`operations[${index}] UPDATE requires a complete baseline row`);
    }
    if (!operation.desired || typeof operation.desired !== "object" || Array.isArray(operation.desired)) {
      fail(`operations[${index}].desired must be a row object`);
    }
    const metadataTable = schema.get(table);
    const columns = metadataTable.columns;
    const baseline = action === "UPDATE" ? normalizeRow(operation.baseline, columns, table, `operations[${index}].baseline`) : null;
    const desired = normalizeRow(operation.desired, columns, table, `operations[${index}].desired`, { action });
    const primaryKey = definition.primaryKey;
    const primaryKeyValue = desired[primaryKey];
    if (primaryKeyValue === null || typeof primaryKeyValue !== "string" || primaryKeyValue.length === 0) {
      fail(`operations[${index}].desired.${primaryKey} must be a non-empty string`);
    }
    if (Array.from(primaryKeyValue).length > 50) fail(`operations[${index}].desired.${primaryKey} exceeds VARCHAR2(50)`);
    if (action === "UPDATE") {
      if (!rowsEqualKey(baseline[primaryKey], primaryKeyValue)) fail(`operations[${index}] cannot change ${primaryKey}`);
      for (const column of definition.immutableColumns) {
        if (!valuesEqual(baseline[column], desired[column])) fail(`operations[${index}] cannot change immutable column ${column}`);
      }
    }
    const operationKey = `${table}\u0000${primaryKeyValue}`;
    if (keys.has(operationKey)) fail(`duplicate operation for ${table}.${primaryKey}=${primaryKeyValue}`);
    keys.add(operationKey);
    const changedColumns =
      action === "INSERT"
        ? columns.map(({ name }) => name).filter((name) => !definition.generatedColumns.includes(name))
        : definition.editableColumns.filter((name) => !valuesEqual(baseline[name], desired[name]));
    if (action === "UPDATE" && changedColumns.length === 0) fail(`operations[${index}] is a no-op and must be removed`);
    const operationId = requireText(
      operation.operationId ?? `${action.toLowerCase()}:${table}:${primaryKeyValue}`,
      `operations[${index}].operationId`,
    );
    if (operationIds.has(operationId)) fail(`duplicate operationId ${operationId}`);
    operationIds.add(operationId);
    const item = {
      inputIndex: index,
      table,
      action,
      primaryKey,
      primaryKeyValue,
      baseline,
      desired,
      changedColumns,
      operationId,
      metadataColumns: columns,
      definition,
      expectedRow: makeExpectedRow(table, action, desired, actor, markers),
    };
    validateInsertFields(item);
    normalized.push(item);
  });
  return normalized;
}

function normalizeRow(row, columns, table, path, { action } = {}) {
  const definition = TABLE_DEFINITIONS[table];
  const names = new Set(Object.keys(row).map((name) => String(name).toUpperCase()));
  for (const name of Object.keys(row)) {
    if (String(name).toUpperCase() !== name) fail(`${path} column names must be uppercase: ${name}`);
    if (!definition.columns[name]) fail(`${path} contains unsupported column ${name}`);
  }
  const result = {};
  for (const column of columns) {
    const { name } = column;
    const generatedInsertColumn = table === "DSH_MENU" && action === "INSERT" && definition.generatedColumns.includes(name);
    if (!names.has(name)) {
      if (generatedInsertColumn) continue;
      fail(`${path} is missing ${name}`);
    }
    const normalized = normalizeValue(row[name], column, `${path}.${name}`);
    if (generatedInsertColumn && name === "UPDATED_BY" && normalized !== null)
      fail(`${path}.${name} is generated and must be null or omitted`);
    if (generatedInsertColumn && name === "UPDATED_AT" && normalized !== null)
      fail(`${path}.${name} is generated and must be null or omitted`);
    if (generatedInsertColumn && name === "CREATED_BY" && normalized !== null)
      fail(`${path}.${name} is generated from actor and must be omitted or null`);
    if (generatedInsertColumn && name === "CREATED_AT" && normalized !== null)
      fail(`${path}.${name} is generated from SYSTIMESTAMP and must be omitted or null`);
    result[name] = normalized;
  }
  return result;
}

function validateInsertFields(operation) {
  if (operation.action !== "INSERT") return;
  const required = operation.metadataColumns.filter(({ name }) => !operation.definition.generatedColumns.includes(name));
  for (const { name } of required) {
    if (!Object.hasOwn(operation.desired, name)) fail(`${operation.table} INSERT is missing ${name}`);
  }
}

function normalizeValue(value, column, path) {
  if (value === null) {
    if (!column.nullable) fail(`${path} cannot be null`);
    return null;
  }
  switch (column.type) {
    case "VARCHAR2":
    case "CHAR": {
      if (typeof value !== "string") fail(`${path} must be a string or null`);
      if (value === "") {
        if (!column.nullable) fail(`${path} cannot be empty because Oracle stores empty VARCHAR2 as NULL`);
        return null;
      }
      validateCharacterLength(value, column, path);
      return value;
    }
    case "NUMBER":
      return normalizeNumber(value, column, path);
    case "DATE":
      return normalizeDate(value, path);
    case "TIMESTAMP":
      return normalizeTimestamp(value, column, path);
    case "CLOB":
      if (!value || typeof value !== "object" || value.type !== "clob" || typeof value.value !== "string") {
        fail(`${path} must be {type:'clob', value:string} or null`);
      }
      if (value.value.length === 0 && !column.nullable) fail(`${path} cannot be an empty CLOB because the column is required`);
      return { type: "clob", value: value.value };
    default:
      return fail(`${path} has unsupported Oracle type ${column.type}`);
  }
}

function validateCharacterLength(value, column, path) {
  const length = column.charUsed === "B" ? new TextEncoder().encode(value).length : Array.from(value).length;
  const maximum = column.charUsed === "B" ? (column.dataLength ?? column.length) : column.length;
  if (Number.isInteger(maximum) && length > maximum) {
    fail(`${path} exceeds VARCHAR2/CHAR(${maximum} ${column.charUsed === "B" ? "bytes" : "characters"})`);
  }
}

function normalizeNumber(value, column, path) {
  if (!value || typeof value !== "object" || value.type !== "number" || typeof value.value !== "string") {
    fail(`${path} must be {type:'number', value:canonicalDecimal} or null`);
  }
  const decimal = value.value;
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/.test(decimal) || decimal === "-0") {
    fail(`${path} must use canonical decimal notation without exponents, redundant zeros, or negative zero`);
  }
  const [whole, fraction = ""] = decimal.replace(/^-/, "").split(".");
  const integerDigits = whole.replace(/^0+/, "").length;
  const precision = column.precision;
  const scale = column.scale ?? 0;
  if (Number.isInteger(precision)) {
    if (scale >= 0 && (fraction.length > scale || integerDigits > precision - scale)) {
      fail(`${path} exceeds NUMBER(${precision},${scale})`);
    }
    if (scale < 0 && (fraction.length > 0 || integerDigits > precision - scale || !whole.endsWith("0".repeat(-scale)))) {
      fail(`${path} exceeds NUMBER(${precision},${scale})`);
    }
  }
  return { type: "number", value: decimal };
}

function normalizeDate(value, path) {
  if (!value || typeof value !== "object" || value.type !== "date" || typeof value.value !== "string") {
    fail(`${path} must be {type:'date', value:'YYYY-MM-DDTHH:mm:ss'} or null`);
  }
  validateDateTime(value.value, false, path);
  return { type: "date", value: value.value };
}

function normalizeTimestamp(value, column, path) {
  if (!value || typeof value !== "object" || value.type !== "timestamp" || typeof value.value !== "string") {
    fail(`${path} must be a timestamp wrapper or null`);
  }
  if (value.precision !== column.precision) fail(`${path}.precision must equal metadata precision ${column.precision}`);
  validateDateTime(value.value, true, path, column.precision);
  return { type: "timestamp", precision: column.precision, value: value.value };
}

function validateDateTime(value, timestamp, path, precision = 0) {
  const fraction = timestamp && precision > 0 ? `\\.(\\d{${precision}})` : "";
  const pattern = new RegExp(`^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2}):(\\d{2})${fraction}$`);
  const match = value.match(pattern);
  if (!match) fail(`${path} has an invalid NLS-independent ${timestamp ? "TIMESTAMP" : "DATE"} value`);
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59) {
    fail(`${path} has an out-of-range date/time component`);
  }
  if (timestamp && precision === 0 && value.includes(".")) fail(`${path} must omit fractional seconds at precision 0`);
}

function makeExpectedRow(table, action, desired, actor, markers) {
  const expected = { ...desired };
  if (table === "DSH_MENU") {
    if (action === "INSERT") {
      expected.CREATED_BY = actor.name;
      expected.CREATED_AT = { type: "timestamp", precision: 6, value: markers.timestamp };
      expected.UPDATED_BY = null;
      expected.UPDATED_AT = null;
    } else {
      expected.UPDATED_BY = actor.name;
      expected.UPDATED_AT = { type: "timestamp", precision: 6, value: markers.timestamp };
    }
  }
  return expected;
}

function compareOperations(left, right) {
  const rank = left.definition.rank - right.definition.rank;
  if (rank !== 0) return rank;
  const table = left.table.localeCompare(right.table, "en");
  return table || left.primaryKeyValue.localeCompare(right.primaryKeyValue, "en");
}

function collectParentLocks(operations) {
  const newRows = new Set(
    operations
      .filter((operation) => operation.action === "INSERT")
      .map((operation) => `${operation.table}\u0000${oracleKey(operation.primaryKeyValue)}`),
  );
  const locks = new Map();
  for (const operation of operations) {
    if (operation.action !== "INSERT") continue;
    for (const [childColumn, [parentTable, parentKey]] of Object.entries(operation.definition.parentColumns)) {
      const parentValue = getStringValue(operation.desired[childColumn]);
      if (parentValue === null) fail(`${operation.table}.${childColumn} cannot be null`);
      if (newRows.has(`${parentTable}\u0000${oracleKey(parentValue)}`)) continue;
      const key = `${parentTable}\u0000${oracleKey(parentValue)}`;
      locks.set(key, { table: parentTable, primaryKey: parentKey, value: parentValue });
    }
  }
  return [...locks.values()].sort((left, right) => {
    const table = left.table.localeCompare(right.table, "en");
    return table || left.value.localeCompare(right.value, "en");
  });
}

function buildApplySql({ identity, actor, databaseCharacterSet, operations, parentLocks, packageId, markers }) {
  const declarations = [
    "  l_change_id VARCHAR2(36);",
    "  l_guid RAW(16);",
    "  l_transaction_timestamp TIMESTAMP(6);",
    "  l_parent_key VARCHAR2(50);",
    "  l_menu_id VARCHAR2(50);",
    "  l_audit_id NUMBER;",
    "  l_audit_table VARCHAR2(30);",
    "  l_audit_record_id VARCHAR2(50);",
    "  l_audit_action VARCHAR2(10);",
    "  l_audit_old_read CLOB;",
    "  l_audit_new_read CLOB;",
    "  l_audit_changed_by VARCHAR2(50);",
    "  l_audit_changed_at TIMESTAMP(6);",
    "  l_database_charset VARCHAR2(128);",
  ];
  const setup = [];
  const body = [];
  const cleanup = [];

  operations.forEach((operation, index) => {
    operation.metadataColumns.forEach((column, columnIndex) => {
      declarations.push(`  r${index}_${columnIndex} MONITORING.${operation.table}.${column.name}%TYPE;`);
      declarations.push(`  v${index}_${columnIndex} MONITORING.${operation.table}.${column.name}%TYPE;`);
      if (column.type === "CLOB") {
        if (operation.action === "UPDATE" && operation.baseline[column.name]?.type === "clob") {
          declarations.push(`  b${index}_${columnIndex} CLOB;`);
          setup.push(`  DBMS_LOB.CREATETEMPORARY(b${index}_${columnIndex}, TRUE);`);
          setup.push(...emitAppendText(`b${index}_${columnIndex}`, operation.baseline[column.name].value));
          cleanup.push(`  DBMS_LOB.FREETEMPORARY(b${index}_${columnIndex});`);
        }
        if (operation.desired[column.name]?.type === "clob") {
          declarations.push(`  d${index}_${columnIndex} CLOB;`);
          setup.push(`  DBMS_LOB.CREATETEMPORARY(d${index}_${columnIndex}, TRUE);`);
          setup.push(...emitAppendText(`d${index}_${columnIndex}`, operation.desired[column.name].value));
          cleanup.push(`  DBMS_LOB.FREETEMPORARY(d${index}_${columnIndex});`);
        }
      }
    });
    declarations.push(`  ao${index} CLOB;`);
    declarations.push(`  an${index} CLOB;`);
    declarations.push(`  l_audit_id_${index} NUMBER;`);
    if (operation.action === "UPDATE") {
      cleanup.push(`  DBMS_LOB.FREETEMPORARY(ao${index});`);
    }
    cleanup.push(`  DBMS_LOB.FREETEMPORARY(an${index});`);
  });

  declarations.push("");
  declarations.push("  PROCEDURE append_text(p_lob IN OUT NOCOPY CLOB, p_text IN VARCHAR2) IS");
  declarations.push("  BEGIN");
  declarations.push("    IF p_text IS NOT NULL THEN DBMS_LOB.WRITEAPPEND(p_lob, LENGTH2(p_text), p_text); END IF;");
  declarations.push("  END;");
  declarations.push("");
  declarations.push("  FUNCTION json_escape(p_text IN VARCHAR2) RETURN VARCHAR2 IS");
  declarations.push("    l_result VARCHAR2(32767) := '';");
  declarations.push("    l_char VARCHAR2(4);");
  declarations.push("    l_digits CONSTANT VARCHAR2(16) := '0123456789abcdef';");
  declarations.push("    l_code PLS_INTEGER;");
  declarations.push("  BEGIN");
  declarations.push("    FOR i IN 1 .. NVL(LENGTH(p_text), 0) LOOP");
  declarations.push("      l_char := SUBSTR(p_text, i, 1);");
  declarations.push("      l_code := ASCII(l_char);");
  declarations.push("      CASE l_char");
  declarations.push("        WHEN '\"' THEN l_result := l_result || '\\\"';");
  declarations.push("        WHEN '\\' THEN l_result := l_result || '\\\\';");
  declarations.push("        WHEN CHR(8) THEN l_result := l_result || '\\b';");
  declarations.push("        WHEN CHR(9) THEN l_result := l_result || '\\t';");
  declarations.push("        WHEN CHR(10) THEN l_result := l_result || '\\n';");
  declarations.push("        WHEN CHR(12) THEN l_result := l_result || '\\f';");
  declarations.push("        WHEN CHR(13) THEN l_result := l_result || '\\r';");
  declarations.push("        ELSE");
  declarations.push("          IF l_code < 32 OR l_code = 127 THEN");
  declarations.push(
    "            l_result := l_result || '\\u00' || SUBSTR(l_digits, TRUNC(l_code / 16) + 1, 1) || SUBSTR(l_digits, MOD(l_code, 16) + 1, 1);",
  );
  declarations.push("          ELSE");
  declarations.push("            l_result := l_result || l_char;");
  declarations.push("          END IF;");
  declarations.push("      END CASE;");
  declarations.push("    END LOOP;");
  declarations.push("    RETURN l_result;");
  declarations.push("  END;");

  body.push("  l_guid := SYS_GUID();");
  body.push(
    "  l_change_id := LOWER(SUBSTR(RAWTOHEX(l_guid), 1, 8) || '-' || SUBSTR(RAWTOHEX(l_guid), 9, 4) || '-' || SUBSTR(RAWTOHEX(l_guid), 13, 4) || '-' || SUBSTR(RAWTOHEX(l_guid), 17, 4) || '-' || SUBSTR(RAWTOHEX(l_guid), 21, 12));",
  );
  body.push("  l_transaction_timestamp := CAST(SYSTIMESTAMP AS TIMESTAMP);");
  body.push("");
  body.push(
    "  IF NVL(UPPER(TRIM(SYS_CONTEXT('USERENV', 'DB_NAME'))), '<NULL>') <> " + sqlTextExpr(identity.database.toUpperCase()) + " THEN",
  );
  body.push("    RAISE_APPLICATION_ERROR(-20001, 'Monitoring package target database mismatch');");
  body.push("  END IF;");
  body.push(
    "  IF NVL(UPPER(TRIM(SYS_CONTEXT('USERENV', 'SERVICE_NAME'))), '<NULL>') <> " + sqlTextExpr(identity.service.toUpperCase()) + " THEN",
  );
  body.push("    RAISE_APPLICATION_ERROR(-20002, 'Monitoring package target service mismatch');");
  body.push("  END IF;");
  body.push(
    "  IF NVL(UPPER(TRIM(SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA'))), '<NULL>') <> " + sqlTextExpr(identity.schema.toUpperCase()) + " THEN",
  );
  body.push("    RAISE_APPLICATION_ERROR(-20003, 'Monitoring package target schema mismatch');");
  body.push("  END IF;");
  body.push(
    "  IF NVL(UPPER(TRIM(SYS_CONTEXT('USERENV', 'SESSION_USER'))), '<NULL>') <> " + sqlTextExpr(identity.username.toUpperCase()) + " THEN",
  );
  body.push("    RAISE_APPLICATION_ERROR(-20004, 'Monitoring package target username mismatch');");
  body.push("  END IF;");
  if (databaseCharacterSet) {
    body.push("  SELECT VALUE INTO l_database_charset FROM NLS_DATABASE_PARAMETERS WHERE PARAMETER = 'NLS_CHARACTERSET';");
    body.push(`  IF UPPER(l_database_charset) <> ${sqlTextExpr(databaseCharacterSet)} THEN`);
    body.push("    RAISE_APPLICATION_ERROR(-20005, 'Monitoring package target database character set mismatch');");
    body.push("  END IF;");
  }
  body.push("");
  body.push(...setup);
  body.push("");
  body.push("  -- Lock existing rows and referenced parents in deterministic table/key order.");
  const lockItems = [
    ...operations.filter((operation) => operation.action === "UPDATE").map((operation) => ({ type: "operation", operation })),
    ...parentLocks.map((parent) => ({ type: "parent", parent })),
  ].sort((left, right) => {
    const leftTable = left.type === "operation" ? left.operation.table : left.parent.table;
    const rightTable = right.type === "operation" ? right.operation.table : right.parent.table;
    const leftValue = left.type === "operation" ? left.operation.primaryKeyValue : left.parent.value;
    const rightValue = right.type === "operation" ? right.operation.primaryKeyValue : right.parent.value;
    return leftTable.localeCompare(rightTable, "en") || leftValue.localeCompare(rightValue, "en");
  });
  for (const lockItem of lockItems) {
    if (lockItem.type === "parent") {
      body.push(...emitParentLock(lockItem.parent));
    } else {
      body.push(...emitUpdateLock(lockItem.operation, operations.indexOf(lockItem.operation)));
    }
  }
  if (lockItems.length === 0) body.push("  NULL;");
  body.push("");
  body.push("  -- A reviewed INSERT remains an INSERT even if its key has since appeared.");
  operations.forEach((operation) => {
    if (operation.action === "INSERT") body.push(...emitInsertCollisionCheck(operation));
  });
  body.push("");
  body.push("  -- Apply reviewed operations parent first; UPDATE/INSERT intent is never inferred from row existence.");
  operations.forEach((operation, index) => body.push(...emitDml(operation, index, actor)));
  body.push("");
  body.push("  -- Read back every full row on this transaction before writing history.");
  operations.forEach((operation, index) => body.push(...emitReadback(operation, index)));
  body.push("");
  body.push("  -- Record one complete typed audit envelope for every affected row.");
  operations.forEach((operation, index) => body.push(...emitAudit(operation, index, actor, packageId, operations.length, markers)));
  body.push("");
  body.push("  -- Release temporary CLOBs before the single commit.");
  body.push(...cleanup);
  body.push("  COMMIT;");
  body.push("  DBMS_OUTPUT.PUT_LINE('MONITORING_CHANGE_ID=' || l_change_id);");
  operations.forEach((_, index) => {
    body.push(`  DBMS_OUTPUT.PUT_LINE('MONITORING_AUDIT_ID=' || TO_CHAR(l_audit_id_${index}));`);
  });
  body.push("EXCEPTION");
  body.push("  WHEN OTHERS THEN");
  body.push("    ROLLBACK;");
  body.push("    BEGIN");
  body.push(
    ...cleanup.map(
      (line) =>
        `      BEGIN ${line.trim().replace(/^DBMS_LOB\.FREETEMPORARY\(([^)]+)\);$/, "DBMS_LOB.FREETEMPORARY($1);")} EXCEPTION WHEN OTHERS THEN NULL; END;`,
    ),
  );
  body.push("    EXCEPTION WHEN OTHERS THEN NULL; END;");
  body.push("    RAISE;");

  return [
    "-- AD Tools Monitoring Query guarded package",
    `-- Package ID: ${packageId}`,
    "-- Run the complete script in one Oracle session. This script performs no DDL or DELETE.",
    "SET DEFINE OFF",
    "SET SERVEROUTPUT ON SIZE UNLIMITED",
    "WHENEVER SQLERROR EXIT SQL.SQLCODE ROLLBACK",
    "DECLARE",
    ...declarations,
    "BEGIN",
    ...body,
    "END;",
    "/",
    "",
  ].join("\n");
}

function emitUpdateLock(operation, index) {
  const lines = [];
  const columns = operation.metadataColumns;
  lines.push(`  BEGIN -- ${operation.table} ${operation.primaryKey} locked baseline check`);
  lines.push(`    SELECT ${columns.map(({ name }) => name).join(", ")}`);
  lines.push(`      INTO ${columns.map((_, columnIndex) => `r${index}_${columnIndex}`).join(", ")}`);
  lines.push(`      FROM MONITORING.${operation.table}`);
  lines.push(
    `     WHERE ${operation.primaryKey} = ${sqlValue(operation.baseline[operation.primaryKey], findColumn(columns, operation.primaryKey))}`,
  );
  lines.push("       FOR UPDATE WAIT 5;");
  lines.push("  EXCEPTION");
  lines.push(
    "    WHEN NO_DATA_FOUND THEN RAISE_APPLICATION_ERROR(-20010, " +
      sqlTextExpr(`Monitoring conflict: original ${operation.table}.${operation.primaryKey} is missing`) +
      ");",
  );
  lines.push("  END;");
  lines.push(
    `  IF NOT (${columns.map((column, columnIndex) => compareSqlValue(`r${index}_${columnIndex}`, operation.baseline[column.name], column, clobVariable("b", index, columnIndex))).join(" AND ")}) THEN`,
  );
  lines.push(
    "    RAISE_APPLICATION_ERROR(-20011, " +
      sqlTextExpr(`Monitoring conflict: full baseline changed for ${operation.table}.${operation.primaryKey}`) +
      ");",
  );
  lines.push("  END IF;");
  return lines;
}

function emitParentLock(parent) {
  return [
    `  BEGIN -- referenced ${parent.table}.${parent.primaryKey}`,
    `    SELECT ${parent.primaryKey} INTO l_parent_key FROM MONITORING.${parent.table}`,
    `     WHERE ${parent.primaryKey} = ${sqlTextExpr(parent.value)} FOR UPDATE WAIT 5;`,
    "  EXCEPTION",
    `    WHEN NO_DATA_FOUND THEN RAISE_APPLICATION_ERROR(-20012, ${sqlTextExpr(`Monitoring conflict: referenced parent ${parent.table}.${parent.primaryKey} is missing`)});`,
    "  END;",
  ];
}

function emitInsertCollisionCheck(operation) {
  return [
    "  DECLARE l_existing_count PLS_INTEGER; BEGIN",
    `    SELECT COUNT(*) INTO l_existing_count FROM MONITORING.${operation.table}`,
    `     WHERE ${operation.primaryKey} = ${sqlValue(operation.desired[operation.primaryKey], findColumn(operation.metadataColumns, operation.primaryKey))};`,
    "    IF l_existing_count <> 0 THEN",
    `      RAISE_APPLICATION_ERROR(-20013, ${sqlTextExpr(`Monitoring conflict: new ${operation.table}.${operation.primaryKey} already exists`)});`,
    "    END IF;",
    "  END;",
  ];
}

function emitDml(operation, index, actor) {
  const columns = operation.metadataColumns;
  const lines = [];
  if (operation.action === "INSERT") {
    lines.push(`  INSERT INTO MONITORING.${operation.table} (${columns.map(({ name }) => name).join(", ")})`);
    lines.push(`  VALUES (${columns.map((column, columnIndex) => insertValue(operation, column, index, columnIndex, actor)).join(", ")});`);
  } else {
    const assignments = operation.changedColumns.map((name) => {
      const columnIndex = columns.findIndex((column) => column.name === name);
      return `    ${name} = ${sqlValue(operation.desired[name], columns[columnIndex], clobVariable("d", index, columnIndex))}`;
    });
    if (operation.table === "DSH_MENU") {
      assignments.push(`    UPDATED_BY = ${sqlTextExpr(actor.name)}`);
      assignments.push("    UPDATED_AT = l_transaction_timestamp");
    }
    lines.push(`  UPDATE MONITORING.${operation.table}`);
    lines.push("     SET " + assignments.join(",\n"));
    lines.push(
      `   WHERE ${operation.primaryKey} = ${sqlValue(operation.desired[operation.primaryKey], findColumn(columns, operation.primaryKey))};`,
    );
  }
  lines.push("  IF SQL%ROWCOUNT <> 1 THEN");
  lines.push(
    `    RAISE_APPLICATION_ERROR(-20014, ${sqlTextExpr(`Monitoring ${operation.action} did not affect exactly one ${operation.table} row`)});`,
  );
  lines.push("  END IF;");
  return lines;
}

function insertValue(operation, column, operationIndex, columnIndex, actor) {
  if (operation.table === "DSH_MENU") {
    if (column.name === "CREATED_BY") return sqlTextExpr(actor.name);
    if (column.name === "CREATED_AT") return "l_transaction_timestamp";
    if (column.name === "UPDATED_BY" || column.name === "UPDATED_AT") return "NULL";
  }
  return sqlValue(operation.desired[column.name], column, clobVariable("d", operationIndex, columnIndex));
}

function emitReadback(operation, index) {
  const columns = operation.metadataColumns;
  const lines = [];
  lines.push(`  SELECT ${columns.map(({ name }) => name).join(", ")}`);
  lines.push(`    INTO ${columns.map((_, columnIndex) => `v${index}_${columnIndex}`).join(", ")}`);
  lines.push(`    FROM MONITORING.${operation.table}`);
  lines.push(
    `   WHERE ${operation.primaryKey} = ${sqlValue(operation.desired[operation.primaryKey], findColumn(columns, operation.primaryKey))};`,
  );
  lines.push(
    "  IF NOT (" +
      columns
        .map((column, columnIndex) =>
          compareSqlValue(
            `v${index}_${columnIndex}`,
            operation.expectedRow[column.name],
            column,
            clobVariable("d", index, columnIndex),
            "l_transaction_timestamp",
          ),
        )
        .join(" AND ") +
      ") THEN",
  );
  lines.push(
    `    RAISE_APPLICATION_ERROR(-20015, ${sqlTextExpr(`Monitoring readback mismatch for ${operation.table}.${operation.primaryKey}`)});`,
  );
  lines.push("  END IF;");
  return lines;
}

function emitAudit(operation, index, actor, packageId, operationCount, markers) {
  const lines = [];
  const keyColumn = findColumn(operation.metadataColumns, operation.primaryKey);
  const menuId = menuIdExpression(operation);
  lines.push(...menuId.setup);
  lines.push(`  DBMS_LOB.CREATETEMPORARY(an${index}, TRUE);`);
  lines.push(
    ...emitDynamicJsonAppend(`an${index}`, makeAuditEnvelope(operation, "new", actor, packageId, operationCount, markers), markers),
  );
  if (operation.action === "UPDATE") {
    lines.push(`  DBMS_LOB.CREATETEMPORARY(ao${index}, TRUE);`);
    lines.push(
      ...emitDynamicJsonAppend(`ao${index}`, makeAuditEnvelope(operation, "old", actor, packageId, operationCount, markers), markers),
    );
  }
  lines.push(`  INSERT INTO MONITORING.${AUDIT_TABLE_NAME}`);
  lines.push("    (TABLE_NAME, RECORD_ID, ACTION, OLD_VALUE, NEW_VALUE, CHANGED_BY, CHANGED_AT)");
  lines.push(
    `  VALUES (${sqlTextExpr(operation.table)}, ${sqlValue(operation.desired[operation.primaryKey], keyColumn)}, ${sqlTextExpr(operation.action)}, ${operation.action === "INSERT" ? "NULL" : `ao${index}`}, an${index}, ${sqlTextExpr(actor.name)}, l_transaction_timestamp)`,
  );
  lines.push("  RETURNING AUDIT_ID INTO l_audit_id;");
  lines.push(`  l_audit_id_${index} := l_audit_id;`);
  lines.push(
    "  IF SQL%ROWCOUNT <> 1 THEN RAISE_APPLICATION_ERROR(-20016, " +
      sqlTextExpr("Monitoring audit insert did not affect exactly one row") +
      "); END IF;",
  );
  lines.push("  SELECT TABLE_NAME, RECORD_ID, ACTION, OLD_VALUE, NEW_VALUE, CHANGED_BY, CHANGED_AT");
  lines.push(
    "    INTO l_audit_table, l_audit_record_id, l_audit_action, l_audit_old_read, l_audit_new_read, l_audit_changed_by, l_audit_changed_at",
  );
  lines.push(`    FROM MONITORING.${AUDIT_TABLE_NAME} WHERE AUDIT_ID = l_audit_id;`);
  lines.push(
    `  IF l_audit_table IS NULL OR l_audit_table <> ${sqlTextExpr(operation.table)} OR l_audit_record_id IS NULL OR l_audit_record_id <> ${sqlValue(operation.desired[operation.primaryKey], keyColumn)} OR l_audit_action IS NULL OR l_audit_action <> ${sqlTextExpr(operation.action)} OR l_audit_changed_by IS NULL OR l_audit_changed_by <> ${sqlTextExpr(actor.name)} OR l_audit_changed_at IS NULL OR l_audit_changed_at <> l_transaction_timestamp THEN`,
  );
  lines.push("    RAISE_APPLICATION_ERROR(-20017, " + sqlTextExpr("Monitoring audit scalar readback mismatch") + ");");
  lines.push("  END IF;");
  if (operation.action === "INSERT") {
    lines.push(
      "  IF l_audit_old_read IS NOT NULL THEN RAISE_APPLICATION_ERROR(-20018, " +
        sqlTextExpr("Monitoring INSERT audit old value must be SQL NULL") +
        "); END IF;",
    );
  } else {
    lines.push(`  IF l_audit_old_read IS NULL OR DBMS_LOB.COMPARE(l_audit_old_read, ao${index}) <> 0 THEN`);
    lines.push("    RAISE_APPLICATION_ERROR(-20019, " + sqlTextExpr("Monitoring audit old-value readback mismatch") + ");");
    lines.push("  END IF;");
  }
  lines.push(`  IF l_audit_new_read IS NULL OR DBMS_LOB.COMPARE(l_audit_new_read, an${index}) <> 0 THEN`);
  lines.push("    RAISE_APPLICATION_ERROR(-20020, " + sqlTextExpr("Monitoring audit new-value readback mismatch") + ");");
  lines.push("  END IF;");
  return lines;
}

function menuIdExpression(operation) {
  if (operation.table === "DSH_MENU") return { setup: [`  l_menu_id := ${sqlTextExpr(getStringValue(operation.desired.MENU_ID))};`] };
  if (operation.table === "DSH_SUMMARY_GROUP" || operation.table === "DSH_DETAIL_TABLE") {
    return { setup: [`  l_menu_id := ${sqlTextExpr(getStringValue(operation.desired.MENU_ID))};`] };
  }
  if (operation.table === "DSH_SUMMARY_FIELD") {
    return {
      setup: [
        `  SELECT MENU_ID INTO l_menu_id FROM MONITORING.DSH_SUMMARY_GROUP WHERE GROUP_ID = ${sqlTextExpr(getStringValue(operation.desired.GROUP_ID))};`,
      ],
    };
  }
  return {
    setup: [
      `  SELECT MENU_ID INTO l_menu_id FROM MONITORING.DSH_DETAIL_TABLE WHERE TABLE_ID = ${sqlTextExpr(getStringValue(operation.desired.TABLE_ID))};`,
    ],
  };
}

function makeAuditEnvelope(operation, rowKind, actor, packageId, operationCount, markers) {
  const rawRow = rowKind === "old" ? operation.baseline : operation.expectedRow;
  const row = {};
  for (const { name } of operation.metadataColumns) {
    if (Object.hasOwn(rawRow, name)) row[name] = rawRow[name];
  }
  const menuId = ["DSH_MENU", "DSH_SUMMARY_GROUP", "DSH_DETAIL_TABLE"].includes(operation.table)
    ? getStringValue(operation.desired.MENU_ID)
    : markers.menuId;
  return JSON.stringify({
    source: SOURCE_NAME,
    version: 1,
    changeId: markers.changeId,
    requestId: packageId,
    operationId: operation.operationId,
    menuId,
    operationCount,
    actorSource: actor.source,
    databaseUsername: actor.databaseUsername,
    row,
  });
}

function emitDynamicJsonAppend(lob, template, markers) {
  const parts = [];
  const markerEntries = [
    [markers.changeId, "l_change_id", false],
    [markers.menuId, "json_escape(l_menu_id)", true],
    [markers.timestamp, "TO_CHAR(l_transaction_timestamp, 'YYYY-MM-DD\"T\"HH24:MI:SS.FF6')", true],
  ].filter(([marker]) => template.includes(marker));
  let remainder = template;
  while (remainder.length > 0) {
    let next = null;
    for (const item of markerEntries) {
      const at = remainder.indexOf(item[0]);
      if (at >= 0 && (!next || at < next.at)) next = { at, item };
    }
    if (!next) {
      parts.push(...emitAppendText(lob, remainder));
      break;
    }
    if (next.at > 0) parts.push(...emitAppendText(lob, remainder.slice(0, next.at)));
    parts.push(`  append_text(${lob}, ${next.item[1]});`);
    remainder = remainder.slice(next.at + next.item[0].length);
  }
  return parts;
}

function emitAppendText(lob, text) {
  return chunkUtf8(text, CLOB_CHUNK_UTF8_LIMIT).map((chunk) => `  append_text(${lob}, ${sqlTextExpr(chunk)});`);
}

function chunkUtf8(text, maxBytes) {
  if (!text) return [];
  const chunks = [];
  let current = "";
  let encodedCost = 0;
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    const isControl = codePoint < 32 || codePoint === 127;
    const escapedBytes = isControl ? 8 : new TextEncoder().encode(character).length * (character === "'" ? 2 : 1);
    if (current && encodedCost + escapedBytes > maxBytes) {
      chunks.push(current);
      current = "";
      encodedCost = 0;
    }
    current += character;
    encodedCost += escapedBytes;
  }
  if (current) chunks.push(current);
  return chunks;
}

function buildVerifySql(operations) {
  const lines = ["-- Read-only package verification. Run after apply.sql against the same source identity.", "SET DEFINE OFF"];
  for (const operation of operations) {
    const columns =
      operation.action === "INSERT"
        ? [operation.primaryKey, ...operation.metadataColumns.map(({ name }) => name).filter((name) => name !== operation.primaryKey)]
        : [
            ...new Set([
              operation.primaryKey,
              ...operation.changedColumns,
              ...(operation.table === "DSH_MENU" ? ["UPDATED_BY", "UPDATED_AT"] : []),
            ]),
          ];
    if (!columns.includes(operation.primaryKey)) columns.unshift(operation.primaryKey);
    lines.push("");
    lines.push(`-- ${operation.action} ${operation.table}.${operation.primaryKey}=${printableKey(operation.primaryKeyValue)}`);
    lines.push(`SELECT ${columns.join(", ")}`);
    lines.push(`  FROM MONITORING.${operation.table}`);
    lines.push(
      ` WHERE ${operation.primaryKey} = ${sqlValue(operation.desired[operation.primaryKey], findColumn(operation.metadataColumns, operation.primaryKey))};`,
    );
  }
  return lines.join("\n") + "\n";
}

function toChangeRecord(operation) {
  return {
    operationId: operation.operationId,
    table: operation.table,
    action: operation.action,
    primaryKey: { column: operation.primaryKey, value: operation.primaryKeyValue },
    baseline: operation.baseline,
    desired: operation.desired,
    generatedFields:
      operation.table === "DSH_MENU"
        ? operation.action === "INSERT"
          ? { CREATED_BY: { source: "actor.name" }, CREATED_AT: { expression: "SYSTIMESTAMP" } }
          : { UPDATED_BY: { source: "actor.name" }, UPDATED_AT: { expression: "SYSTIMESTAMP" } }
        : {},
    changedColumns: operation.changedColumns,
  };
}

function compareSqlValue(actualExpression, expected, column, clobName, generatedTimestamp) {
  if (expected === null) return `${actualExpression} IS NULL`;
  if (column.type === "CLOB")
    return `${actualExpression} IS NOT NULL AND ${clobName} IS NOT NULL AND DBMS_LOB.COMPARE(${actualExpression}, ${clobName}) = 0`;
  if (generatedTimestamp && isGeneratedTimestamp(expected))
    return `${actualExpression} IS NOT NULL AND ${actualExpression} = ${generatedTimestamp}`;
  return `${actualExpression} IS NOT NULL AND ${actualExpression} = ${sqlValue(expected, column)}`;
}

function sqlValue(value, column, clobName) {
  if (value === null) return "NULL";
  switch (column.type) {
    case "VARCHAR2":
    case "CHAR":
      return sqlTextExpr(value);
    case "NUMBER":
      return value.value;
    case "DATE":
      return `TO_DATE(${sqlTextExpr(value.value)}, 'YYYY-MM-DD"T"HH24:MI:SS')`;
    case "TIMESTAMP": {
      const format = value.precision === 0 ? 'YYYY-MM-DD"T"HH24:MI:SS' : `YYYY-MM-DD"T"HH24:MI:SS.FF${value.precision}`;
      return `TO_TIMESTAMP(${sqlTextExpr(value.value)}, ${sqlTextExpr(format)})`;
    }
    case "CLOB":
      if (!clobName) fail(`internal serializer error: missing CLOB variable for ${column.name}`);
      return clobName;
    default:
      return fail(`internal serializer error: unsupported type ${column.type}`);
  }
}

function sqlTextExpr(value) {
  if (value === null || value === undefined) return "NULL";
  if (value.length === 0) return "''";
  const parts = [];
  let literal = "";
  const flush = () => {
    if (literal) parts.push(`'${literal.replace(/'/g, "''")}'`);
    literal = "";
  };
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint < 32 || codePoint === 127) {
      flush();
      parts.push(`CHR(${codePoint})`);
    } else {
      literal += character;
    }
  }
  flush();
  return parts.join(" || ");
}

function getStringValue(value) {
  return typeof value === "string" ? value : (value?.value ?? null);
}

function findColumn(columns, name) {
  const column = columns.find((item) => item.name === name);
  if (!column) fail(`internal serializer error: missing column ${name}`);
  return column;
}

function clobVariable(prefix, operationIndex, columnIndex) {
  return `${prefix}${operationIndex}_${columnIndex}`;
}

function isGeneratedTimestamp(value) {
  return value && value.type === "timestamp" && typeof value.value === "string" && value.value.startsWith("__MQ_TIMESTAMP_");
}

function rowsEqualKey(left, right) {
  return valuesEqual(left, right);
}

function valuesEqual(left, right) {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
  return left.type === right.type && left.value === right.value && left.precision === right.precision;
}

function normalizeColumnType(column) {
  let type = String(pick(column, ["type", "dataType", "data_type", "DATA_TYPE"]) ?? "").toUpperCase();
  type = type.replace(/\s*\([^)]*\)/, "").trim();
  if (type === "TIMESTAMP WITH TIME ZONE" || type === "TIMESTAMP WITH LOCAL TIME ZONE") return type;
  if (!["VARCHAR2", "CHAR", "NUMBER", "DATE", "TIMESTAMP", "CLOB"].includes(type))
    fail(`metadata contains unsupported type ${type || "(empty)"}`);
  return type;
}

function parseTypePrecision(column) {
  const source = String(pick(column, ["type", "dataType", "data_type", "DATA_TYPE"]) ?? "");
  const match = source.toUpperCase().match(/^TIMESTAMP\s*\((\d+)\)/);
  return match ? Number(match[1]) : undefined;
}

function normalizeNullable(value) {
  if (typeof value === "boolean") return value;
  if (value === "Y" || value === "y") return true;
  if (value === "N" || value === "n") return false;
  fail("metadata column nullable must be a boolean or Oracle Y/N flag");
}

function normalizeCharUsed(value) {
  if (value === undefined || value === null || value === "") return null;
  const normalized = String(value).toUpperCase();
  if (normalized === "BYTE") return "B";
  if (normalized === "CHAR") return "C";
  if (normalized !== "B" && normalized !== "C") fail(`unsupported metadata length semantics ${value}`);
  return normalized;
}

function pick(object, keys) {
  for (const key of keys) {
    if (Object.hasOwn(object, key)) return object[key];
  }
  return undefined;
}

function optionalInteger(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function sameOracleIdentifier(left, right) {
  return String(left).trim().toUpperCase() === String(right).trim().toUpperCase();
}

function oracleKey(value) {
  return String(value);
}

function printableKey(value) {
  return JSON.stringify(value);
}

function validateRevision(revision) {
  if (typeof revision === "string" && revision.trim().length > 0) return revision;
  if (Number.isSafeInteger(revision) && revision >= 0) return revision;
  fail("revision must be a non-empty string or non-negative safe integer");
}

function optionalIsoTimestamp(value, path) {
  if (value === undefined || value === null || value === "") return null;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    fail(`${path} must be an ISO-8601 timestamp with an explicit timezone`);
  }
  return value;
}

function validateUnicodeSupport(identity, actor, operations, databaseCharacterSet) {
  const values = [identity, actor, operations];
  if (values.some(containsNonAscii)) {
    if (databaseCharacterSet !== "AL32UTF8") {
      fail("non-ASCII package values require identity.characterSet or metadata.characterSet AL32UTF8");
    }
  }
}

function containsNonAscii(value) {
  if (typeof value === "string") return Array.from(value).some((character) => character.codePointAt(0) > 0x7f);
  if (Array.isArray(value)) return value.some(containsNonAscii);
  if (!value || typeof value !== "object") return false;
  return Object.values(value).some(containsNonAscii);
}

function requireText(value, path) {
  if (typeof value !== "string" || value.trim().length === 0) fail(`${path} must be a non-empty string`);
  return value;
}

function createUuid() {
  if (!globalThis.crypto?.getRandomValues) fail("cryptographic randomness is unavailable");
  if (globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID().toLowerCase();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function createMarkers(packageId, operations) {
  let suffix = packageId.replace(/-/g, "").toUpperCase();
  for (;;) {
    const markers = {
      changeId: `__MQ_CHANGE_${suffix}__`,
      menuId: `__MQ_MENU_${suffix}__`,
      timestamp: `__MQ_TIMESTAMP_${suffix}__`,
    };
    const values = operations.flatMap((operation) =>
      Object.values(operation ?? {}).flatMap((row) => {
        if (!row || typeof row !== "object" || Array.isArray(row)) return [];
        return Object.values(row)
          .map((value) => (typeof value === "string" ? value : value?.value))
          .filter((value) => typeof value === "string");
      }),
    );
    if (!values.some((value) => Object.values(markers).some((marker) => value.includes(marker)))) return markers;
    suffix += "X";
  }
}

async function sha256(text) {
  if (!globalThis.crypto?.subtle || typeof TextEncoder === "undefined") fail("Web Crypto SHA-256 is unavailable");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fail(message) {
  throw new Error(`Monitoring Query package: ${message}`);
}
