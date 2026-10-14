export const MANAGED = ["DSH_MENU", "DSH_SUMMARY_GROUP", "DSH_SUMMARY_FIELD", "DSH_DETAIL_TABLE", "DSH_DETAIL_COLUMN"];
export const KEYS = {
  DSH_MENU: "MENU_ID",
  DSH_SUMMARY_GROUP: "GROUP_ID",
  DSH_SUMMARY_FIELD: "FIELD_ID",
  DSH_DETAIL_TABLE: "TABLE_ID",
  DSH_DETAIL_COLUMN: "COLUMN_ID",
  DSH_DATASOURCE: "DATASOURCE_ID",
  DSH_SUMMARY_QUERY: "MENU_ID",
};
export const PARENTS = {
  DSH_SUMMARY_GROUP: ["DSH_MENU", "MENU_ID"],
  DSH_SUMMARY_FIELD: ["DSH_SUMMARY_GROUP", "GROUP_ID"],
  DSH_DETAIL_TABLE: ["DSH_MENU", "MENU_ID"],
  DSH_DETAIL_COLUMN: ["DSH_DETAIL_TABLE", "TABLE_ID"],
};
export const LABELS = {
  DSH_MENU: "Menu",
  DSH_SUMMARY_GROUP: "Summary Query",
  DSH_SUMMARY_FIELD: "Summary Field",
  DSH_DETAIL_TABLE: "Detail Query",
  DSH_DETAIL_COLUMN: "Detail Column",
  DSH_SUMMARY_QUERY: "Compatibility Query",
};
export const valueText = (value) => (value === null || value === undefined ? "" : typeof value === "object" ? value.value : String(value));
export const equal = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
export function canonicalNumber(value) {
  if (!/^[+-]?\d+(\.\d+)?$/.test(value)) throw new Error("Use an exact decimal, without exponent notation");
  let [whole, fraction = ""] = value.replace(/^[+-]/, "").split(".");
  whole = whole.replace(/^0+(?=\d)/, "");
  fraction = fraction.replace(/0+$/, "");
  const result = whole + (fraction ? `.${fraction}` : "");
  return value.startsWith("-") && result !== "0" ? `-${result}` : result;
}
export function planChanges(baseline, tables) {
  return MANAGED.flatMap((table) =>
    (tables[table] || []).flatMap((desired) => {
      const original = (baseline[table] || []).find((row) => row[KEYS[table]] === desired[KEYS[table]]);
      const columns = Object.keys(desired).filter((column) => !equal(original?.[column], desired[column]));
      return !original || columns.length
        ? [{ table, action: original ? "UPDATE" : "INSERT", baseline: original || null, desired: structuredClone(desired), columns }]
        : [];
    }),
  );
}
export function menuFor(tables, table, row) {
  if (!row) return null;
  if (row.MENU_ID) return row.MENU_ID;
  const parent = PARENTS[table];
  if (!parent) return null;
  const found = (tables[parent[0]] || []).find((item) => item[KEYS[parent[0]]] === row[parent[1]]);
  return menuFor(tables, parent[0], found);
}
export function cloneBranch(tables, table, id) {
  if (!MANAGED.includes(table)) throw new Error("This configuration is read-only");
  if (table === "DSH_MENU" && tables.DSH_SUMMARY_QUERY?.some((row) => row.MENU_ID === id)) {
    throw new Error("Menu contains a compatibility query. V1 cannot clone it completely.");
  }
  const result = structuredClone(tables);
  const idMap = {};
  function clone(type, key, parentId) {
    const row = result[type].find((item) => item[KEYS[type]] === key);
    if (!row) throw new Error("Selected row no longer exists");
    const copy = structuredClone(row);
    const newId = crypto.randomUUID();
    idMap[`${type}:${key}`] = newId;
    copy[KEYS[type]] = newId;
    if (parentId) copy[PARENTS[type][1]] = parentId;
    if (type === "DSH_MENU") {
      copy.CREATED_BY = null;
      copy.CREATED_AT = null;
      copy.UPDATED_BY = null;
      copy.UPDATED_AT = null;
    }
    result[type].push(copy);
    for (const [child, parent] of Object.entries(PARENTS)) {
      if (parent[0] === type) {
        const children = (tables[child] || []).filter((item) => item[parent[1]] === key);
        children.forEach((item) => clone(child, item[KEYS[child]], newId));
      }
    }
    return newId;
  }
  const newId = clone(table, id);
  return { tables: result, idMap, newId };
}
export function healthFindings(tables) {
  const findings = [];
  for (const [table, parent] of Object.entries(PARENTS)) {
    const ids = new Set((tables[parent[0]] || []).map((row) => row[KEYS[parent[0]]]));
    for (const row of tables[table] || []) {
      if (!ids.has(row[parent[1]]))
        findings.push({
          code: "orphan",
          table,
          id: row[KEYS[table]],
          message: `Missing ${parent[1]} ${row[parent[1]]}. Configuration retained unchanged.`,
        });
    }
  }
  for (const table of MANAGED) {
    const slots = new Map();
    for (const row of tables[table] || []) {
      const slot = `${row[PARENTS[table]?.[1]] || row.CHANNEL_NAME}:${valueText(row.DISPLAY_ORDER)}`;
      if (slots.has(slot))
        findings.push({ code: "order", table, id: row[KEYS[table]], message: "Duplicate display order among siblings." });
      slots.set(slot, true);
      if (row.SHOW_CHART === "Y" && row.CHART_TYPE === null)
        findings.push({
          code: "chart",
          table,
          id: row[KEYS[table]],
          message: "Chart enabled without a chart type. Runtime fallback is unverified.",
        });
      if (row.VALUE_FORMAT && !["text", "number", "currency", "percent", "date", "datetime"].includes(row.VALUE_FORMAT)) {
        findings.push({ code: "format", table, id: row[KEYS[table]], message: `Unknown format “${row.VALUE_FORMAT}” preserved.` });
      }
    }
  }
  return findings;
}
export function columnsFor(metadata, table) {
  const entry = metadata.tables?.find((item) => item.name === table) || metadata[table];
  return Array.isArray(entry) ? entry : entry?.columns || [];
}
export const columnName = (column) => column.name || column.column_name || column.COLUMN_NAME;
export const columnType = (column) => column.type || column.data_type || column.DATA_TYPE || "";
export function validateChanges(operations, metadata, tables) {
  const errors = [];
  for (const operation of operations) {
    const { table, desired, baseline, action } = operation;
    const add = (column, message) => errors.push({ table, id: desired[KEYS[table]], column, message });
    const protectedColumns = [KEYS[table], PARENTS[table]?.[1], "CREATED_BY", "CREATED_AT"];
    if (action === "UPDATE")
      protectedColumns.filter(Boolean).forEach((column) => {
        if (!equal(baseline[column], desired[column])) add(column, "Existing ID, parent and creation attributes are read-only");
      });
    for (const column of columnsFor(metadata, table)) {
      const name = columnName(column);
      const type = columnType(column);
      const value = desired[name];
      const text = valueText(value);
      const generated = table === "DSH_MENU" && ["CREATED_AT", "CREATED_BY", "UPDATED_AT", "UPDATED_BY"].includes(name);
      if (!generated && (column.nullable === false || column.nullable === "N" || column.NULLABLE === "N") && !text) {
        add(name, `${name} is required`);
        continue;
      }
      if (value == null) continue;
      if (/NUMBER/.test(type)) {
        try {
          const decimal = canonicalNumber(text);
          const [whole, fraction = ""] = decimal.replace("-", "").split(".");
          const precision = column.precision ?? column.data_precision ?? column.DATA_PRECISION;
          const scale = column.scale ?? column.data_scale ?? column.DATA_SCALE ?? 0;
          if (fraction.length > scale || (precision != null && whole.replace(/^0+/, "").length > precision - scale)) {
            add(name, `${name} exceeds NUMBER(${precision},${scale})`);
          }
        } catch (error) {
          add(name, error.message);
        }
      }
      const length = (column.charUsed || column.char_used) === "C" ? Array.from(text).length : new TextEncoder().encode(text).length;
      const limit =
        (column.charUsed || column.char_used) === "C"
          ? (column.length ?? column.char_length)
          : (column.dataLength ?? column.data_length ?? column.DATA_LENGTH);
      if (/CHAR/.test(type) && limit && length > limit)
        add(name, `${name} exceeds ${limit} ${(column.charUsed || column.char_used) === "C" ? "characters" : "bytes"}`);
      if (name.endsWith("_ID") && /CHAR/.test(type) && text.length > 50) add(name, "ID must fit the database column");
    }
    const enumValues = {
      IS_ACTIVE: ["Y", "N"],
      SHOW_CHART: ["Y", "N"],
      TONE: ["ok", "fail", "pend", "info"],
      ALIGN: ["left", "right"],
      CHART_TYPE: ["bar", "line"],
    };
    for (const [column, values] of Object.entries(enumValues)) {
      if (desired[column] != null && !values.includes(desired[column])) add(column, `${column}: choose ${values.join(", ")}`);
    }
    if (desired.PAGE_SIZE && !/^(?:[1-9]\d?|100)$/.test(valueText(desired.PAGE_SIZE)))
      add("PAGE_SIZE", "Page size must be between 1 and 100");
    if (desired.TIMEOUT_MS && operation.columns.includes("TIMEOUT_MS") && !/^[1-9]\d*$/.test(valueText(desired.TIMEOUT_MS))) {
      add("TIMEOUT_MS", "Timeout must be a positive integer (product rule)");
    }
    if (desired.CHART_TYPE)
      for (const column of ["CHART_SQL", "CHART_LABEL_FIELD", "CHART_VALUE_FIELD"]) {
        if (!valueText(desired[column])) add(column, `${column} is required for a chart`);
      }
    const parent = PARENTS[table];
    if (parent && !(tables[parent[0]] || []).some((row) => row[KEYS[parent[0]]] === desired[parent[1]]))
      add(parent[1], "Referenced parent is missing");
    if (desired.DATASOURCE_ID && !(tables.DSH_DATASOURCE || []).some((row) => row.DATASOURCE_ID === desired.DATASOURCE_ID)) {
      add("DATASOURCE_ID", "Choose an existing datasource");
    }
  }
  return errors;
}
