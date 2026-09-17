import { describe, expect, it } from "vitest";
import { MAX_KAFKA_BATCH, parseMessages } from "../service.js";

describe("Kafka message preparation", () => {
  it("creates one record for one JSON request", () => {
    expect(parseMessages('{"cif":"30000758049"}', false, "account-1", '{"source":"ad-tools"}')).toEqual([
      { key: "account-1", value: '{"cif":"30000758049"}', headers: [{ key: "source", value: "ad-tools" }] },
    ]);
  });

  it("maps each array element to exactly one message", () => {
    const records = parseMessages('[{"id":1},{"id":2}]', true);
    expect(records.map((record) => record.value)).toEqual(['{"id":1}', '{"id":2}']);
    expect(records).toHaveLength(2);
  });

  it("rejects invalid or oversized bulk input before publishing", () => {
    expect(() => parseMessages('{"id":1}', true)).toThrow("JSON array");
    expect(() => parseMessages("[]", true)).toThrow("1 to 100");
    expect(() => parseMessages(JSON.stringify(Array.from({ length: MAX_KAFKA_BATCH + 1 }, (_, id) => ({ id }))), true)).toThrow("1 to 100");
    expect(() => parseMessages("{bad", false)).toThrow("valid JSON");
  });

  it("requires string header values", () => {
    expect(() => parseMessages("{}", false, "", '{"retry":3}')).toThrow("Headers");
  });
});
