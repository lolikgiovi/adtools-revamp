// Department usage counts directly recorded client tool actions only, using each person's current profile department.
// Windows match Daily Trends: multi-day ranges are complete Jakarta days ending at midnight today.
const instant = (column) => `CASE WHEN substr(${column}, -6, 1) IN ('+', '-') OR upper(substr(${column}, -1)) = 'Z'
  THEN ${column} ELSE ${column} || '+07:00' END`;
const department = (column) => `COALESCE(NULLIF(TRIM(${column}), ''), 'Unknown')`;

export async function readDepartmentUsage(env, range) {
  const days = { "7d": 7, "30d": 30, "90d": 90 }[range];
  const window =
    range === "today"
      ? "day_start AS start_at, now_at AS end_at"
      : range === "all"
        ? "-1e9 AS start_at, now_at AS end_at"
        : `day_start - ${days || 30} AS start_at, day_start AS end_at`;
  const cte = `WITH clock AS (
    SELECT julianday('now') AS now_at, julianday('now','+7 hours','start of day','-7 hours') AS day_start
  ), bounds AS (SELECT ${window} FROM clock),
  activity AS (
    SELECT LOWER(t.user_email) AS email, t.device_id, t.tool_id, ${department("u.department")} AS department,
      julianday(${instant("t.created_time")}) AS at
    FROM tool_usage t LEFT JOIN users u ON LOWER(u.email) = LOWER(t.user_email) CROSS JOIN bounds
    WHERE t.source = 'client' AND julianday(${instant("t.created_time")}) >= start_at
      AND julianday(${instant("t.created_time")}) < end_at
  ), registered AS (
    SELECT DISTINCT LOWER(u.email) AS email, ${department("u.department")} AS department FROM users u JOIN device d ON d.user_id = u.id
  ) `;
  const rows = async (sql) => (await env.DB.prepare(cte + sql).all()).results || [];
  const [departments, tools, people] = await Promise.all([
    rows(`, names AS (SELECT department FROM registered UNION SELECT department FROM activity),
      totals AS (
        SELECT department, COUNT(DISTINCT email) AS active_people, COUNT(DISTINCT device_id) AS devices, COUNT(*) AS actions,
          COUNT(DISTINCT tool_id) AS tools, MAX(at) AS last_at FROM activity GROUP BY department
      ), people AS (SELECT department, COUNT(*) AS registered_people FROM registered GROUP BY department)
      SELECT n.department, COALESCE(p.registered_people, 0) AS registered_people, COALESCE(t.active_people, 0) AS active_people,
        COALESCE(t.devices, 0) AS devices, COALESCE(t.actions, 0) AS actions, COALESCE(t.tools, 0) AS tools,
        strftime('%Y-%m-%dT%H:%M:%SZ', t.last_at) AS last_active
      FROM names n LEFT JOIN totals t USING (department) LEFT JOIN people p USING (department)
      ORDER BY active_people DESC, actions DESC, registered_people DESC, n.department`),
    rows(`SELECT department, tool_id, COUNT(*) AS actions, COUNT(DISTINCT email) AS people
      FROM activity GROUP BY department, tool_id ORDER BY department, people DESC, actions DESC, tool_id`),
    // Everyone registered, including people with no activity in the period, plus anyone active without a profile.
    rows(`, names AS (SELECT email FROM registered UNION SELECT email FROM activity),
      profile AS (SELECT LOWER(email) AS email, ${department("department")} AS department, role, created_time FROM users),
      totals AS (
        SELECT email, COUNT(*) AS uses, COUNT(DISTINCT tool_id) AS tools, COUNT(DISTINCT device_id) AS devices, MAX(at) AS last_at
        FROM activity GROUP BY email
      ), ranked AS (
        SELECT email, tool_id, ROW_NUMBER() OVER (PARTITION BY email ORDER BY COUNT(*) DESC, MAX(at) DESC, tool_id) AS position
        FROM activity GROUP BY email, tool_id
      )
      SELECT n.email AS user_email, COALESCE(p.department, 'Unknown') AS department, p.role, p.created_time AS registered_at,
        COALESCE(t.uses, 0) AS uses, COALESCE(t.tools, 0) AS tools, COALESCE(t.devices, 0) AS devices, r.tool_id AS top_tool,
        strftime('%Y-%m-%dT%H:%M:%SZ', t.last_at) AS last_active
      FROM names n LEFT JOIN profile p USING (email) LEFT JOIN totals t USING (email)
      LEFT JOIN ranked r ON r.email = n.email AND r.position = 1
      ORDER BY uses DESC, t.last_at DESC, user_email`),
  ]);
  return { departments, tools, people };
}
