// @vitest-environment node

import { describe, expect, it } from "vitest";
import { normalizeUsageScope } from "../UsageOverviewModel.js";

describe("usage overview model", () => {
  it("keeps local tool names when a normalized scope is rendered again", () => {
    const resolveToolName = (id) => ({ "quick-query": "Quick Query", unknown: "Unclassified activity" })[id] || id;
    const localScope = normalizeUsageScope(
      {
        totalActivities: 2,
        tools: [{ toolId: "quick-query", count: 2 }],
        daily: { "2026-09-04": { "quick-query.open": 2 } },
      },
      resolveToolName,
    );

    const renderedScope = normalizeUsageScope(localScope, resolveToolName);

    expect(renderedScope.tools).toEqual([{ id: "quick-query", count: 2, name: "Quick Query" }]);
    expect(renderedScope.totalActivities).toBe(2);
  });
});
