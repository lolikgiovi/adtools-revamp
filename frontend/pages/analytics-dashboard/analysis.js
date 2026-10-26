import { enhanceSearchableDropdowns } from "../../components/SearchableDropdown.js";

const number = (value) => new Intl.NumberFormat().format(Number(value) || 0);
const change = (current, previous) => {
  const delta = Number(current) - Number(previous);
  const absolute = `${delta > 0 ? "+" : ""}${number(delta)}`;
  return Number(previous) > 0 ? `${absolute} (${delta > 0 ? "+" : ""}${Math.round((delta / previous) * 100)}%)` : absolute;
};
const table = (headers, rows) =>
  `<div class="table-wrapper" tabindex="0" role="region" aria-label="${{ Metric: "Day comparison", Day: "Daily usage", Person: "Device health" }[headers[0]]}"><table class="dashboard-table"><thead><tr>${headers
    .map((header) => `<th scope="col">${header}</th>`)
    .join("")}</tr></thead><tbody>${rows}</tbody></table></div>`;

function preserveControlFocus(container) {
  const active = document.activeElement.closest(".ad-searchable-dropdown")?.querySelector("select") || document.activeElement;
  if (!container.contains(active)) return () => {};
  const attribute = ["data-trend-day", "data-trend-select", "data-device-filter"].find((name) => active.hasAttribute(name));
  if (!attribute) return () => {};
  const value = active.getAttribute(attribute);
  return () => {
    const control = [...container.querySelectorAll(`[${attribute}]`)].find((element) => element.getAttribute(attribute) === value);
    const target = control?.closest(".ad-searchable-dropdown")?.querySelector(".ad-searchable-dropdown-trigger") || control;
    target?.focus({ preventScroll: true });
  };
}

export function renderTrends(page, container, data) {
  const restoreFocus = preserveControlFocus(container);
  const escape = (value) => page.escapeHtml(String(value ?? ""));
  if (!data.length) {
    container.innerHTML = '<p class="panel-empty">No daily usage recorded.</p>';
    return;
  }
  const label = (row) => `${page.formatDateValue(row.day)}${row.partial_day ? " · In progress" : ""}`;
  const selected = data.find((row) => row.day === page.trendDay) || data.at(-1);
  const comparison = data.find((row) => row.day === page.trendComparison) || data.at(-2);
  const options = (value) =>
    [...data]
      .reverse()
      .map((row) => `<option value="${escape(row.day)}"${row.day === value ? " selected" : ""}>${escape(label(row))}</option>`)
      .join("");
  const peak = Math.max(1, ...data.map((row) => Number(row.successful_uses)));
  container.innerHTML = `<section class="daily-trends">
    <div class="analysis-heading"><h2>Daily usage</h2><span>Jakarta time · Today is incomplete</span></div>
    <div class="trend-chart-scroll"><div class="trend-chart" style="--day-count:${data.length}">${data
      .map(
        (row) =>
          `<button type="button" class="trend-day${row.partial_day ? " is-partial" : ""}" data-trend-day="${escape(row.day)}"
        aria-label="${escape(label(row))}: ${number(row.successful_uses)} successful uses, ${number(row.active_people)} people"
        aria-pressed="${row.day === selected.day}" title="${escape(label(row))}: ${number(row.successful_uses)} uses">
        <span class="trend-bar-space"><span class="trend-bar" style="height:${(Number(row.successful_uses) / peak) * 100}%"></span></span>
        <span>${escape(row.day.slice(5))}</span></button>`,
      )
      .join("")}</div></div>
    <div class="day-comparison-controls"><label>Compare <select data-trend-select="day">${options(selected.day)}</select></label>
      ${comparison ? `<label>with <select data-trend-select="comparison">${options(comparison.day)}</select></label>` : ""}</div>
    ${
      comparison
        ? table(
            ["Metric", escape(label(selected)), escape(label(comparison)), "Change"],
            [
              ["Successful uses", "successful_uses"],
              ["Active people", "active_people"],
              ["Active devices", "active_devices"],
            ]
              .map(
                ([name, key]) => `<tr><th scope="row">${name}</th><td>${number(selected[key])}</td>
          <td>${number(comparison[key])}</td><td>${change(selected[key], comparison[key])}</td></tr>`,
              )
              .join(""),
          )
        : ""
    }
    ${table(
      ["Day", "Successful uses", "vs. previous day", "Active people", "Active devices"],
      [...data]
        .reverse()
        .map(
          (row) =>
            `<tr><th scope="row">${escape(label(row))}</th><td>${number(row.successful_uses)}</td>
        <td>${change(row.successful_uses, row.previous_uses)}</td><td>${number(row.active_people)}</td>
        <td>${number(row.active_devices)}</td></tr>`,
        )
        .join(""),
    )}
    <details class="counting-help"><summary>How days are counted</summary><p>Successful uses count completed tool actions.
      Days with no recorded uses show zero. Today is still in progress; compare completed days for a full-day trend.
      Changes from zero show the count difference without a percentage.</p></details>
  </section>`;
  const chartScroll = container.querySelector(".trend-chart-scroll");
  const selectedBar = container.querySelector('.trend-day[aria-pressed="true"]');
  chartScroll.scrollLeft = selectedBar.offsetLeft - chartScroll.offsetLeft - chartScroll.clientWidth / 2;
  container.querySelectorAll("[data-trend-day]").forEach((button) =>
    button.addEventListener("click", () => {
      page.trendDay = button.dataset.trendDay;
      renderTrends(page, container, data);
    }),
  );
  container.querySelectorAll("[data-trend-select]").forEach((select) =>
    select.addEventListener("change", () => {
      if (select.dataset.trendSelect === "day") page.trendDay = select.value;
      else page.trendComparison = select.value;
      renderTrends(page, container, data);
    }),
  );
  enhanceSearchableDropdowns(container);
  restoreFocus();
}

export function renderDeviceHealth(page, container, data) {
  const restoreFocus = preserveControlFocus(container);
  const escape = (value) => page.escapeHtml(String(value ?? ""));
  const activity = ["All activity", "Active", "Quiet 7–29 days", "Inactive 30+ days", "Unknown"];
  const versions = ["All versions", "Up to date", "Older version", "Ahead of stable", "Unknown"];
  const filter = (values, selected) =>
    values.map((value) => `<option${value === selected ? " selected" : ""}>${escape(value)}</option>`).join("");
  const rows = page
    .filterRows(data)
    .filter(
      (row) =>
        (!page.deviceActivityFilter || row.activity_status === page.deviceActivityFilter) &&
        (!page.deviceVersionFilter || row.version_status === page.deviceVersionFilter),
    );
  const stable = data.find((row) => row.stable_version)?.stable_version;
  const counts = [
    ["Devices", data.length],
    ["Up to date", data.filter((row) => row.version_status === "Up to date").length],
    ["Older version", data.filter((row) => row.version_status === "Older version").length],
    ["Inactive 30+ days", data.filter((row) => row.activity_status === "Inactive 30+ days").length],
  ];
  container.innerHTML = `<section class="device-health">
    <div class="analysis-heading"><h2>Devices</h2><span>${stable ? `Stable release ${escape(stable)}` : "Stable release unavailable"}</span></div>
    <dl class="overview-stats">${counts.map(([name, count]) => `<div><dt>${name}</dt><dd>${number(count)}</dd></div>`).join("")}</dl>
    <div class="device-filters"><label>Activity <select data-device-filter="activity">${filter(activity, page.deviceActivityFilter || activity[0])}</select></label>
      <label>Version <select data-device-filter="version">${filter(versions, page.deviceVersionFilter || versions[0])}</select></label>
      <span role="status">${number(rows.length)} of ${number(data.length)} devices</span></div>
    ${
      rows.length
        ? table(
            ["Person", "Device", "Platform", "Version", "Update status", "Last seen · Jakarta", "Activity"],
            rows
              .map(
                (row) =>
                  `<tr><th scope="row">${escape(row.user_email)}</th><td class="device-identifier">${escape(row.device_id)}</td>
        <td>${escape(row.platform)}</td><td>${escape(row.app_version || "Unknown")}</td><td>${escape(row.version_status)}</td>
        <td>${row.last_seen ? escape(new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(row.last_seen))) : "Unknown"}
          ${row.days_since_seen !== null ? `<small class="device-age">${number(row.days_since_seen)} days ago</small>` : ""}</td>
        <td>${escape(row.activity_status)}</td></tr>`,
              )
              .join(""),
          )
        : '<p class="panel-empty">No matching devices.</p>'
    }
    <details class="counting-help"><summary>About device status</summary><p>Active: seen in the last 7 days. Quiet: 7–29 days.
      Inactive: 30 or more days. Last seen uses the latest device check-in or recorded tool activity.
      Inactivity does not prove a device was abandoned. Versions are last reported values compared with the published stable release.</p></details>
  </section>`;
  container.querySelectorAll("[data-device-filter]").forEach((select) =>
    select.addEventListener("change", () => {
      if (select.dataset.deviceFilter === "activity") page.deviceActivityFilter = select.selectedIndex ? select.value : "";
      else page.deviceVersionFilter = select.selectedIndex ? select.value : "";
      renderDeviceHealth(page, container, data);
    }),
  );
  enhanceSearchableDropdowns(container);
  restoreFocus();
}
