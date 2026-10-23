// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { writeEnvironments } from "../../../core/Environments.js";
import {
  listLockeyEnvironments,
  migrateLegacyLockeyPath,
  readBasePreference,
  readLockeyPath,
  resolveLockeyUrl,
  writeBasePreference,
} from "../config.js";

function environment() {
  return {
    name: "UAT1",
    cdnPublicUrl: "https://public.uat1.example",
    cdnDirectUrl: "https://10.243.137.100:5501",
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe("Master Lockey config", () => {
  it("appends the Lockey path to the chosen environment base", () => {
    writeEnvironments([
      { name: "UAT1", cdnPublicUrl: "https://public.uat1.example/", cdnDirectUrl: "https://10.243.137.100:5501/" },
      { name: "UAT2", cdnDirectUrl: "https://10.243.137.101:5501/" },
      { name: "NO-URL" },
    ]);
    expect(listLockeyEnvironments().map((env) => env.name)).toEqual(["UAT1", "UAT2"]);

    expect(resolveLockeyUrl(environment(), { path: "/localization/v1/language-pack?uuid=1", base: "public" })).toEqual({
      url: "https://public.uat1.example/localization/v1/language-pack?uuid=1",
      base: "https://public.uat1.example",
      source: "public",
    });
    expect(resolveLockeyUrl(environment(), { path: "localization/v1/language-pack", base: "direct" })).toEqual({
      url: "https://10.243.137.100:5501/localization/v1/language-pack",
      base: "https://10.243.137.100:5501",
      source: "direct",
    });
    expect(resolveLockeyUrl({ name: "UAT2", cdnDirectUrl: "https://10.0.0.2:5501" }, { path: "/l", base: "public" }).source).toBe("direct");
  });

  it("reads and normalizes the saved Lockey path", () => {
    localStorage.setItem("config.lockeyPath", "  localization/v1/lockey/  ");
    expect(readLockeyPath()).toBe("/localization/v1/lockey");
  });

  it("migrates a shared legacy domain suffix into one Lockey path", () => {
    writeEnvironments([
      { name: "UAT1", cdnPublicUrl: "https://public.uat1.example" },
      { name: "UAT2", cdnPublicUrl: "https://public.uat2.example" },
    ]);
    localStorage.setItem(
      "config.lockeyDomains",
      JSON.stringify([
        { key: "UAT1", value: "https://public.uat1.example/localization/v1/language-pack?uuid=1" },
        { key: "UAT2", value: "https://public.uat2.example/localization/v1/language-pack?uuid=1" },
      ]),
    );

    expect(migrateLegacyLockeyPath()).toBe("/localization/v1/language-pack?uuid=1");
    expect(localStorage.getItem("config.lockeyPath")).toBe("/localization/v1/language-pack?uuid=1");
  });

  it("keeps an explicit path and does not re-migrate differing suffixes", () => {
    writeEnvironments([{ name: "UAT1", cdnPublicUrl: "https://public.uat1.example" }]);
    localStorage.setItem("config.lockeyDomains", JSON.stringify([{ key: "UAT1", value: "https://public.uat1.example/one" }]));
    localStorage.setItem("config.lockeyPath", "");
    expect(migrateLegacyLockeyPath()).toBe("");
    expect(readLockeyPath()).toBe("");

    localStorage.removeItem("config.lockeyPath");
    writeEnvironments([
      { name: "UAT1", cdnPublicUrl: "https://public.uat1.example" },
      { name: "UAT2", cdnPublicUrl: "https://public.uat2.example" },
    ]);
    localStorage.setItem(
      "config.lockeyDomains",
      JSON.stringify([
        { key: "UAT1", value: "https://public.uat1.example/one" },
        { key: "UAT2", value: "https://public.uat2.example/two" },
      ]),
    );
    expect(migrateLegacyLockeyPath()).toBe("");
  });

  it("persists the Public/Direct preference", () => {
    expect(readBasePreference()).toBe("public");
    writeBasePreference("direct");
    expect(readBasePreference()).toBe("direct");
    writeBasePreference("nonsense");
    expect(readBasePreference()).toBe("public");
  });
});
