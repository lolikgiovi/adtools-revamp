import toolsConfig from "../../config/tools.json";

const TOOL_NAMES = new Map(toolsConfig.tools.map((tool) => [tool.id, tool.name]));
const number = (value) => new Intl.NumberFormat().format(Number(value) || 0);
const lastActive = (value) =>
  value
    ? new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value))
    : "—";

/** Which departments use AD Tools, and which tools each department uses. */
export function renderDepartmentUsage(page, container, { departments = [], tools = [], people = [] }) {
  const escape = (value) => page.escapeHtml(String(value ?? ""));
  const toolName = (id) => TOOL_NAMES.get(id) || page.formatToolName(id);
  const metric = page.departmentMetric === "actions" ? "actions" : "people";
  if (!departments.length) {
    container.innerHTML = '<div class="panel-empty">No registered departments yet.</div>';
    return;
  }

  const maxRegistered = Math.max(1, ...departments.map((row) => Math.max(row.registered_people, row.active_people)));
  const summary = `<section class="department-section" aria-labelledby="department-summary-heading">
    <h2 id="department-summary-heading">Departments</h2>
    <div class="table-wrapper" tabindex="0" role="region" aria-label="Departments">
    <table class="dashboard-table department-table"><thead><tr>
      <th scope="col">Department</th><th scope="col">Active / registered</th><th scope="col" class="numeric">Actions</th>
      <th scope="col" class="numeric">Tools</th><th scope="col" class="numeric">Devices</th><th scope="col">Last active</th>
    </tr></thead><tbody>${departments
      .map((row) => {
        const registered = Math.max(row.registered_people, row.active_people);
        const picked = page.departmentFilter === row.department;
        return `<tr class="department-row${row.active_people ? "" : " is-idle"}"><th scope="row">
          <button type="button" class="department-filter" data-department-filter="${escape(row.department)}" aria-pressed="${picked}">
          ${escape(row.department)}</button></th>
        <td><span class="department-adoption">
          <span class="department-adoption-track" style="--registered:${(registered / maxRegistered) * 100}%" aria-hidden="true">
            <span style="width:${(row.active_people / maxRegistered) * 100}%"></span></span>
          <span>${number(row.active_people)} / ${number(registered)}</span></span></td>
        <td class="numeric">${number(row.actions)}</td><td class="numeric">${number(row.tools)}</td>
        <td class="numeric">${number(row.devices)}</td><td>${escape(lastActive(row.last_active))}</td></tr>`;
      })
      .join("")}</tbody></table></div></section>`;

  const columns = departments.filter((row) => row.active_people).map((row) => row.department);
  const byTool = new Map();
  for (const row of tools) {
    if (!byTool.has(row.tool_id)) byTool.set(row.tool_id, { people: 0, actions: 0, cells: new Map() });
    const entry = byTool.get(row.tool_id);
    entry.people += row.people;
    entry.actions += row.actions;
    entry.cells.set(row.department, row);
  }
  const rows = [...byTool].sort(([a, left], [b, right]) => right[metric] - left[metric] || toolName(a).localeCompare(toolName(b)));
  const max = Math.max(1, ...tools.map((row) => row[metric]));
  const metricButton = (id, label) =>
    `<button type="button" data-department-metric="${id}" aria-pressed="${metric === id}">${label}</button>`;
  const cell = (department, id, entry) => {
    const row = entry.cells.get(department);
    const value = row?.[metric] || 0;
    const strength = value ? 0.12 + (value / max) * 0.78 : 0;
    const title = `${department} · ${toolName(id)}: ${number(row?.people)} people, ${number(row?.actions)} actions`;
    return `<td class="numeric department-cell${strength > 0.55 ? " is-strong" : ""}" data-cell="${escape(`${department}:${id}`)}"
      style="--strength:${strength.toFixed(3)}" title="${escape(title)}">${value ? number(value) : ""}</td>`;
  };
  const matrix = `<section class="department-section" aria-labelledby="department-matrix-heading">
    <div class="department-section-heading"><h2 id="department-matrix-heading">Tools by department</h2>
      <div class="department-metric" role="group" aria-label="Count">${metricButton("people", "People")}${metricButton("actions", "Actions")}</div>
    </div>
    ${
      rows.length
        ? `<div class="table-wrapper" tabindex="0" role="region" aria-label="Tools by department">
      <table class="dashboard-table department-matrix"><thead><tr><th scope="col">Tool</th>${columns
        .map((name) => `<th scope="col" class="numeric">${escape(name)}</th>`)
        .join("")}</tr></thead><tbody>${rows
        .map(
          ([id, entry]) => `<tr><th scope="row">${escape(toolName(id))}</th>${columns.map((name) => cell(name, id, entry)).join("")}</tr>`,
        )
        .join("")}</tbody></table></div>`
        : '<div class="panel-empty">No tool activity in this period.</div>'
    }</section>`;

  const shown = people.filter((row) => !page.departmentFilter || row.department === page.departmentFilter);
  const role = (value) => (value ? String(value).charAt(0) + String(value).slice(1).toLowerCase() : "—");
  const directory = `<section class="department-section" aria-labelledby="department-people-heading">
    <h2 id="department-people-heading">People${page.departmentFilter ? ` · ${escape(page.departmentFilter)}` : ""}</h2>
    ${
      shown.length
        ? `<div class="table-wrapper" tabindex="0" role="region" aria-label="People">
      <table class="dashboard-table department-people"><thead><tr>
        <th scope="col">Person</th><th scope="col">Department</th><th scope="col">Role</th><th scope="col" class="numeric">Actions</th>
        <th scope="col">Top tool</th><th scope="col" class="numeric">Devices</th><th scope="col">Last active</th>
      </tr></thead><tbody>${shown
        .map(
          (row) => `<tr class="${row.uses ? "" : "is-idle"}"><th scope="row">
          <button type="button" class="person-link" data-person="${escape(row.user_email)}">${escape(row.user_email)}</button></th>
          <td>${escape(row.department)}</td><td>${escape(role(row.role))}</td><td class="numeric">${number(row.uses)}</td>
          <td>${row.top_tool ? escape(toolName(row.top_tool)) : "—"}</td><td class="numeric">${number(row.devices)}</td>
          <td>${escape(lastActive(row.last_active))}</td></tr>`,
        )
        .join("")}</tbody></table></div>`
        : '<div class="panel-empty">No people in this department.</div>'
    }</section>`;

  container.innerHTML = `<div class="department-usage">${summary}${directory}${matrix}</div>`;
  const rerender = () => renderDepartmentUsage(page, container, { departments, tools, people });
  container.querySelectorAll("[data-department-filter]").forEach((button) =>
    button.addEventListener("click", () => {
      const department = button.dataset.departmentFilter;
      page.departmentFilter = page.departmentFilter === department ? null : department;
      rerender();
      [...container.querySelectorAll("[data-department-filter]")].find((el) => el.dataset.departmentFilter === department)?.focus();
    }),
  );
  container
    .querySelectorAll(".department-people [data-person]")
    .forEach((button) => button.addEventListener("click", () => page.openPerson(button.dataset.person)));
  container.querySelectorAll("[data-department-metric]").forEach((button) =>
    button.addEventListener("click", () => {
      page.departmentMetric = button.dataset.departmentMetric;
      rerender();
      container.querySelector(`[data-department-metric="${page.departmentMetric}"]`)?.focus();
    }),
  );
}
