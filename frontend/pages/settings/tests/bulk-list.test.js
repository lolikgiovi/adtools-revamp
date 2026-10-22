import { describe, expect, it, vi } from "vitest";
import { buildListPlan, buildKafkaPlan, applyListPlan } from "../bulk-list.js";
import { SettingsService } from "../service.js";
const service = new SettingsService();
const validate = (type) => (value) => service.validate(value, type);
// Failures: bad shapes silently accepted, URL validation bypassed, removed rows hidden,
// duplicates overwrite entries, Kafka IDs change, omissions delete connections, stale plans save.
describe("Bulk list plans", () => {
  it("previews additions, edits, and removals for URL pairs", () => {
    const current = [
      { key: "A", value: "https://a.example" },
      { key: "B", value: "https://b.example" },
    ];
    const plan = buildListPlan(
      JSON.stringify([
        { key: "A", value: "https://new.example" },
        { key: "C", value: "https://c.example" },
      ]),
      current,
      "kvlist",
      validate("kvlist"),
    );
    expect(plan.summary).toEqual({ added: 1, updated: 1, removed: 1, unchanged: 0 });
  });
  it.each(["{}", '[{"key":"A","value":"bad"}]', '[{"key":"A","value":"https://a","extra":1}]', '["text"]'])(
    "rejects invalid pair input %s",
    (text) => expect(() => buildListPlan(text, [], "kvlist", validate("kvlist"))).toThrow(),
  );
  it("rejects duplicate environment keys", () => {
    const rows = [
      { key: "A", value: "https://a" },
      { key: "A", value: "https://b" },
    ];
    expect(() => buildListPlan(JSON.stringify(rows), [], "kvlist", validate("kvlist"))).toThrow(/duplicate/i);
  });
  it("uses the existing squad-token validation and accepts an empty replacement", () => {
    expect(() => buildListPlan('["has spaces"]', [], "string-list", validate("string-list"))).toThrow();
    expect(() => buildListPlan('["a","A"]', [], "string-list", validate("string-list"))).toThrow(/duplicate/i);
    expect(buildListPlan("[]", ["a"], "string-list", validate("string-list")).summary.removed).toBe(1);
  });
  it("preserves Kafka IDs and omitted connections", () => {
    const current = [
      { id: "stable", name: "DEV", brokers: "old:9092" },
      { id: "keep", name: "KEEP", brokers: "keep:9092" },
    ];
    const plan = buildKafkaPlan('[{"name":"DEV","brokers":"new:9092"},{"name":"NEW","brokers":"new2:9092"}]', current);
    expect(plan.next[0]).toEqual({ id: "stable", name: "DEV", brokers: "new:9092" });
    expect(plan.next[1]).toEqual(current[1]);
    expect(plan.next[2].id).toBeTruthy();
    expect(plan.summary).toEqual({ added: 1, updated: 1, removed: 0, unchanged: 1 });
  });
  it("blocks stale data before writes", async () => {
    const plan = buildListPlan('["new"]', ["old"], "string-list", validate("string-list"));
    const write = vi.fn();
    await expect(applyListPlan(plan, () => [], write)).rejects.toThrow(/changed/i);
    expect(write).not.toHaveBeenCalled();
  });
});
