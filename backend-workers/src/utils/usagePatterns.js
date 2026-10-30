// This report measures recorded actions, not tasks completed or value delivered.
// Reconstructed legacy rows are kept out of comparisons with directly recorded actions.
const instant = (column) => `CASE WHEN substr(${column}, -6, 1) IN ('+', '-') OR upper(substr(${column}, -1)) = 'Z'
  THEN ${column} ELSE ${column} || '+07:00' END`;

export async function readUsagePatterns(env, range) {
  const days = { today: 1, "7d": 7, "30d": 30, "90d": 90 }[range] || 30;
  const all = range === "all";
  const today = range === "today";
  // Multi-day comparisons use complete Jakarta calendar days. Today compares the same
  // elapsed hours yesterday. All-time has no defensible preceding-period comparison.
  const start = all
    ? "COALESCE((SELECT MIN(julianday(" + instant("created_time") + ")) FROM tool_usage WHERE source='client'), day_start)"
    : today
      ? "day_start"
      : `day_start - ${days}`;
  const end = all || today ? "now_at" : "day_start";
  const cte = `WITH clock AS (
    SELECT julianday('now') AS now_at, julianday('now','+7 hours','start of day','-7 hours') AS day_start
  ), bounds AS (
    SELECT ${start} AS start_at, ${end} AS end_at, now_at FROM clock
  ), normalized AS (
    SELECT t.*, LOWER(t.user_email) AS email,
      COALESCE(NULLIF(TRIM(u.department), ''), 'Unknown') AS department,
      julianday(${instant("t.created_time")}) AS at
    FROM tool_usage t LEFT JOIN users u ON LOWER(u.email)=LOWER(t.user_email)
  ), activity AS (
    SELECT n.*, CASE WHEN at>=start_at THEN 'current' ELSE 'previous' END AS period,
      date(at,'+7 hours') AS day, CAST(strftime('%H',at,'+7 hours') AS INTEGER) AS hour,
      CASE WHEN action LIKE '%copy%' OR action LIKE '%download%' OR action LIKE '%export%'
        THEN 'output' ELSE 'operation' END AS category
    FROM normalized n CROSS JOIN bounds
    WHERE source='client' AND at<=now_at AND at<end_at
      AND at>=${all ? "start_at" : today ? "start_at-1" : `start_at-${days}`}
      ${today ? "AND (at>=start_at OR at<end_at-1)" : ""}
  ) `;
  const rows = async (sql) => (await env.DB.prepare(cte + sql).all()).results || [];
  const [bounds, totals, daily, hours, cells, features, details, departments, quality, opens, errors] = await Promise.all([
    rows(`SELECT strftime('%Y-%m-%dT%H:%M:%SZ',start_at) AS start_at,
      strftime('%Y-%m-%dT%H:%M:%SZ',end_at) AS end_at,
      strftime('%Y-%m-%dT%H:%M:%SZ',start_at-${days}) AS previous_start,
      strftime('%Y-%m-%dT%H:%M:%SZ',${today ? "end_at-1" : "start_at"}) AS previous_end FROM bounds`),
    rows(`SELECT period, COUNT(*) AS actions, COUNT(DISTINCT email) AS people,
      COUNT(DISTINCT device_id) AS devices, SUM(category='operation') AS operations,
      SUM(category='output') AS output_actions, SUM(hour<6) AS overnight_actions,
      COUNT(DISTINCT CASE WHEN hour<6 THEN email END) AS overnight_people
      FROM activity GROUP BY period`),
    rows(`SELECT period,day,COUNT(*) AS actions,COUNT(DISTINCT email) AS people FROM activity GROUP BY period,day ORDER BY day`),
    rows(`SELECT period,hour,COUNT(*) AS actions,COUNT(DISTINCT email) AS people FROM activity GROUP BY period,hour ORDER BY hour`),
    rows(`SELECT day,hour,COUNT(*) AS actions,COUNT(DISTINCT email) AS people
      FROM activity WHERE period='current' GROUP BY day,hour ORDER BY day,hour`),
    rows(`SELECT period,tool_id,category,COUNT(*) AS actions,COUNT(DISTINCT email) AS people
      FROM activity GROUP BY period,tool_id,category ORDER BY actions DESC,tool_id`),
    rows(`SELECT day,hour,tool_id,action,category,email AS user_email,device_id,department,COUNT(*) AS actions
      FROM activity WHERE period='current'
      GROUP BY day,hour,tool_id,action,category,email,device_id,department ORDER BY day DESC,hour DESC,actions DESC LIMIT 5001`),
    rows(`, registered AS (
      SELECT DISTINCT LOWER(u.email) AS email,COALESCE(NULLIF(TRIM(u.department),''),'Unknown') AS department
      FROM users u JOIN device d ON d.user_id=u.id
    ), department_names AS (
      SELECT department FROM registered UNION SELECT department FROM activity WHERE period='current'
    ) SELECT n.department,
      (SELECT COUNT(*) FROM registered r WHERE r.department=n.department) AS registered_people,
      (SELECT COUNT(DISTINCT email) FROM activity a WHERE a.department=n.department AND period='current') AS active_people,
      (SELECT COUNT(DISTINCT device_id) FROM activity a WHERE a.department=n.department AND period='current') AS devices,
      (SELECT COUNT(*) FROM activity a WHERE a.department=n.department AND period='current') AS actions
      FROM department_names n ORDER BY registered_people DESC,n.department`),
    rows(`SELECT
      (SELECT COUNT(*) FROM normalized WHERE source!='client' AND at>=start_at AND at<end_at) AS historical_rows,
      (SELECT COUNT(*) FROM normalized WHERE source='client' AND (at IS NULL OR at>now_at)) AS invalid_or_future_rows,
      (SELECT MIN(date(at,'+7 hours')) FROM normalized WHERE source='client' AND at<=now_at) AS first_recorded_day
      FROM bounds`),
    rows(`SELECT CASE WHEN julianday(${instant("l.created_time")})>=start_at THEN 'current' ELSE 'previous' END AS period,
      COUNT(*) AS opens FROM (SELECT DISTINCT user_email,device_id,tool_id,action,created_time FROM usage_log WHERE action='open') l
      CROSS JOIN bounds WHERE julianday(${instant("l.created_time")})>=${all ? "start_at" : `start_at-${days}`}
      AND julianday(${instant("l.created_time")})<end_at
      ${today ? `AND (julianday(${instant("l.created_time")})>=start_at OR julianday(${instant("l.created_time")})<end_at-1)` : ""}
      GROUP BY period`),
    rows(`SELECT CASE WHEN julianday(${instant("e.created_time")})>=start_at THEN 'current' ELSE 'previous' END AS period,
      COUNT(*) AS errors FROM error_events e CROSS JOIN bounds
      WHERE julianday(${instant("e.created_time")})>=${all ? "start_at" : `start_at-${days}`}
      AND julianday(${instant("e.created_time")})<end_at
      ${today ? `AND (julianday(${instant("e.created_time")})>=start_at OR julianday(${instant("e.created_time")})<end_at-1)` : ""}
      GROUP BY period`),
  ]);
  const empty = { actions: 0, people: 0, devices: 0, operations: 0, output_actions: 0, overnight_actions: 0, overnight_people: 0 };
  const period = (name) => ({
    ...empty,
    ...totals.find((row) => row.period === name),
    opens: opens.find((row) => row.period === name)?.opens || 0,
    errors: errors.find((row) => row.period === name)?.errors || 0,
  });
  const window = bounds[0];
  const endDate = Date.parse(window.end_at);
  const firstDay = new Date(Date.parse(window.start_at) + 7 * 3600000);
  const firstDate = Date.UTC(firstDay.getUTCFullYear(), firstDay.getUTCMonth(), firstDay.getUTCDate()) - 7 * 3600000;
  const calendar = [];
  // Calendar padding is presentation only: zero means no recorded actions, not confirmed non-use.
  for (let at = firstDate; at < endDate && calendar.length < 3660; at += 86400000) {
    const day = new Date(at + 7 * 3600000).toISOString().slice(0, 10);
    calendar.push({ day, actions: 0, people: 0, ...daily.find((row) => row.period === "current" && row.day === day) });
  }
  return {
    periods: {
      current: { ...period("current"), start_at: window.start_at, end_at: window.end_at },
      previous: all ? null : { ...period("previous"), start_at: window.previous_start, end_at: window.previous_end },
      complete_days: !all && !today,
      today,
    },
    days: calendar,
    hours,
    cells,
    features,
    departments,
    details: details.slice(0, 5000),
    details_truncated: details.length > 5000,
    quality: { ...quality[0], calendar_truncated: calendar.length === 3660 },
  };
}
