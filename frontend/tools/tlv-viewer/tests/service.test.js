import { TLVViewerService } from "../service.js";

describe("TLVViewerService", () => {
  it("parses a primitive TLV payload", () => {
    const result = TLVViewerService.parse("5A03112233", "hex");

    expect(result.summary.nodeCount).toBe(1);
    expect(result.summary.byteLength).toBe(5);
    expect(result.rows[0].tag).toBe("5A");
    expect(result.rows[0].length).toBe(3);
  });

  it("parses nested constructed TLV payloads", () => {
    const result = TLVViewerService.parse("6F0E8407A0000000031010A503500141", "hex");

    expect(result.summary.topLevelCount).toBe(1);
    expect(result.nodes[0].tag).toBe("6F");
    expect(result.nodes[0].children.length).toBe(2);
    expect(result.nodes[0].children[1].tag).toBe("A5");
    expect(result.nodes[0].children[1].children[0].tag).toBe("50");
  });

  it("supports Base64 input mode", () => {
    const result = TLVViewerService.parse("WgMRIjM=", "base64");

    expect(result.rows[0].tag).toBe("5A");
    expect(result.rows[0].length).toBe(3);
  });

  it("parses long-form lengths", () => {
    const result = TLVViewerService.parse("5A8103112233", "hex");

    expect(result.rows[0].length).toBe(3);
  });

  it("parses high-tag-number tags", () => {
    const result = TLVViewerService.parse("9F3303E0F0C8", "hex");

    expect(result.rows[0].tag).toBe("9F33");
    expect(result.rows[0].length).toBe(3);
  });

  it("throws for odd-length hex input", () => {
    expect(() => TLVViewerService.parse("ABC", "hex")).toThrow(/odd length/i);
  });

  it("throws for indefinite-length payloads", () => {
    expect(() => TLVViewerService.parse("5A8000", "hex")).toThrow(/Indefinite length/i);
  });

  it("throws when value exceeds remaining bytes", () => {
    expect(() => TLVViewerService.parse("5A051122", "hex")).toThrow(/exceeds available input length/i);
  });
});
