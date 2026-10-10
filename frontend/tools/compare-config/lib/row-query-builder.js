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
 * Differing records grouped the way the panel labels them. Order matches the
 * reading order users get in the pasted predicate list.
 */
const DIFF_GROUPS = [
  { status: "only_in_env1", label: "Only in Source A" },
  { status: "only_in_env2", label: "Only in Source B" },
  { status: "differ", label: "Value differs" },
];

function rowDataForStatus(row) {
  const primary = row.status === "only_in_env2" ? row.env2_data : row.env1_data;
  return primary ?? row.env1_data ?? row.env2_data ?? null;
}

/** Key tuples for one group, deduplicated and in first-seen order. */
function collectTuples(rows, keyColumns) {
  const tupleMap = new Map();

  for (const row of rows) {
    const rowData = rowDataForStatus(row);
    if (!rowData) continue;

    const values = keyColumns.map((keyColumn) => {
      const found = findValue(rowData, keyColumn.dataKeys || [keyColumn.column]);
      if (!found.found || found.value === undefined) {
        throw new Error(`Could not find key field "${keyColumn.column}" in a differing row. Check the selected key fields.`);
      }
      return { column: quoteIdentifier(keyColumn.column), ...formatValue(found.value) };
    });

    const signature = values.map((value) => value.signature).join("\u0000");
    tupleMap.set(signature, values);
  }

  return [...tupleMap.values()];
}

/** One group's predicates: an IN list for a single key, OR'd tuples for a composite key. */
function renderTuplePredicates(tuples, keyColumnCount) {
  if (keyColumnCount === 1) {
    const column = tuples[0][0].column;
    const valueList = tuples.map(([value]) => value.sql);
    const chunks = [];
    for (let index = 0; index < valueList.length; index += ORACLE_IN_LIST_LIMIT) {
      chunks.push(`${column} IN (${valueList.slice(index, index + ORACLE_IN_LIST_LIMIT).join(", ")})`);
    }
    return chunks.length === 1 ? chunks[0] : `(${chunks.join("\n    OR ")})`;
  }

  return tuples.map((values) => `(${values.map((value) => `${value.column} = ${value.sql}`).join(" AND ")})`).join("\n  OR ");
}

/**
 * Build the WHERE predicate list for every differing record of a comparison, grouped and
 * commented by how the record differs. The list carries no SELECT or FROM clause: it is
 * meant to be pasted into the user's own query against either source.
 * @param {Object} result - Compare Config result
 * @param {Object} spec - Key columns ({column, dataKeys}) mapped from the compared key fields
 * @returns {{predicate: string|null, rowCount: number, groups: Array<{label: string, count: number}>, error?: string}}
 */
export function buildDiffPredicate(result, spec) {
  try {
    const keyColumns = spec?.keyColumns;
    if (!Array.isArray(keyColumns) || keyColumns.length === 0) {
      throw new Error("Select primary key fields and compare by key to generate a row query.");
    }
    if (spec.duplicateKeyCount > 0) {
      throw new Error("The selected key fields are not unique. Choose unique primary key fields and compare again.");
    }

    const differingRows = (result?.rows || []).filter((row) => row.status !== "match");
    const groups = [];

    for (const group of DIFF_GROUPS) {
      const tuples = collectTuples(
        differingRows.filter((row) => row.status === group.status),
        keyColumns,
      );
      if (tuples.length === 0) continue;
      groups.push({ label: group.label, count: tuples.length, body: renderTuplePredicates(tuples, keyColumns.length) });
    }

    if (groups.length === 0) return { predicate: null, rowCount: 0, groups: [] };

    const lines = [];
    groups.forEach((group, index) => {
      lines.push(`  -- ${group.label} (${group.count} ${group.count === 1 ? "row" : "rows"})`);
      lines.push(index === 0 ? `  ${group.body}` : `  OR ${group.body}`);
    });

    return {
      predicate: `WHERE\n${lines.join("\n")};`,
      rowCount: groups.reduce((total, group) => total + group.count, 0),
      groups: groups.map(({ label, count }) => ({ label, count })),
    };
  } catch (error) {
    return { predicate: null, rowCount: 0, groups: [], error: error.message };
  }
}
