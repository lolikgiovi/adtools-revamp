// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearConnectionReference,
  joinUrl,
  listBaseUrls,
  mergeLegacyBaseUrls,
  normalizeBaseUrl,
  normalizePath,
  readEnvironments,
  resolveConnection,
  updateConnectionReference,
  writeEnvironments,
} from "../Environments.js";

const BASE_URLS_KEY = "config.baseUrls";
const ORACLE_KEY = "config.oracle.connections";

function connection(name, connectString = `db:1521/${name}`) {
  return { name, connect_string: connectString };
}

beforeEach(() => {
  localStorage.clear();
});

describe("environment migration", () => {
  it("unions CDN environments and Oracle connection names into one list", () => {
    localStorage.setItem(
      BASE_URLS_KEY,
      JSON.stringify([
        { key: "uat1", value: "https://public.uat1.example/" },
        { key: "SIT", value: "https://public.sit.example/" },
      ]),
    );
    localStorage.setItem(ORACLE_KEY, JSON.stringify([connection("UAT1"), connection("DEV")]));

    const environments = readEnvironments();

    expect(environments.map((environment) => environment.name)).toEqual(["uat1", "SIT", "DEV"]);
    expect(environments[0]).toMatchObject({
      name: "uat1",
      criticalConnection: "UAT1",
      cdnPublicUrl: "https://public.uat1.example",
      cdnDirectUrl: "",
    });
    expect(environments[1]).toMatchObject({ name: "SIT", criticalConnection: "", cdnPublicUrl: "https://public.sit.example" });
  });

  it("keeps an existing environment model instead of re-running migration", () => {
    localStorage.setItem(
      "config.environments",
      JSON.stringify([{ id: "prod", name: "PROD", criticalConnection: "PROD", cdnPublicUrl: "https://prod.example/" }]),
    );
    localStorage.setItem(BASE_URLS_KEY, JSON.stringify([{ key: "uat1", value: "https://uat1.example/" }]));

    expect(readEnvironments()).toEqual([
      {
        id: "prod",
        name: "PROD",
        criticalConnection: "PROD",
        complementaryConnection: "",
        cdnPublicUrl: "https://prod.example",
        cdnDirectUrl: "",
      },
    ]);
  });

  it("writes the public CDN URL back to the legacy base URL list", () => {
    writeEnvironments([
      { name: "UAT1", cdnPublicUrl: "https://public.uat1.example/" },
      { name: "UAT2", cdnDirectUrl: "https://10.0.0.2:5501/" },
    ]);

    expect(JSON.parse(localStorage.getItem(BASE_URLS_KEY))).toEqual([{ key: "UAT1", value: "https://public.uat1.example" }]);
  });
});

describe("environment resolution", () => {
  it("resolves the critical and complementary connections by name", () => {
    localStorage.setItem(ORACLE_KEY, JSON.stringify([connection("CORE"), connection("EXTRA")]));
    const environment = { criticalConnection: "CORE", complementaryConnection: "EXTRA" };

    expect(resolveConnection(environment, "critical")).toEqual(connection("CORE"));
    expect(resolveConnection(environment, "complementary")).toEqual(connection("EXTRA"));
    expect(resolveConnection({ criticalConnection: "", complementaryConnection: "" }, "critical")).toBeNull();
  });

  it("cascades Oracle connection renames and deletions into environments", () => {
    writeEnvironments([
      { name: "UAT1", criticalConnection: "CORE", complementaryConnection: "EXTRA" },
      { name: "UAT2", criticalConnection: "EXTRA" },
    ]);

    updateConnectionReference("CORE", "CORE_NEW");
    updateConnectionReference("EXTRA", "EXTRA_NEW");
    expect(
      readEnvironments().map(({ criticalConnection, complementaryConnection }) => [criticalConnection, complementaryConnection]),
    ).toEqual([
      ["CORE_NEW", "EXTRA_NEW"],
      ["EXTRA_NEW", ""],
    ]);

    clearConnectionReference("EXTRA_NEW");
    expect(
      readEnvironments().map(({ criticalConnection, complementaryConnection }) => [criticalConnection, complementaryConnection]),
    ).toEqual([
      ["CORE_NEW", ""],
      ["", ""],
    ]);
  });

  it("rejects duplicate environment names case-insensitively", () => {
    const environments = writeEnvironments([{ name: "UAT1" }, { name: "uat1" }, { name: "UAT2" }]);
    expect(environments.map((environment) => environment.name)).toEqual(["UAT1", "UAT2"]);
  });

  it("merges legacy CDN pairs into environments without dropping database bindings", () => {
    writeEnvironments([{ name: "UAT1", criticalConnection: "CORE" }]);

    mergeLegacyBaseUrls([
      { key: "uat1", value: "https://public.uat1.example/" },
      { key: "UAT2", value: "https://public.uat2.example/" },
    ]);

    const environments = readEnvironments();
    expect(environments.map(({ name, criticalConnection, cdnPublicUrl }) => [name, criticalConnection, cdnPublicUrl])).toEqual([
      ["UAT1", "CORE", "https://public.uat1.example"],
      ["UAT2", "", "https://public.uat2.example"],
    ]);
    expect(listBaseUrls()).toEqual([
      { name: "UAT1", url: "https://public.uat1.example", directUrl: "" },
      { name: "UAT2", url: "https://public.uat2.example", directUrl: "" },
    ]);
  });
});

describe("URL normalization", () => {
  it("strips trailing slashes from base URLs and keeps path prefixes", () => {
    expect(normalizeBaseUrl("  https://host.example/uat1/  ")).toBe("https://host.example/uat1");
    expect(normalizeBaseUrl("https://10.0.0.2:5501/")).toBe("https://10.0.0.2:5501");
    expect(normalizeBaseUrl("")).toBe("");
  });

  it("normalizes Lockey paths to one leading slash and no trailing slash", () => {
    expect(normalizePath("localization/v1/lockey/")).toBe("/localization/v1/lockey");
    expect(normalizePath("//localization/v1/lockey")).toBe("/localization/v1/lockey");
    expect(normalizePath("/localization/v1/language-pack?uuid=1")).toBe("/localization/v1/language-pack?uuid=1");
    expect(normalizePath("")).toBe("");
  });

  it("concatenates instead of resolving against the origin so prefixes survive", () => {
    expect(joinUrl("https://host.example/uat1/", "localization/v1/lockey")).toBe("https://host.example/uat1/localization/v1/lockey");
    expect(joinUrl("https://host.example", "/localization/v1/lockey?uuid=1")).toBe("https://host.example/localization/v1/lockey?uuid=1");
    expect(joinUrl("", "/localization/v1/lockey")).toBe("");
  });

  it("normalizes environment URLs when writing", () => {
    const [environment] = writeEnvironments([
      { name: "UAT1", cdnPublicUrl: "https://host.example/uat1/", cdnDirectUrl: "https://10.0.0.2:5501/" },
    ]);
    expect(environment).toMatchObject({
      cdnPublicUrl: "https://host.example/uat1",
      cdnDirectUrl: "https://10.0.0.2:5501",
    });
  });
});
