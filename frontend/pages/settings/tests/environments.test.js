// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { SettingsPage } from "../main.js";
import { readEnvironments, writeEnvironments } from "../../../core/Environments.js";

const ORACLE_KEY = "config.oracle.connections";

function mount(runtime = "web") {
  const page = new SettingsPage();
  page.runtime = runtime;
  const item = page.renderItem({ key: "config.environments", type: "environments", label: "Environments" });
  document.body.appendChild(item);
  return item;
}

function submit(item) {
  item.querySelector(".environment-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

beforeEach(() => {
  localStorage.clear();
  document.body.replaceChildren();
});

describe("Testing Environments editor", () => {
  it("shows migrated environments and adds one with both CDN URLs on Web", () => {
    localStorage.setItem("config.baseUrls", JSON.stringify([{ key: "UAT1", value: "https://public.uat1.example/" }]));
    const item = mount();
    expect(item.querySelectorAll(".environment-row")).toHaveLength(1);
    expect(item.textContent).toContain("UAT1");

    item.querySelector(".environment-add-btn").click();
    item.querySelector(".environment-name").value = "UAT2";
    item.querySelector(".environment-public-url").value = "https://public.uat2.example/";
    item.querySelector(".environment-direct-url").value = "https://10.0.0.2:5501/";
    submit(item);

    expect(readEnvironments().map(({ name, cdnPublicUrl, cdnDirectUrl }) => [name, cdnPublicUrl, cdnDirectUrl])).toEqual([
      ["UAT1", "https://public.uat1.example", ""],
      ["UAT2", "https://public.uat2.example", "https://10.0.0.2:5501"],
    ]);
    expect(item.querySelectorAll(".environment-row")).toHaveLength(2);
  });

  it("binds both database slots on Desktop and preserves them through a Web edit", () => {
    localStorage.setItem(
      ORACLE_KEY,
      JSON.stringify([
        { name: "CORE", connect_string: "db:1521/CORE" },
        { name: "EXTRA", connect_string: "db:1521/EXTRA" },
      ]),
    );
    writeEnvironments([{ name: "UAT1", criticalConnection: "CORE", cdnPublicUrl: "https://public.uat1.example/" }]);

    const desktop = mount("tauri");
    desktop.querySelector(".environment-edit").click();
    expect([...desktop.querySelector(".environment-critical").options].map((option) => option.value)).toEqual(["", "CORE", "EXTRA"]);
    expect(desktop.querySelector(".environment-critical").value).toBe("CORE");
    desktop.querySelector(".environment-complementary").value = "EXTRA";
    submit(desktop);
    expect(readEnvironments()[0]).toMatchObject({ criticalConnection: "CORE", complementaryConnection: "EXTRA" });

    desktop.remove();
    const web = mount("web");
    web.querySelector(".environment-edit").click();
    web.querySelector(".environment-public-url").value = "https://public.uat1b.example/";
    submit(web);
    expect(readEnvironments()[0]).toMatchObject({
      criticalConnection: "CORE",
      complementaryConnection: "EXTRA",
      cdnPublicUrl: "https://public.uat1b.example",
    });
  });

  it("rejects duplicate names and non-http URLs without writing", () => {
    writeEnvironments([{ name: "UAT1", cdnPublicUrl: "https://public.uat1.example/" }]);
    const item = mount();

    item.querySelector(".environment-add-btn").click();
    item.querySelector(".environment-name").value = "uat1";
    submit(item);
    expect(item.querySelector(".environment-form-status").textContent).toContain("already in use");

    item.querySelector(".environment-name").value = "UAT2";
    item.querySelector(".environment-public-url").value = "ftp://example.com/";
    submit(item);
    expect(item.querySelector(".environment-form-status").textContent).toContain("http(s)");
    expect(readEnvironments().map((environment) => environment.name)).toEqual(["UAT1"]);
  });
});
