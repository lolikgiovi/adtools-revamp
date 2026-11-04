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
          // The date-prefix bound keeps the read on the created_time index; one spare day covers UTC instants.
          where: (column) =>
            `AND ${column} >= date('now', '+7 hours', '-${days + 1} days')
    AND julianday(${instant(column)}) >= julianday('now', '+7 hours', 'start of day', '-${days} days', '-7 hours')`,
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

// Each usage table is read once from a (device_id, ..., created_time) index, never row by row.
export function buildDeviceHealthQuery() {
  const at = (column) => `julianday(${instant(column)})`;
  return `WITH tool_seen AS (
    SELECT device_id, MAX(${at("created_time")}) AS seen,
      MAX(CASE WHEN source='client' AND ${at("created_time")}<=julianday('now') THEN ${at("created_time")} END) AS last_action
    FROM tool_usage GROUP BY device_id
  ), log_seen AS (
    SELECT device_id, MAX(${at("created_time")}) AS seen FROM usage_log GROUP BY device_id
  ), devices AS (
    SELECT d.device_id, LOWER(u.email) AS user_email, COALESCE(d.platform, 'Unknown') AS platform,
      COALESCE(NULLIF(TRIM(u.department),''),'Unknown') AS department,
      strftime('%Y-%m-%dT%H:%M:%SZ',${instant("d.last_seen")}) AS last_checkin,
      strftime('%Y-%m-%dT%H:%M:%SZ',t.last_action) AS last_tool_action,
      NULLIF(TRIM(d.app_version), '') AS app_version,
      COALESCE(MAX(t.seen, l.seen), t.seen, l.seen) AS latest,
      ${at("d.last_seen")} AS checkin_seen
    FROM device d JOIN users u ON u.id = d.user_id
      LEFT JOIN tool_seen t ON t.device_id = d.device_id
      LEFT JOIN log_seen l ON l.device_id = d.device_id
    WHERE ${includedAnalyticsEmailSql("u.email")}
  ), scored AS (
    SELECT *, MAX(COALESCE(checkin_seen, latest), COALESCE(latest, checkin_seen)) AS seen FROM devices
  ) SELECT device_id, user_email, department, platform, app_version, last_checkin, last_tool_action,
    strftime('%Y-%m-%dT%H:%M:%SZ', seen) AS last_seen,
    CASE WHEN seen IS NULL OR seen > julianday('now') THEN NULL
      ELSE CAST(julianday('now') - seen AS INTEGER) END AS days_since_seen
    FROM scored ORDER BY seen DESC, user_email, device_id`;
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
