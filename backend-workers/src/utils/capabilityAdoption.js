import { capabilities } from "../../../frontend/config/capabilities.js";

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const actor = `COALESCE(NULLIF(LOWER(json_extract(CASE WHEN json_valid(e.properties)
  THEN e.properties ELSE '{}' END, '$.actor_email')), ''), LOWER(u.email))`;
const identity = `CASE WHEN ${actor} = 'dev@localhost' OR ${actor} IS NULL
  THEN 'device:' || e.device_id ELSE ${actor} END`;

/** Only instrumented visits establish an audience; absence of historic tracking is not non-use. */
export function buildCapabilityAdoptionQuery(range = null, people = false) {
  const catalogue = capabilities
    .map((item) => {
      const completion = Boolean(
        item.uses?.length || Object.values(item.events || {}).some((stage) => ["succeeded", "outcome", "minification"].includes(stage)),
      );
      return `(${quote(item.tool)}, ${quote(item.id)}, ${quote(item.name)}, ${item.desktop ? 1 : 0}, ${completion ? 1 : 0})`;
    })
    .join(",\n");
  const base = `WITH catalogue(tool_id, capability, name, desktop, completion) AS (VALUES ${catalogue}),
  raw AS (
    SELECT e.feature_id AS tool_id, ${identity} AS user, e.action,
      CASE WHEN json_valid(e.properties) THEN e.properties ELSE '{}' END AS props
    FROM events e
    LEFT JOIN device d ON d.device_id = e.device_id
    LEFT JOIN users u ON u.id = d.user_id
    WHERE e.action IN ('capability_visit', 'capability_exposed', 'capability_opened', 'capability_started',
      'capability_configured', 'capability_succeeded', 'capability_failed', 'capability_blocked', 'capability_cancelled')
      ${range?.where("e.created_time") || ""}
  ), instrumented AS (
    SELECT *, json_extract(props, '$.capability') AS capability
    FROM raw WHERE json_extract(props, '$.schema_version') = 1
  ), audience AS (
    SELECT tool_id, user, MAX(json_extract(props, '$.runtime') = 'tauri') AS desktop
    FROM instrumented GROUP BY tool_id, user
  ), observed AS (
    SELECT tool_id, user, capability,
      MAX(action = 'capability_exposed' AND json_extract(props, '$.available') = 1) AS exposed,
      MAX(action = 'capability_exposed' AND json_extract(props, '$.available') = 0) AS unavailable,
      MAX(action IN ('capability_opened', 'capability_started', 'capability_configured')) AS explored,
      MAX(action = 'capability_succeeded') AS successful,
      MAX(action IN ('capability_failed', 'capability_blocked')) AS failed,
      MAX(action = 'capability_cancelled') AS cancelled
    FROM instrumented WHERE capability IS NOT NULL GROUP BY tool_id, user, capability
  ), person_capabilities AS (
    SELECT a.user, c.tool_id, c.capability, c.name, c.completion,
      COALESCE(o.exposed, 0) AS exposed, COALESCE(o.unavailable, 0) AS unavailable,
      COALESCE(o.explored, 0) AS explored, COALESCE(o.successful, 0) AS successful,
      COALESCE(o.failed, 0) AS failed, COALESCE(o.cancelled, 0) AS cancelled
    FROM audience a JOIN catalogue c ON c.tool_id = a.tool_id
    LEFT JOIN observed o ON o.tool_id = a.tool_id AND o.user = a.user AND o.capability = c.capability
    WHERE c.desktop = 0 OR a.desktop = 1 OR o.capability IS NOT NULL
  )`;
  if (people)
    return `${base}
    SELECT user, tool_id, capability, name, CASE WHEN completion THEN 'yes' ELSE 'no' END AS completion_measured,
      CASE WHEN successful THEN 'used'
        WHEN failed THEN 'failed_or_blocked'
        WHEN explored AND completion THEN 'explored_without_success'
        WHEN explored THEN 'explored'
        WHEN exposed THEN 'exposed_unused'
        WHEN unavailable THEN 'unavailable_when_exposed'
        ELSE 'no_recorded_exposure' END AS signal,
      exposed, explored, successful, failed, cancelled
    FROM person_capabilities ORDER BY user, tool_id, capability LIMIT 5000`;
  return `${base}
    SELECT tool_id, capability, name, CASE WHEN completion THEN 'yes' ELSE 'no' END AS completion_measured, COUNT(*) AS tool_users,
      SUM(exposed) AS exposed_users, SUM(explored) AS explored_users, SUM(successful) AS successful_users,
      SUM(failed) AS failed_or_blocked_users,
      SUM(completion AND explored AND NOT successful) AS explored_without_success,
      SUM(exposed AND NOT explored AND NOT successful AND NOT failed) AS exposed_unused,
      SUM(NOT exposed AND NOT explored AND NOT successful AND NOT failed AND NOT unavailable) AS no_recorded_exposure,
      SUM(unavailable AND NOT exposed AND NOT explored AND NOT successful) AS unavailable_when_exposed
    FROM person_capabilities GROUP BY tool_id, capability, name, completion ORDER BY tool_id, capability`;
}

export function buildImportSourcesQuery(range = null) {
  return `WITH imports AS (
    SELECT ${identity} AS user, e.feature_id AS tool_id, e.action,
      CASE WHEN json_valid(e.properties) THEN e.properties ELSE '{}' END AS props, e.created_time
    FROM events e
    LEFT JOIN device d ON d.device_id = e.device_id
    LEFT JOIN users u ON u.id = d.user_id
    WHERE ((e.feature_id = 'quick-query'
      AND e.action IN ('excel_import_result', 'oracle_import_result', 'oracle_schema_import_result', 'schema_file_import_result'))
      OR (e.feature_id = 'velocity-template' AND e.action = 'import_sql_result'))
      ${range?.where("e.created_time") || ""}
  )
  SELECT user, tool_id,
    CASE action WHEN 'excel_import_result' THEN 'Excel rows'
      WHEN 'oracle_import_result' THEN 'Oracle rows'
      WHEN 'oracle_schema_import_result' THEN 'Oracle schemas'
      WHEN 'import_sql_result' THEN 'Oracle template' ELSE 'Schema file' END AS source,
    COALESCE(json_extract(props, '$.file_name'), '') AS file_name,
    COALESCE(json_extract(props, '$.table_name'), '') AS table_name,
    COALESCE(json_extract(props, '$.source_tables'), '') AS source_tables,
    json_extract(props, '$.outcome') AS outcome, COUNT(*) AS imports,
    SUM(CASE WHEN json_extract(props, '$.outcome') = 'success' THEN COALESCE(json_extract(props, '$.row_count'), 0) ELSE 0 END) AS rows_loaded,
    MAX(created_time) AS last_seen
  FROM imports GROUP BY user, tool_id, action, file_name, table_name, source_tables, outcome
  ORDER BY last_seen DESC LIMIT 2000`;
}
