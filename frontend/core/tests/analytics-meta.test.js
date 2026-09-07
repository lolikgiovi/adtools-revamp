import { describe, expect, it } from "vitest";
import { bucketCount, bucketDepth, bucketSize, getJsonComplexityMeta } from "../AnalyticsMeta.js";

describe("AnalyticsMeta", () => {
  it("buckets counts without exposing content", () => {
    expect(bucketCount(0)).toBe("0");
    expect(bucketCount(10)).toBe("1-10");
    expect(bucketCount(51)).toBe("51-100");
    expect(bucketCount(1001)).toBe("1000+");
    expect(bucketDepth(7)).toBe("6-10");
    expect(bucketSize(42_000)).toBe("10K-100K");
  });

  it("summarizes JSON structure without retaining keys or values", () => {
    const meta = getJsonComplexityMeta({ customer: { ids: [1, 2] }, active: true });

    expect(meta).toMatchObject({
      max_depth: 3,
      object_count: 2,
      array_count: 1,
      field_count: 3,
      leaf_count: 3,
      complexity_truncated: false,
    });
    expect(JSON.stringify(meta)).not.toContain("customer");
    expect(JSON.stringify(meta)).not.toContain("active");
  });
});
