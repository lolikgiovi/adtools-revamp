import { buildCanonicalToolUsageQuery } from "./analyticsUsageSql.js";
import { includedAnalyticsEmailSql } from "./analyticsIdentity.js";

// Offset-free legacy values are Jakarta wall time; newer clients include an offset.
const instant = (column) => `CASE WHEN substr(${column}, -6, 1) IN ('+', '-') OR upper(substr(${column}, -1)) = 'Z'
  THEN ${column} ELSE ${column} || '+07:00' END`;

export function buildDailyTrendsQuery(range) {
  const days = { today: 1, "7d": 7, "30d": 30, "90d": 90 }[range] || 30;
  const start =
    range === "all" ? "COALESCE((SELECT MIN(day) FROM daily), date('now', '+7 hours'))" : `date('now', '+7 hours', '-${days - 1} days')`;
  const usageRange =
    range === "all"
      ? null
      : {
          where: (column) =>
            `AND julianday(${instant(column)}) >= julianday('now', '+7 hours', 'start of day', '-${days} days', '-7 hours')`,
        };
  return `WITH RECURSIVE usage AS (${buildCanonicalToolUsageQuery(usageRange)}),
    daily AS (
      SELECT date(${instant("created_time")}, '+7 hours') AS day,
        COUNT(*) AS successful_uses, COUNT(DISTINCT user_email) AS active_people,
        COUNT(DISTINCT device_id) AS active_devices
      FROM usage WHERE julianday(${instant("created_time")}) <= julianday('now') GROUP BY 1
    ), bounds AS (SELECT ${start} AS start_day),
    calendar(day) AS (
      SELECT date(start_day, '-1 day') FROM bounds
      UNION ALL SELECT date(day, '+1 day') FROM calendar WHERE day < date('now', '+7 hours')
    ), comparisons AS (
      SELECT c.day, COALESCE(d.successful_uses, 0) AS successful_uses,
        COALESCE(d.active_people, 0) AS active_people, COALESCE(d.active_devices, 0) AS active_devices,
        LAG(COALESCE(d.successful_uses, 0)) OVER (ORDER BY c.day) AS previous_uses
      FROM calendar c LEFT JOIN daily d ON d.day = c.day
    ) SELECT *, day = date('now', '+7 hours') AS partial_day FROM comparisons
      WHERE day >= (SELECT start_day FROM bounds) ORDER BY day`;
}

export function buildDeviceHealthQuery() {
  return `WITH activity AS (
    SELECT device_id, MAX(julianday(${instant("created_time")})) AS seen FROM tool_usage GROUP BY device_id
    UNION ALL SELECT device_id, MAX(julianday(${instant("created_time")})) AS seen FROM usage_log GROUP BY device_id
  ), latest AS (SELECT device_id, MAX(seen) AS seen FROM activity GROUP BY device_id),
  devices AS (
    SELECT d.device_id, LOWER(u.email) AS user_email, COALESCE(d.platform, 'Unknown') AS platform,
      NULLIF(TRIM(d.app_version), '') AS app_version,
      MAX(COALESCE(julianday(${instant("d.last_seen")}), l.seen),
        COALESCE(l.seen, julianday(${instant("d.last_seen")}))) AS seen
    FROM device d JOIN users u ON u.id = d.user_id LEFT JOIN latest l ON l.device_id = d.device_id
    WHERE ${includedAnalyticsEmailSql("u.email")}
  ) SELECT device_id, user_email, platform, app_version,
    strftime('%Y-%m-%dT%H:%M:%SZ', seen) AS last_seen,
    CASE WHEN seen IS NULL OR seen > julianday('now') THEN NULL
      ELSE CAST(julianday('now') - seen AS INTEGER) END AS days_since_seen
    FROM devices ORDER BY seen DESC, user_email, device_id`;
}

export function deviceVersionStatus(version, stable) {
  const parse = (value) => String(value || "").match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  const current = parse(version);
  const target = parse(stable);
  if (!current || !target || target[4]) return "Unknown";
  for (let index = 1; index <= 3; index++) {
    if (Number(current[index]) < Number(target[index])) return "Older version";
    if (Number(current[index]) > Number(target[index])) return "Ahead of stable";
  }
  return current[4] ? "Older version" : "Up to date";
}
