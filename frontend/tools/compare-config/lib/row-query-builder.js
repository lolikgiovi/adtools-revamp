const ORACLE_IN_LIST_LIMIT = 1000;

function hasControlCharacter(value) {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });
}

function quoteIdentifier(identifier) {
  const value = String(identifier ?? "");
  if (!value || hasControlCharacter(value)) {
    throw new Error("A table or column name cannot be represented safely in SQL.");
  }
  return `"${value.replaceAll('"', '""')}"`;
}

function formatValue(value) {
  if (value === null) {
    throw new Error("A key value is NULL, so it cannot identify one row safely. Choose non-null primary key fields.");
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("A key contains a number that cannot be represented in SQL.");
    const normalized = Object.is(value, -0) ? "0" : String(value);
    return { sql: normalized, signature: `number:${normalized}` };
  }

  if (typeof value === "string") {
    if (hasControlCharacter(value)) {
      throw new Error("A key contains a control character that cannot be represented in SQL.");
    }
    return {
      sql: `'${value.replaceAll("'", "''")}'`,
      signature: `string:${value.length}:${value}`,
    };
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const timestamp = value.toISOString().replace("T", " ").replace("Z", "");
    return {
      sql: `TO_TIMESTAMP('${timestamp}', 'YYYY-MM-DD HH24:MI:SS.FF3')`,
      signature: `date:${timestamp}`,
    };
  }

  throw new Error("A key value has an unsupported type. Check the key fields and compare again.");
}

function findValue(rowData, dataKeys) {
  if (!rowData || typeof rowData !== "object") return { found: false };

  for (const key of dataKeys) {
    if (Object.prototype.hasOwnProperty.call(rowData, key)) {
      return { found: true, value: rowData[key] };
    }
  }

  const normalizedEntries = new Map(Object.keys(rowData).map((key) => [key.toLowerCase(), key]));
  for (const key of dataKeys) {
    const actualKey = normalizedEntries.get(String(key).toLowerCase());
    if (actualKey !== undefined) return { found: true, value: rowData[actualKey] };
  }

  return { found: false };
}

/**
 * Build a read-only Oracle query for differing records present in one table source.
 * @param {Object} result - Compare Config result
 * @param {Object} target - Source metadata with side, table identifiers, and key columns
 * @returns {{query: string|null, rowCount: number, error?: string}}
 */
export function buildOracleRowQuery(result, target) {
  try {
    if (!target?.schema || !target?.table || !Array.isArray(target.keyColumns) || target.keyColumns.length === 0) {
      throw new Error("Select primary key fields and compare by key to generate a row query.");
    }
    if (target.duplicateKeyCount > 0) {
      throw new Error("The selected key fields are not unique in this source. Choose unique primary key fields and compare again.");
    }

    const schema = quoteIdentifier(target.schema);
    const table = quoteIdentifier(target.table);
    const dataField = target.side === "A" ? "env1_data" : "env2_data";
    const differingRows = (result?.rows || []).filter((row) => row.status !== "match");
    const tupleMap = new Map();

    for (const row of differingRows) {
      const rowData = row[dataField];
      if (!rowData) continue;

      const values = target.keyColumns.map((keyColumn) => {
        const found = findValue(rowData, keyColumn.dataKeys || [keyColumn.column]);
        if (!found.found || found.value === undefined) {
          throw new Error(`Could not find key field "${keyColumn.column}" in a differing row. Check the selected key fields.`);
        }
        return { column: quoteIdentifier(keyColumn.column), ...formatValue(found.value) };
      });

      const signature = values.map((value) => value.signature).join("\u0000");
      tupleMap.set(signature, values);
    }

    if (tupleMap.size === 0) return { query: null, rowCount: 0 };

    const tuples = [...tupleMap.values()];
    let predicate;
    if (target.keyColumns.length === 1) {
      const column = quoteIdentifier(target.keyColumns[0].column);
      const nonNullValues = tuples.map(([value]) => value.sql);
      const predicates = [];
      for (let index = 0; index < nonNullValues.length; index += ORACLE_IN_LIST_LIMIT) {
        const values = nonNullValues.slice(index, index + ORACLE_IN_LIST_LIMIT);
        predicates.push(`${column} IN (${values.join(", ")})`);
      }
      predicate = predicates.length === 1 ? predicates[0] : `(${predicates.join("\n  OR ")})`;
    } else {
      predicate = tuples
        .map((values) => {
          return `(${values.map((value) => `${value.column} = ${value.sql}`).join(" AND ")})`;
        })
        .join("\n  OR ");
    }

    return {
      query: `SELECT *\nFROM ${schema}.${table}\nWHERE ${predicate};`,
      rowCount: tuples.length,
    };
  } catch (error) {
    return { query: null, rowCount: 0, error: error.message };
  }
}
