import { describe, expect, it } from "vitest";
import { MasterLockeyService } from "../service.js";

describe("MasterLockey remote load performance", () => {
  it("keeps a large remote payload parse under one event-loop frame", () => {
    const service = new MasterLockeyService();
    const content = { en: {}, id: {}, zh: {} };

    for (let index = 0; index < 5000; index++) {
      const key = `localizationKey${index}`;
      content.en[key] = `English value ${index}`;
      content.id[key] = `Nilai bahasa ${index}`;
      content.zh[key] = `Chinese value ${index}`;
    }

    const rawSource = JSON.stringify({ content, languagePackId: "performance-test" });
    const startedAt = performance.now();
    const parsed = service.parseLockeyData(rawSource);
    const elapsedMs = performance.now() - startedAt;

    expect(parsed.rows).toHaveLength(5000);
    expect(elapsedMs).toBeLessThan(100);
  });
});
