import { includedAnalyticsEmailSql } from "./analyticsIdentity.js";

export function buildDeduplicatedUsageLogQuery(rangeConfig = null) {
  const rangeClause = rangeConfig ? `\n    ${rangeConfig.where("u.created_time")}` : "";
  return `SELECT DISTINCT LOWER(u.user_email) AS user_email,
    u.device_id,
    CASE
      WHEN u.tool_id IN ('jenkins-runner', 'run-query') THEN 'run-query'
      WHEN u.tool_id IN ('master_lockey', 'master-lockey') THEN 'master-lockey'
      WHEN u.tool_id IN ('json_tools', 'json-tools') THEN 'json-tools'
      ELSE u.tool_id
    END AS tool_id,
    u.action,
    u.created_time
  FROM usage_log u
  WHERE ${includedAnalyticsEmailSql("u.user_email")}
    AND LOWER(TRIM(u.tool_id)) != 'velocity-template'${rangeClause}`;
}

export function buildNormalizedUsageLogQuery(rangeConfig = null) {
  return `WITH deduplicated_usage AS (
  ${buildDeduplicatedUsageLogQuery(rangeConfig)}
)
SELECT u.user_email,
    u.device_id,
    u.tool_id,
    u.action,
    u.created_time
  FROM deduplicated_usage u
  WHERE
    (
      u.action != 'open'
      OR NOT EXISTS (
        SELECT 1
        FROM deduplicated_usage u2
        WHERE u2.user_email = u.user_email
          AND u2.device_id = u.device_id
          AND u2.tool_id = u.tool_id
          AND DATE(datetime(u2.created_time)) = DATE(datetime(u.created_time))
          AND u2.action != 'open'
      )
    )`;
}

export function buildCanonicalToolUsageQuery(rangeConfig = null) {
  const rangeClause = rangeConfig ? `\n    ${rangeConfig.where("u.created_time")}` : "";
  return `SELECT LOWER(u.user_email) AS user_email,
    u.device_id,
    u.tool_id,
    u.action,
    u.created_time
  FROM tool_usage u
  WHERE ${includedAnalyticsEmailSql("u.user_email")}
    AND LOWER(TRIM(u.tool_id)) != 'velocity-template'${rangeClause}`;
}
