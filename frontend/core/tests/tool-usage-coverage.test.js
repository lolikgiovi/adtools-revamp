// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import toolsConfig from "../../config/tools.json";
import definitions from "../../config/tool-usage-definitions.json";

const sourceFolders = {
  "html-template": "html-editor",
  "check-image": "image-checker",
};

describe("canonical tool-use coverage", () => {
  it("defines a successful-use boundary for every registered tool", () => {
    const registered = toolsConfig.tools.map((tool) => tool.id).sort();
    expect(Object.keys(definitions).sort()).toEqual(registered);
    for (const definition of Object.values(definitions)) {
      expect(definition.actions.length).toBeGreaterThan(0);
      expect(definition.boundary.length).toBeGreaterThan(10);
    }
  });

  it("implements canonical tracking in every registered tool", () => {
    for (const tool of toolsConfig.tools) {
      const folder = sourceFolders[tool.id] || tool.id;
      const source = fs.readFileSync(path.resolve(`frontend/tools/${folder}/main.js`), "utf8");
      expect(source, `${tool.id} must call trackToolUse at its success boundary`).toContain(`trackToolUse("${tool.id}"`);
    }
  });
});
