// @vitest-environment node

import { describe, expect, it } from "vitest";
import { getUsageAccessState, normalizeUsageScope } from "../UsageOverviewModel.js";

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

  it("keeps the team view available for registered users with a local identity and no session token", () => {
    expect(getUsageAccessState({ registered: true, hasIdentity: true })).toEqual({
      isRegistered: true,
      hasIdentity: true,
      canViewDashboard: true,
      teamComparison: "available",
    });
  });

  it("omits obsolete velocity-template activity from the rendered scope", () => {
    const scope = normalizeUsageScope({
      totalActivities: 11,
      toolsUsed: 2,
      tools: [
        { toolId: "velocity-template", count: 9 },
        { toolId: "run-query", count: 2 },
      ],
    });

    expect(scope.tools).toEqual([{ id: "run-query", count: 2, name: "run-query" }]);
    expect(scope.totalActivities).toBe(2);
    expect(scope.toolsUsed).toBe(1);
  });

  it("hides legacy aliases when their canonical tool rows are present", () => {
    const scope = normalizeUsageScope({
      totalActivities: 100,
      toolsUsed: 4,
      tools: [
        { toolId: "run-query", count: 70 },
        { toolId: "jenkins-runner", count: 10 },
        { toolId: "master-lockey", count: 15 },
        { toolId: "master_lockey", count: 5 },
      ],
    });

    expect(scope.tools).toEqual([
      { id: "run-query", count: 70, name: "run-query" },
      { id: "master-lockey", count: 15, name: "master-lockey" },
    ]);
    expect(scope.totalActivities).toBe(85);
    expect(scope.toolsUsed).toBe(2);
  });
});
