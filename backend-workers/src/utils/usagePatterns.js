// This report measures recorded actions, not tasks completed or value delivered.
// Reconstructed legacy rows are kept out of comparisons with directly recorded actions.
const instant = (column) => `CASE WHEN substr(${column}, -6, 1) IN ('+', '-') OR upper(substr(${column}, -1)) = 'Z'
  THEN ${column} ELSE ${column} || '+07:00' END`;

// Stored timestamps start with a calendar date (Jakarta wall time or an offset instant), so a
// date-prefix comparison bounds the indexed rows; the exact instant filter then trims the margin.
// One spare day covers UTC instants whose date precedes the Jakarta date.
const rowsSince = (column, days) => `${column} >= date('now', '+7 hours', '-${days + 1} days')`;

const outputAction = (action) => /copy|download|export/i.test(String(action || ""));

export async function readUsagePatterns(env, range) {
  const days = { today: 1, "7d": 7, "30d": 30, "90d": 90 }[range] || 30;
  const all = range === "all";
  const today = range === "today";
  // Multi-day comparisons use complete Jakarta calendar days. Today compares the same
  // elapsed hours yesterday. All-time has no defensible preceding-period comparison.
  const firstClientAt = `(SELECT MIN(julianday(${instant("created_time")})) FROM tool_usage WHERE source='client'
    AND created_time < date((SELECT MIN(created_time) FROM tool_usage WHERE source='client'), '+2 days'))`;
  const start = all ? `COALESCE(${firstClientAt}, day_start)` : today ? "day_start" : `day_start - ${days}`;
  const end = all || today ? "now_at" : "day_start";
  const lookbackDays = all ? null : today ? 1 : days * 2;
  const since = (column) => (lookbackDays === null ? "1=1" : rowsSince(column, lookbackDays));
  const clock = `WITH clock AS (
    SELECT julianday('now') AS now_at, julianday('now','+7 hours','start of day','-7 hours') AS day_start
  ), bounds AS (
    SELECT ${start} AS start_at, ${end} AS end_at, now_at FROM clock
  ) `;
  const inWindow = (column) => `julianday(${instant(column)})>=${all ? "start_at" : today ? "start_at-1" : `start_at-${days}`}
      AND julianday(${instant(column)})<end_at
      ${today ? `AND (julianday(${instant(column)})>=start_at OR julianday(${instant(column)})<end_at-1)` : ""}`;
  const period = (column) => `CASE WHEN julianday(${instant(column)})>=start_at THEN 'current' ELSE 'previous' END`;
  const rows = async (sql) => (await env.DB.prepare(clock + sql).all()).results || [];

  // D1 rejects bursts of heavy statements, so the report reads each table once, in sequence,
  // and derives every breakdown from one grouped pass over the selected window.
  const [window] = await rows(`SELECT strftime('%Y-%m-%dT%H:%M:%SZ',start_at) AS start_at,
      strftime('%Y-%m-%dT%H:%M:%SZ',end_at) AS end_at,
      strftime('%Y-%m-%dT%H:%M:%SZ',start_at-${days}) AS previous_start,
      strftime('%Y-%m-%dT%H:%M:%SZ',${today ? "end_at-1" : "start_at"}) AS previous_end FROM bounds`);
  const grain = await rows(`, activity AS (
      SELECT ${period("t.created_time")} AS period, julianday(${instant("t.created_time")}) AS at,
        LOWER(t.user_email) AS email, t.device_id, t.tool_id, t.action
      FROM tool_usage t CROSS JOIN bounds
      -- Unary + steers SQLite to the created_time range instead of every client row.
      WHERE ${all ? "t.source" : "+t.source"}='client' AND ${since("t.created_time")} AND julianday(${instant("t.created_time")})<=now_at
        AND ${inWindow("t.created_time")}
    ) SELECT period, date(at,'+7 hours') AS day, CAST(strftime('%H',at,'+7 hours') AS INTEGER) AS hour,
      tool_id, action, email, device_id, COUNT(*) AS actions
      FROM activity GROUP BY 1,2,3,4,5,6,7`);
  const people = await rows(`SELECT DISTINCT LOWER(u.email) AS email,
      COALESCE(NULLIF(TRIM(u.department), ''), 'Unknown') AS department,
      EXISTS (SELECT 1 FROM device d WHERE d.user_id=u.id) AS registered
      FROM users u`);
  const [quality] = await rows(`, recorded AS (
      SELECT source, julianday(${instant("created_time")}) AS at FROM tool_usage
    ) SELECT
      COALESCE(SUM(source!='client' AND at>=start_at AND at<end_at), 0) AS historical_rows,
      COALESCE(SUM(source='client' AND (at IS NULL OR at>now_at)), 0) AS invalid_or_future_rows,
      MIN(CASE WHEN source='client' AND at<=now_at THEN date(at,'+7 hours') END) AS first_recorded_day
      FROM recorded CROSS JOIN bounds`);
  const opens = await rows(`SELECT ${period("l.created_time")} AS period, COUNT(*) AS opens
      FROM (SELECT DISTINCT user_email,device_id,tool_id,action,created_time FROM usage_log
        WHERE action='open' AND ${since("created_time")}) l
      CROSS JOIN bounds WHERE ${inWindow("l.created_time")} GROUP BY 1`);
  const errors = await rows(`SELECT ${period("e.created_time")} AS period, COUNT(*) AS errors
      FROM error_events e CROSS JOIN bounds WHERE ${since("e.created_time")} AND ${inWindow("e.created_time")} GROUP BY 1`);

  const departmentOf = new Map();
  const registered = new Map();
  for (const person of people) {
    if (!departmentOf.has(person.email)) departmentOf.set(person.email, person.department);
    if (person.registered) {
      const members = registered.get(person.department) || new Set();
      members.add(person.email);
      registered.set(person.department, members);
    }
  }

  const group = (keyOf, init) => {
    const groups = new Map();
    return {
      add(row) {
        const key = keyOf(row);
        let entry = groups.get(key);
        if (!entry) groups.set(key, (entry = { ...init(row), actions: 0, people: new Set(), devices: new Set() }));
        entry.actions += row.actions;
        entry.people.add(row.email);
        entry.devices.add(row.device_id);
        return entry;
      },
      values: () => [...groups.values()],
    };
  };
  const totals = group(
    (row) => row.period,
    (row) => ({ period: row.period, operations: 0, output_actions: 0, overnight_actions: 0, overnight: new Set() }),
  );
  const daily = group(
    (row) => `${row.period}|${row.day}`,
    (row) => ({ period: row.period, day: row.day }),
  );
  const hourly = group(
    (row) => `${row.period}|${row.hour}`,
    (row) => ({ period: row.period, hour: row.hour }),
  );
  const cellGroups = group(
    (row) => `${row.day}|${row.hour}`,
    (row) => ({ day: row.day, hour: row.hour }),
  );
  const featureGroups = group(
    (row) => `${row.period}|${row.tool_id}|${row.category}`,
    (row) => ({ period: row.period, tool_id: row.tool_id, category: row.category }),
  );
  const departmentGroups = group(
    (row) => row.department,
    (row) => ({ department: row.department }),
  );
  const details = [];
  for (const source of grain) {
    const row = {
      ...source,
      category: outputAction(source.action) ? "output" : "operation",
      department: departmentOf.get(source.email) || "Unknown",
    };
    const total = totals.add(row);
    if (row.category === "operation") total.operations += row.actions;
    else total.output_actions += row.actions;
    if (row.hour < 6) {
      total.overnight_actions += row.actions;
      total.overnight.add(row.email);
    }
    daily.add(row);
    hourly.add(row);
    featureGroups.add(row);
    if (row.period !== "current") continue;
    cellGroups.add(row);
    departmentGroups.add(row);
    details.push(row);
  }

  const counted = ({ people: who, devices, ...entry }) => ({ ...entry, people: who.size, devices: devices.size });
  const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const emptyPeriod = { actions: 0, people: 0, devices: 0, operations: 0, output_actions: 0, overnight_actions: 0, overnight_people: 0 };
  const periodTotals = (name) => {
    const entry = totals.values().find((row) => row.period === name);
    const { overnight, ...rest } = entry ? counted(entry) : { overnight: new Set() };
    return {
      ...emptyPeriod,
      ...rest,
      overnight_people: overnight.size,
      opens: opens.find((row) => row.period === name)?.opens || 0,
      errors: errors.find((row) => row.period === name)?.errors || 0,
    };
  };
  const dailyRows = daily
    .values()
    .map(counted)
    .map(({ devices, ...row }) => row);
  const endDate = Date.parse(window.end_at);
  const firstDay = new Date(Date.parse(window.start_at) + 7 * 3600000);
  const firstDate = Date.UTC(firstDay.getUTCFullYear(), firstDay.getUTCMonth(), firstDay.getUTCDate()) - 7 * 3600000;
  const calendar = [];
  // Calendar padding is presentation only: zero means no recorded actions, not confirmed non-use.
  for (let at = firstDate; at < endDate && calendar.length < 3660; at += 86400000) {
    const day = new Date(at + 7 * 3600000).toISOString().slice(0, 10);
    calendar.push({ day, actions: 0, people: 0, ...dailyRows.find((row) => row.period === "current" && row.day === day) });
  }

  const activeDepartments = new Map(departmentGroups.values().map((entry) => [entry.department, counted(entry)]));
  const departmentNames = new Set([...registered.keys(), ...activeDepartments.keys()]);
  const departments = [...departmentNames]
    .map((department) => ({
      department,
      registered_people: registered.get(department)?.size || 0,
      active_people: activeDepartments.get(department)?.people || 0,
      devices: activeDepartments.get(department)?.devices || 0,
      actions: activeDepartments.get(department)?.actions || 0,
    }))
    .sort((a, b) => b.registered_people - a.registered_people || byText(a.department, b.department));

  details.sort((a, b) => byText(b.day, a.day) || b.hour - a.hour || b.actions - a.actions);
  return {
    periods: {
      current: { ...periodTotals("current"), start_at: window.start_at, end_at: window.end_at },
      previous: all ? null : { ...periodTotals("previous"), start_at: window.previous_start, end_at: window.previous_end },
      complete_days: !all && !today,
      today,
    },
    days: calendar,
    hours: hourly
      .values()
      .map(counted)
      .map(({ devices, ...row }) => row)
      .sort((a, b) => a.hour - b.hour),
    cells: cellGroups
      .values()
      .map(counted)
      .map(({ devices, ...row }) => row)
      .sort((a, b) => byText(a.day, b.day) || a.hour - b.hour),
    features: featureGroups
      .values()
      .map(counted)
      .map(({ devices, ...row }) => row)
      .sort((a, b) => b.actions - a.actions || byText(a.tool_id, b.tool_id)),
    departments,
    details: details.slice(0, 5000).map(({ period, email, ...row }) => ({
      day: row.day,
      hour: row.hour,
      tool_id: row.tool_id,
      action: row.action,
      category: row.category,
      user_email: email,
      device_id: row.device_id,
      department: row.department,
      actions: row.actions,
    })),
    details_truncated: details.length > 5000,
    quality: { ...quality, calendar_truncated: calendar.length === 3660 },
  };
}
