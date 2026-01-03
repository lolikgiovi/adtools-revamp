export const SQLInClauseService = {
  parseLines(raw) {
    if (!raw) return [];
    return raw
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  },

  escapeItem(item) {
    // Escape single quotes by doubling them per SQL standard
    return item.replace(/'/g, "''");
  },

  toInClause(items, opts = {}) {
    const { multiline = false } = opts;
    const quoted = items.map((i) => `'${SQLInClauseService.escapeItem(i)}'`);
    const joiner = multiline ? ",\n" : ", ";
    return `(${quoted.join(joiner)})`;
  },

  toSelectQuery(items, table, column, opts = {}) {
    const inClause = SQLInClauseService.toInClause(items, opts);
    const t = (table || "table_name").trim() || "table_name";
    const c = (column || "column_name").trim() || "column_name";
    return `SELECT * FROM ${t} WHERE ${c} IN ${inClause}`;
  },

  format(raw, format, options = {}) {
    const items = SQLInClauseService.parseLines(raw);
    if (!items.length) return "";
    switch (format) {
      case "single":
        return SQLInClauseService.toInClause(items, { multiline: false });
      case "multi":
        return SQLInClauseService.toInClause(items, { multiline: true });
      case "select":
        return SQLInClauseService.toSelectQuery(items, options.table, options.column, {
          multiline: true,
        });
      default:
        return SQLInClauseService.toInClause(items, { multiline: false });
    }
  },
};