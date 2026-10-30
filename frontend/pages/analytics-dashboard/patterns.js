import { enhanceSearchableDropdowns } from "../../components/SearchableDropdown.js";

const number = (value) => new Intl.NumberFormat().format(Number(value) || 0);
const hourLabel = (hour) => `${String(hour).padStart(2, "0")}:00`;
const delta = (a, b) => `${a > b ? "+" : ""}${number(a - b)}`;

export function renderUsagePatterns(page, container, report) {
  const escape = (value) => page.escapeHtml(String(value ?? ""));
  const active = document.activeElement.closest(".ad-searchable-dropdown")?.querySelector("select") || document.activeElement;
  const focusKey = ["data-pattern-hour", "data-trend-day", "data-trend-select", "data-pattern-department", "data-pattern-reset"].find(
    (attribute) => container.contains(active) && active.hasAttribute(attribute),
  );
  const focusValue = focusKey ? active.getAttribute(focusKey) : null;
  const scroll = container.querySelector(".usage-patterns")?.scrollTop || 0;
  const { periods, days, hours, cells, features, departments, details, quality } = report;
  const current = periods.current;
  const previous = periods.previous;
  const day = days.some((row) => row.day === page.trendDay) ? page.trendDay : "";
  const selectedHour = Number.isInteger(page.patternHour) ? page.patternHour : null;
  const date = (value) =>
    new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "Asia/Jakarta",
    }).format(new Date(value));
  const windowLabel = (period) =>
    periods.today
      ? `${date(period.start_at)} · through ${new Intl.DateTimeFormat(undefined, {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          timeZone: "Asia/Jakarta",
        }).format(new Date(period.end_at))}`
      : `${date(period.start_at)} – ${date(new Date(Date.parse(period.end_at) - 1).toISOString())}`;
  const table = (name, headers, rows) => `<div class="table-wrapper" tabindex="0" role="region" aria-label="${escape(name)}">
    <table class="dashboard-table"><thead><tr>${headers.map((header) => `<th scope="col">${escape(header)}</th>`).join("")}
    </tr></thead><tbody>${rows}</tbody></table></div>`;
  const metric = page.patternMetric === "actions" ? "actions" : "people";
  const currentHours = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    current: hours.find((row) => row.period === "current" && row.hour === hour)?.[metric] || 0,
    previous: hours.find((row) => row.period === "previous" && row.hour === hour)?.[metric] || 0,
  }));
  const max = Math.max(1, ...currentHours.flatMap((row) => [row.current, row.previous]));
  const peak = currentHours.reduce((best, row) => (row.current > best.current ? row : best), currentHours[0]);
  const peakText = peak.current ? `${hourLabel(peak.hour)}–${hourLabel((peak.hour + 1) % 24)}` : "No recorded activity";
  const notices = [];
  const jakartaDay = (value) => new Date(Date.parse(value) + 7 * 3600000).toISOString().slice(0, 10);
  if (quality.first_recorded_day && jakartaDay(current.start_at) < quality.first_recorded_day) {
    notices.push(`Directly recorded actions begin ${quality.first_recorded_day}. Earlier empty dates do not establish non-use.`);
  }
  if (previous && jakartaDay(previous.start_at) < (quality.first_recorded_day || "9999")) {
    notices.push("The previous period extends before directly recorded coverage; its lower counts may reflect missing data.");
  }
  const earliest = previous?.start_at || current.start_at;
  if (earliest < "2026-09-28T17:00:00Z" && current.end_at > "2026-09-12T17:00:00Z") {
    notices.push("Collection was interrupted during 13–28 September. Comparisons across that gap are incomplete.");
  }
  if (earliest < "2026-10-29T13:28:00Z") {
    notices.push("Some timestamps before the 29 October repair remain unverified. Treat historical hour patterns cautiously.");
  }
  const evidence = details.filter(
    (row) =>
      (!day || row.day === day) &&
      (selectedHour === null || row.hour === selectedHour) &&
      (!page.patternDepartment || row.department === page.patternDepartment),
  );
  const groups = new Map();
  for (const row of evidence) {
    const key = JSON.stringify([row.tool_id, row.action]);
    if (!groups.has(key)) groups.set(key, { tool: row.tool_id, action: row.action, count: 0, people: new Set(), devices: new Set() });
    const group = groups.get(key);
    group.count += row.actions;
    group.people.add(row.user_email);
    group.devices.add(row.device_id);
  }
  const featureRows = [...groups.values()].sort((a, b) => b.count - a.count);
  const people = [...new Set(evidence.map((row) => row.user_email))].sort();
  const toolNames = [...new Set(features.map((row) => row.tool_id))].sort();
  const featureCount = (tool, period, category) =>
    features
      .filter((row) => row.tool_id === tool && row.period === period && row.category === category)
      .reduce((sum, row) => sum + row.actions, 0);
  const maxDay = Math.max(1, ...days.map((row) => row.people));
  const maxCell = Math.max(1, ...cells.map((row) => row[metric]));
  const cellMap = new Map(cells.map((row) => [`${row.day}:${row.hour}`, row]));
  container.innerHTML = `<section class="daily-trends usage-patterns">
    <div class="analysis-heading"><h2>When people use the tools</h2><span>Jakarta · ${periods.complete_days ? "Completed days" : periods.today ? "Today so far" : "Recorded history"}</span></div>
    <section aria-labelledby="pattern-hours-title">
      <div class="analysis-heading"><h2 id="pattern-hours-title">Usage by hour</h2>
        <div class="pattern-metrics" role="group" aria-label="Chart measure">
          ${["people", "actions"]
            .map(
              (value) => `<button type="button" class="btn btn-secondary btn-sm" data-pattern-metric="${value}"
            aria-pressed="${metric === value}">${value === "people" ? "People" : "Tool actions"}</button>`,
            )
            .join("")}
        </div></div>
      <p class="pattern-observation">Most active hour: <strong>${escape(peakText)}</strong>.
        Between 00:00 and 06:00: <strong>${number(current.overnight_people)} ${current.overnight_people === 1 ? "person" : "people"}</strong>, ${number(current.overnight_actions)} ${current.overnight_actions === 1 ? "action" : "actions"}.</p>
      <div class="pattern-legend"><span><i class="pattern-swatch current"></i>Selected period</span>
        ${previous ? '<span><i class="pattern-swatch previous"></i>Previous period</span>' : ""}</div>
      <div class="pattern-hour-scroll" tabindex="0" role="region" aria-label="Hourly activity chart">
        <div class="pattern-hours">${currentHours
          .map(
            (row) => `<button type="button" class="pattern-hour"
          data-pattern-hour="${row.hour}" aria-pressed="${selectedHour === row.hour}"
          aria-label="${hourLabel(row.hour)}, ${number(row.current)} ${metric}, previous ${number(row.previous)}"
          title="${hourLabel(row.hour)}: ${number(row.current)} ${metric}; previous ${number(row.previous)}">
          <span class="pattern-hour-bars"><span class="pattern-hour-current" style="height:${(row.current / max) * 100}%"></span>
          ${previous ? `<span class="pattern-hour-previous" style="height:${(row.previous / max) * 100}%"></span>` : ""}</span>
          <span>${String(row.hour).padStart(2, "0")}</span></button>`,
          )
          .join("")}</div>
      </div>
    </section>
    <section class="period-comparison" aria-label="Period comparison">
      ${table(
        "Period comparison",
        [
          "",
          `Selected period · ${windowLabel(current)}`,
          previous ? `Previous period · ${windowLabel(previous)}` : "Previous period",
          "Difference",
        ],
        [
          ["People with tool actions", "people"],
          ["Devices with tool actions", "devices"],
          ["Other tool actions", "operations"],
          ["Copy / download / export", "output_actions"],
          ["Tool opens", "opens"],
          ["Error reports", "errors"],
        ]
          .map(
            ([label, key]) => `<tr><th scope="row">${label}</th><td>${number(current[key])}</td>
          <td>${previous ? number(previous[key]) : "—"}</td><td>${previous ? delta(current[key], previous[key]) : "—"}</td></tr>`,
          )
          .join(""),
      )}
      ${previous ? "" : '<p class="pattern-note">All time has no preceding period. Choose a date range to compare.</p>'}
    </section>
    ${notices.length ? `<details class="pattern-quality"><summary>Coverage limits</summary>${notices.map((notice) => `<p>${escape(notice)}</p>`).join("")}</details>` : ""}
    <section aria-labelledby="pattern-calendar-title"><div class="analysis-heading"><h2 id="pattern-calendar-title">Days & hours</h2>
      <span>Shade shows recorded ${metric}</span></div>
      <div class="pattern-heatmap-scroll" tabindex="0" role="region" aria-label="Daily hourly activity">
        <div class="pattern-heatmap"><span></span>${Array.from({ length: 24 }, (_, hour) => `<span class="heatmap-hour">${String(hour).padStart(2, "0")}</span>`).join("")}
          ${days
            .map(
              (row) => `<button type="button" class="heatmap-date" data-trend-day="${escape(row.day)}"
            aria-pressed="${day === row.day}">${escape(row.day.slice(5))}</button>${Array.from({ length: 24 }, (_, hour) => {
              const cell = cellMap.get(`${row.day}:${hour}`);
              const count = cell?.[metric] || 0;
              return `<button type="button" class="heatmap-cell" data-pattern-cell-day="${escape(row.day)}" data-pattern-cell-hour="${hour}"
                style="--cell-strength:${count ? 0.2 + (count / maxCell) * 0.8 : 0}"
                aria-pressed="${day === row.day && selectedHour === hour}"
                tabindex="${(day || days[0]?.day) === row.day && (selectedHour ?? 0) === hour ? 0 : -1}"
                aria-label="${escape(row.day)}, ${hourLabel(hour)}: ${number(count)} recorded ${metric}"
                title="${escape(row.day)} ${hourLabel(hour)} · ${number(count)} recorded ${metric}"></button>`;
            }).join("")}`,
            )
            .join("")}
        </div></div>
    </section>
    <section><div class="analysis-heading"><h2>Daily activity</h2><span>People with tool actions</span></div>
      <div class="trend-chart-scroll"><div class="trend-chart" style="--day-count:${days.length}">${days
        .map(
          (row) =>
            `<button type="button" class="trend-day" data-trend-day="${escape(row.day)}" aria-pressed="${day === row.day}"
          aria-label="${escape(row.day)}: ${number(row.people)} people, ${number(row.actions)} actions">
          <span class="trend-bar-space"><span class="trend-bar" style="height:${(row.people / maxDay) * 100}%"></span></span>
          <span>${escape(row.day.slice(5))}</span></button>`,
        )
        .join("")}</div></div>
    </section>
    <section class="pattern-evidence" aria-labelledby="pattern-evidence-title">
      <div class="analysis-heading"><h2 id="pattern-evidence-title">${day ? escape(day) : "Selected period"}${selectedHour !== null ? ` · ${hourLabel(selectedHour)}–${hourLabel((selectedHour + 1) % 24)}` : ""}</h2>
        <button type="button" class="btn btn-secondary btn-sm" data-pattern-reset>Show whole period</button></div>
      <div class="day-comparison-controls"><label>Day <select data-trend-select="day"><option value="">Whole period</option>
        ${[...days]
          .reverse()
          .map((row) => `<option value="${escape(row.day)}"${row.day === day ? " selected" : ""}>${escape(row.day)}</option>`)
          .join("")}</select></label>
        <label>Department <select data-pattern-department><option value="">All departments</option>
          ${departments.map((row) => `<option value="${escape(row.department)}"${row.department === page.patternDepartment ? " selected" : ""}>${escape(row.department)}</option>`).join("")}</select></label></div>
      ${report.details_truncated ? '<p class="pattern-note">Detail is limited to the latest 5,000 grouped records. Charts and period totals use the full data. Narrow the date range for complete detail.</p>' : ""}
      ${
        featureRows.length
          ? table(
              "Features in selected day and hour",
              ["Tool", "Action", "Tool actions", "People", "Devices"],
              featureRows
                .map(
                  (row) => `<tr><th scope="row">${escape(page.formatToolName(row.tool))}</th>
          <td>${escape(page.formatActionName(row.action))}</td><td>${number(row.count)}</td><td>${number(row.people.size)}</td><td>${number(row.devices.size)}</td></tr>`,
                )
                .join(""),
            )
          : '<p class="panel-empty">No recorded tool actions in this selection.</p>'
      }
      <div class="pattern-people">${people
        .map(
          (person) => `<button type="button" class="btn btn-secondary btn-sm"
        data-pattern-person="${escape(person)}">${escape(person)}</button>`,
        )
        .join("")}</div>
    </section>
    <section><h2>Features across periods</h2>${table(
      "Features across periods",
      ["Tool", "Other actions", "Copy / export", "Previous actions", "Difference"],
      toolNames
        .map((tool) => {
          const operation = featureCount(tool, "current", "operation");
          const output = featureCount(tool, "current", "output");
          const before = featureCount(tool, "previous", "operation") + featureCount(tool, "previous", "output");
          return `<tr><th scope="row">${escape(page.formatToolName(tool))}</th><td>${number(operation)}</td><td>${number(output)}</td>
          <td>${previous ? number(before) : "—"}</td><td>${previous ? delta(operation + output, before) : "—"}</td></tr>`;
        })
        .join("") || '<tr><td colspan="5">No recorded feature activity.</td></tr>',
    )}</section>
    <section class="department-summary"><h2>Departments</h2>${table(
      "Department population and activity",
      ["Department", "Registered people", "Active people", "Active devices", "Tool actions"],
      departments
        .map(
          (row) => `<tr><th scope="row">${escape(row.department)}</th><td>${number(row.registered_people)}</td>
        <td>${number(row.active_people)}</td><td>${number(row.devices)}</td><td>${number(row.actions)}</td></tr>`,
        )
        .join("") || '<tr><td colspan="5">No registered people.</td></tr>',
    )}
      <p class="pattern-note">Registered people have a non-excluded device. Active people recorded a tool action in this period. Departments use the current profile.</p>
    </section>
    <details class="counting-help"><summary>What these numbers mean</summary>
      <p>Tool actions are recorded operations and output actions, not unique tasks, productivity, or time saved. One task can generate several actions.
        People are counted once by email in each period, hour, or selection; hourly people counts must not be added together.</p>
      <p>App opens and error reports are shown separately. A zero means no recorded activity, not proven non-use.
        Development devices are excluded. Legacy reconstructed actions (${number(quality.historical_rows)} in this period) are excluded from pattern comparisons.
        Invalid or future-dated records (${number(quality.invalid_or_future_rows)}) are excluded.</p>
      <p>${periods.today ? "Today compares the same elapsed hours yesterday." : periods.complete_days ? "Multi-day ranges end at midnight today so both periods contain complete Jakarta days." : "All time shows directly recorded history without a prior-period comparison."}
        Copy, download, and export categories follow recorded action names. Overnight means 00:00–05:59 Jakarta; it does not establish when a person was working.</p>
    </details>
  </section>`;
  const redraw = () => renderUsagePatterns(page, container, report);
  const inspect = () => {
    redraw();
    container.querySelector(".pattern-evidence")?.scrollIntoView({ block: "start" });
  };
  const heatCells = [...container.querySelectorAll(".heatmap-cell")];
  heatCells.forEach((button, index) =>
    button.addEventListener("keydown", (event) => {
      const step = { ArrowRight: 1, ArrowLeft: -1, ArrowUp: -24, ArrowDown: 24 }[event.key];
      if (!step) return;
      event.preventDefault();
      const next = heatCells[Math.max(0, Math.min(heatCells.length - 1, index + step))];
      button.tabIndex = -1;
      next.tabIndex = 0;
      next.focus();
    }),
  );
  container.querySelectorAll("[data-pattern-hour]").forEach((button) =>
    button.addEventListener("click", () => {
      page.patternHour = Number(button.dataset.patternHour);
      inspect();
    }),
  );
  container.querySelectorAll("[data-pattern-cell-day]").forEach((button) =>
    button.addEventListener("click", () => {
      page.trendDay = button.dataset.patternCellDay;
      page.patternHour = Number(button.dataset.patternCellHour);
      inspect();
    }),
  );
  container.querySelectorAll("[data-trend-day]").forEach((button) =>
    button.addEventListener("click", () => {
      page.trendDay = button.dataset.trendDay;
      inspect();
    }),
  );
  container.querySelector("[data-trend-select]").addEventListener("change", (event) => {
    page.trendDay = event.target.value;
    redraw();
  });
  container.querySelector("[data-pattern-department]").addEventListener("change", (event) => {
    page.patternDepartment = event.target.value;
    redraw();
  });
  container.querySelector("[data-pattern-reset]").addEventListener("click", () => {
    page.trendDay = "";
    page.patternHour = null;
    page.patternDepartment = "";
    redraw();
  });
  container.querySelectorAll("[data-pattern-metric]").forEach((button) =>
    button.addEventListener("click", () => {
      page.patternMetric = button.dataset.patternMetric;
      redraw();
      container.querySelector(`[data-pattern-metric="${page.patternMetric}"]`)?.focus({ preventScroll: true });
    }),
  );
  container
    .querySelectorAll("[data-pattern-person]")
    .forEach((button) => button.addEventListener("click", () => page.openPerson(button.dataset.patternPerson)));
  enhanceSearchableDropdowns(container);
  container.querySelector(".usage-patterns").scrollTop = scroll;
  if (focusKey) {
    const control = [...container.querySelectorAll(`[${focusKey}]`)].find((element) => element.getAttribute(focusKey) === focusValue);
    (control?.closest(".ad-searchable-dropdown")?.querySelector(".ad-searchable-dropdown-trigger") || control)?.focus({
      preventScroll: true,
    });
  }
}
