// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import toolsConfig from "../../config/tools.json";
import definitions from "../../config/tool-usage-definitions.json";
import { capabilities } from "../../config/capabilities.js";

const sourceFolders = {
  "html-template": "html-editor",
  "check-image": "image-checker",
};

describe("canonical tool-use coverage", () => {
  it("defines a successful-use boundary for every registered tool", () => {
    const registered = toolsConfig.tools.map((tool) => tool.id).sort();
    expect(
      Object.keys(definitions)
        .filter((id) => !definitions[id].embedded_in)
        .sort(),
    ).toEqual(registered);
    for (const definition of Object.values(definitions).filter((item) => item.embedded_in)) {
      expect(registered).toContain(definition.embedded_in);
    }
    for (const definition of Object.values(definitions)) {
      expect(definition.actions.length).toBeGreaterThan(0);
      expect(definition.boundary.length).toBeGreaterThan(10);
    }
  });

  it("implements canonical tracking in every registered tool", () => {
    for (const id of Object.keys(definitions)) {
      const folder = sourceFolders[id] || id;
      const directory = path.resolve(`frontend/tools/${folder}`);
      const source = fs
        .readdirSync(directory)
        .filter((file) => file.endsWith(".js"))
        .map((file) => fs.readFileSync(path.join(directory, file), "utf8"))
        .join("\n");
      expect(source, `${id} must call trackToolUse at its success boundary`).toContain(`trackToolUse("${id}"`);
    }
  });

  // A capability succeeds when its tool records one of these actions; a renamed action silently zeroes it.
  // Tools without a definition (not yet registered) are covered once they are registered above.
  it("maps every capability success to an action its tool records", () => {
    const matches = (pattern, action) => pattern === action || (pattern.endsWith("*") && action.startsWith(pattern.slice(0, -1)));
    const stale = capabilities.flatMap((item) => {
      const tool = item.useTool || item.tool;
      if (!definitions[tool]) return [];
      return (item.uses || [])
        .filter((action) => !definitions[tool].actions.some((pattern) => matches(pattern, action)))
        .map((action) => `${item.tool}.${item.id}:${action}`);
    });
    expect(stale).toEqual([]);
  });
});
