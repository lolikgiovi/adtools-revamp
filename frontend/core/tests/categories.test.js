import { describe, expect, it } from "vitest";
import { CATEGORIES, categorizeTool, normalizeCategory } from "../Categories.js";
import toolsConfig from "../../config/tools.json";

describe("tool categories", () => {
  it("uses Execute as the canonical category for Jenkins and execution tools", () => {
    expect(CATEGORIES.EXECUTE).toBe("execute");
    expect(normalizeCategory("JENKINS")).toBe(CATEGORIES.EXECUTE);
    expect(normalizeCategory("execute")).toBe(CATEGORIES.EXECUTE);
    expect(categorizeTool({ id: "kafka", category: "execute" })).toBe(CATEGORIES.EXECUTE);
    expect(toolsConfig.categories.find((category) => category.id === CATEGORIES.EXECUTE)?.name).toBe("Execute");
    expect(
      toolsConfig.tools
        .filter((tool) => tool.category === CATEGORIES.EXECUTE)
        .sort((a, b) => a.order - b.order)
        .map((tool) => tool.id),
    ).toEqual(["run-query", "run-batch", "redis-cache", "kafka"]);

    expect(CATEGORIES.TEMPLATE).toBe("template");
    expect(normalizeCategory("templates")).toBe(CATEGORIES.TEMPLATE);
    expect(categorizeTool({ id: "html-template", category: "template" })).toBe(CATEGORIES.TEMPLATE);
    expect(toolsConfig.categories.find((category) => category.id === CATEGORIES.TEMPLATE)?.name).toBe("Template");
    expect(toolsConfig.tools.filter((tool) => tool.category === CATEGORIES.TEMPLATE).map((tool) => tool.id)).toEqual([
      "html-template",
      "splunk-template",
    ]);
    expect(toolsConfig.categories.map((category) => category.id)).toEqual(["config", "template", "execute", "general"]);
  });
});
