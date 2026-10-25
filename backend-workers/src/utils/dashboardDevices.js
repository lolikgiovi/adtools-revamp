const DEVICE_TABLES = ["device", "device_usage", "get_device_usage", "tool_usage", "usage_log", "events", "error_events", "improvement_feedback"];
const scopedDatabases = new WeakMap();

export function scopeDashboardDevices(env) {
  const ids = [...new Set(String(env.ANALYTICS_EXCLUDED_DEVICE_IDS || "").split(",").map((id) => id.trim()).filter(Boolean))].sort();
  if (ids.length > 100 || ids.some((id) => id.length > 120 || /[\x00-\x1f]/.test(id))) {
    throw new Error("Invalid ANALYTICS_EXCLUDED_DEVICE_IDS configuration");
  }
  const scope = JSON.stringify(ids);
  if (!ids.length || !env.DB) return { ...env, dashboardDeviceScope: scope };
  let scopes = scopedDatabases.get(env.DB);
  if (!scopes) {
    scopes = new Map();
    scopedDatabases.set(env.DB, scopes);
  }
  if (!scopes.has(scope)) {
    const excluded = ids.map((id) => `'${id.replaceAll("'", "''")}'`).join(", ");
    const DB = new Proxy(env.DB, {
      get(target, property) {
        if (property !== "prepare") {
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        }
        return (sql) => {
          if (!/^\s*(SELECT|WITH)\b/i.test(sql)) return target.prepare(sql);
          const tables = DEVICE_TABLES.filter((table) => new RegExp(`\\b(?:FROM|JOIN)\\s+${table}\\b`, "i").test(sql));
          if (!tables.length) return target.prepare(sql);
          const sources = tables.map((table) =>
            `${table} AS (SELECT * FROM main.${table} WHERE device_id IS NULL OR device_id NOT IN (${excluded}))`,
          );
          // Outer CTEs scope both ordinary reports and reports that already have their own WITH clause.
          return target.prepare(`WITH ${sources.join(", ")} SELECT * FROM (${sql.trim().replace(/;\s*$/, "")}) AS dashboard_rows`);
        };
      },
    });
    scopes.set(scope, DB);
  }
  return { ...env, DB: scopes.get(scope), dashboardDeviceScope: scope };
}
