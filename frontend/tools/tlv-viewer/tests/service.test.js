import { TLVViewerService } from "../service.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Build a TLV field: 2-char tag + 2-char decimal length + value */
function tlv(tag, value) {
  return tag + String(value.length).padStart(2, "0") + value;
}

/** Append a valid CRC (tag 63) to a QRIS payload */
function withCrc(payload) {
  const body = payload + "6304";
  const crc = TLVViewerService.crcCCITT(body).toString(16).toUpperCase().padStart(4, "0");
  return body + crc;
}

describe("TLVViewerService", () => {
  // ── Indonesian QRIS ───────────────────────────────────────────────────

  describe("Indonesian QRIS", () => {
    // ── Real-world payloads ─────────────────────────────────────────────

    it("parses Bank Mandiri QRIS (dynamic, with amount)", () => {
      const input =
        "00020101021226690021ID.CO.BANKMANDIRI.WWW01189360000801004981600211710049816080303UME" +
        "5204152053033605405100115802ID5925QRIS API MPM SNAP Batukar6013Jakarta Barat61051185" +
        "06228070874257760501260551432835663047766";
      const result = TLVViewerService.parseQris(input);

      expect(result.format).toBe("qris");

      // Payload format
      const tag00 = result.nodes.find((n) => n.tag === "00");
      expect(tag00.value).toBe("01");
      expect(tag00.tagName).toBe("Payload Format Indicator");

      // Dynamic QR
      const tag01 = result.nodes.find((n) => n.tag === "01");
      expect(tag01.value).toBe("12");
      expect(tag01.annotation).toBe("Dynamic");

      // Merchant account - Mandiri
      const tag26 = result.nodes.find((n) => n.tag === "26");
      expect(tag26.constructed).toBe(true);
      expect(tag26.tagName).toBe("Merchant Account Information");
      const guid = tag26.children.find((c) => c.tag === "00");
      expect(guid.value).toBe("ID.CO.BANKMANDIRI.WWW");
      const pan = tag26.children.find((c) => c.tag === "01");
      expect(pan.value).toBe("936000080100498160");
      expect(pan.tagName).toBe("Merchant PAN / ID");
      const criteria = tag26.children.find((c) => c.tag === "03");
      expect(criteria.value).toBe("UME");
      expect(criteria.tagName).toBe("Merchant Criteria");

      // MCC
      expect(result.nodes.find((n) => n.tag === "52").value).toBe("1520");

      // Currency IDR
      const tag53 = result.nodes.find((n) => n.tag === "53");
      expect(tag53.value).toBe("360");
      expect(tag53.annotation).toBe("IDR");

      // Amount
      expect(result.nodes.find((n) => n.tag === "54").value).toBe("10011");

      // Country
      expect(result.nodes.find((n) => n.tag === "58").value).toBe("ID");

      // Merchant name & city
      expect(result.nodes.find((n) => n.tag === "59").value).toBe("QRIS API MPM SNAP Batukar");
      expect(result.nodes.find((n) => n.tag === "60").value).toBe("Jakarta Barat");

      // Postal code
      expect(result.nodes.find((n) => n.tag === "61").value).toBe("11850");

      // Additional data - sub-tags 50+ must be primitive
      const tag62 = result.nodes.find((n) => n.tag === "62");
      expect(tag62.constructed).toBe(true);
      const sub07 = tag62.children.find((c) => c.tag === "07");
      expect(sub07.tagName).toBe("Terminal Label");
      const sub50 = tag62.children.find((c) => c.tag === "50");
      expect(sub50).toBeDefined();
      expect(sub50.constructed).toBe(false);

      // CRC
      const tag63 = result.nodes.find((n) => n.tag === "63");
      expect(tag63.value).toBe("7766");
      expect(tag63.tagName).toBe("CRC");

      // Summary
      expect(result.summary.nodeCount).toBeGreaterThan(15);
      expect(result.summary.topLevelCount).toBeGreaterThan(8);
    });

    it("parses GoPay QRIS (static)", () => {
      const merchant26 = tlv("00", "COM.GO-JEK.WWW") + tlv("01", "936008990000000028") + tlv("02", "ID2020093000753") + tlv("03", "UME");
      const qris51 = tlv("00", "ID.CO.QRIS.WWW") + tlv("02", "ID2020093000753") + tlv("03", "UME");
      const additional = tlv("07", "ID1020") + tlv("05", "GoPay123");
      const input = withCrc(
        tlv("00", "01") +
        tlv("01", "11") +
        tlv("26", merchant26) +
        tlv("51", qris51) +
        tlv("52", "5812") +
        tlv("53", "360") +
        tlv("58", "ID") +
        tlv("59", "WARUNG MAKAN BAHARI") +
        tlv("60", "SURABAYA") +
        tlv("61", "60231") +
        tlv("62", additional)
      );
      const result = TLVViewerService.parseQris(input);

      expect(result.format).toBe("qris");
      expect(result.crc.present).toBe(true);
      expect(result.crc.valid).toBe(true);

      // Static
      expect(result.nodes.find((n) => n.tag === "01").annotation).toBe("Static");

      // GoPay GUID
      const tag26 = result.nodes.find((n) => n.tag === "26");
      expect(tag26.children.find((c) => c.tag === "00").value).toBe("COM.GO-JEK.WWW");

      // QRIS national tag
      const tag51 = result.nodes.find((n) => n.tag === "51");
      expect(tag51.constructed).toBe(true);
      expect(tag51.children.find((c) => c.tag === "00").value).toBe("ID.CO.QRIS.WWW");
      expect(tag51.children.find((c) => c.tag === "02").tagName).toBe("Merchant ID");

      // Merchant
      expect(result.nodes.find((n) => n.tag === "59").value).toBe("WARUNG MAKAN BAHARI");
      expect(result.nodes.find((n) => n.tag === "60").value).toBe("SURABAYA");

      // Additional data sub-tags
      const tag62 = result.nodes.find((n) => n.tag === "62");
      expect(tag62.children.find((c) => c.tag === "07").value).toBe("ID1020");
      expect(tag62.children.find((c) => c.tag === "05").tagName).toBe("Reference Label");
      expect(tag62.children.find((c) => c.tag === "05").value).toBe("GoPay123");
    });

    it("parses OVO/DANA QRIS with tip indicator", () => {
      const merchant = tlv("00", "ID.DANA.WWW") + tlv("01", "936009153000000123") + tlv("03", "UMI");
      const qris51 = tlv("00", "ID.CO.QRIS.WWW") + tlv("02", "ID1020010000001") + tlv("03", "UMI");
      const input = withCrc(
        tlv("00", "01") +
        tlv("01", "12") +
        tlv("26", merchant) +
        tlv("51", qris51) +
        tlv("52", "5411") +
        tlv("53", "360") +
        tlv("54", "50000") +
        tlv("55", "01") +
        tlv("58", "ID") +
        tlv("59", "TOKO SERBA ADA") +
        tlv("60", "BANDUNG") +
        tlv("61", "40111")
      );
      const result = TLVViewerService.parseQris(input);

      expect(result.crc.valid).toBe(true);

      // Dynamic
      expect(result.nodes.find((n) => n.tag === "01").annotation).toBe("Dynamic");

      // Tip
      const tag55 = result.nodes.find((n) => n.tag === "55");
      expect(tag55.tagName).toBe("Tip or Convenience Indicator");
      expect(tag55.annotation).toBe("Tip prompted");

      // Amount
      expect(result.nodes.find((n) => n.tag === "54").value).toBe("50000");
      expect(result.nodes.find((n) => n.tag === "54").tagName).toBe("Transaction Amount");

      // UMI criteria
      expect(result.nodes.find((n) => n.tag === "26").children.find((c) => c.tag === "03").value).toBe("UMI");
    });

    it("parses ShopeePay QRIS with multiple merchant account tags", () => {
      const merchant27 = tlv("00", "COM.SHOPEE.WWW") + tlv("01", "936009120314567890") + tlv("02", "ID2021120300001") + tlv("03", "UBE");
      const merchant28 = tlv("00", "ID.CO.SHOPEE.WWW") + tlv("01", "93600912000000001");
      const qris51 = tlv("00", "ID.CO.QRIS.WWW") + tlv("02", "ID2021120300001") + tlv("03", "UBE");
      const input = withCrc(
        tlv("00", "01") +
        tlv("01", "11") +
        tlv("27", merchant27) +
        tlv("28", merchant28) +
        tlv("51", qris51) +
        tlv("52", "4829") +
        tlv("53", "360") +
        tlv("58", "ID") +
        tlv("59", "KEDAI KOPI NUSANTARA") +
        tlv("60", "MEDAN") +
        tlv("61", "20112")
      );
      const result = TLVViewerService.parseQris(input);

      expect(result.crc.valid).toBe(true);

      // Two merchant accounts (tags 27 and 28)
      const tag27 = result.nodes.find((n) => n.tag === "27");
      const tag28 = result.nodes.find((n) => n.tag === "28");
      expect(tag27.constructed).toBe(true);
      expect(tag28.constructed).toBe(true);
      expect(tag27.tagName).toBe("Merchant Account Information");
      expect(tag28.tagName).toBe("Merchant Account Information");
      expect(tag27.children.find((c) => c.tag === "00").value).toBe("COM.SHOPEE.WWW");
      expect(tag28.children.find((c) => c.tag === "00").value).toBe("ID.CO.SHOPEE.WWW");
    });

    it("parses LinkAja QRIS with convenience fee (fixed)", () => {
      const merchant = tlv("00", "ID.CO.TELKOM.WWW") + tlv("01", "936008870000000055") + tlv("03", "UME");
      const input = withCrc(
        tlv("00", "01") +
        tlv("01", "12") +
        tlv("26", merchant) +
        tlv("51", tlv("00", "ID.CO.QRIS.WWW") + tlv("02", "ID1020080000055") + tlv("03", "UME")) +
        tlv("52", "5812") +
        tlv("53", "360") +
        tlv("54", "150000") +
        tlv("55", "02") +
        tlv("56", "2500") +
        tlv("58", "ID") +
        tlv("59", "RM PADANG SEDERHANA") +
        tlv("60", "JAKARTA") +
        tlv("61", "10310")
      );
      const result = TLVViewerService.parseQris(input);

      expect(result.crc.valid).toBe(true);
      expect(result.nodes.find((n) => n.tag === "55").annotation).toBe("Fixed fee");
      expect(result.nodes.find((n) => n.tag === "56").value).toBe("2500");
      expect(result.nodes.find((n) => n.tag === "56").tagName).toBe("Value of Convenience Fee (Fixed)");
    });

    it("parses BCA QRIS with percentage fee", () => {
      const merchant = tlv("00", "ID.CO.BCA.WWW") + tlv("01", "936001400000000777") + tlv("03", "UME");
      const input = withCrc(
        tlv("00", "01") +
        tlv("01", "12") +
        tlv("26", merchant) +
        tlv("51", tlv("00", "ID.CO.QRIS.WWW") + tlv("02", "ID1020014000777") + tlv("03", "UME")) +
        tlv("52", "5311") +
        tlv("53", "360") +
        tlv("54", "200000") +
        tlv("55", "03") +
        tlv("57", "5") +
        tlv("58", "ID") +
        tlv("59", "TOKO ELEKTRONIK JAYA") +
        tlv("60", "SEMARANG") +
        tlv("61", "50132")
      );
      const result = TLVViewerService.parseQris(input);

      expect(result.crc.valid).toBe(true);
      expect(result.nodes.find((n) => n.tag === "55").annotation).toBe("Percentage fee");
      expect(result.nodes.find((n) => n.tag === "57").value).toBe("5");
      expect(result.nodes.find((n) => n.tag === "57").tagName).toBe("Value of Convenience Fee (%)");
    });

    // ── Merchant criteria codes ─────────────────────────────────────────

    it.each([
      ["UME", "Regular merchant"],
      ["UMI", "Small merchant (UMKM)"],
      ["UBE", "Big merchant"],
    ])("recognizes merchant criteria %s (%s)", (criteria) => {
      const merchant = tlv("00", "ID.EXAMPLE.WWW") + tlv("01", "936001230000000001") + tlv("03", criteria);
      const input = tlv("00", "01") + tlv("26", merchant);
      const result = TLVViewerService.parseQris(input);

      const tag26 = result.nodes.find((n) => n.tag === "26");
      expect(tag26.children.find((c) => c.tag === "03").value).toBe(criteria);
    });

    // ── Tag 51 (national QRIS identifier) ───────────────────────────────

    it("parses tag 51 with ID.CO.QRIS.WWW identifier", () => {
      const qris51 = tlv("00", "ID.CO.QRIS.WWW") + tlv("02", "ID1020099887766") + tlv("03", "UME");
      const input = tlv("00", "01") + tlv("51", qris51);
      const result = TLVViewerService.parseQris(input);

      const tag51 = result.nodes.find((n) => n.tag === "51");
      expect(tag51.constructed).toBe(true);
      expect(tag51.tagName).toBe("Merchant Account Information");
      expect(tag51.children).toHaveLength(3);
      expect(tag51.children[0].value).toBe("ID.CO.QRIS.WWW");
      expect(tag51.children[0].tagName).toBe("Globally Unique Identifier");
    });

    // ── Additional data field (tag 62) sub-tags ─────────────────────────

    it("parses additional data sub-tags (bill, mobile, store, reference)", () => {
      const additional =
        tlv("01", "INV-001") +
        tlv("02", "0812345678") +
        tlv("03", "STR-A") +
        tlv("05", "REF123") +
        tlv("07", "T01");
      const input = tlv("00", "01") + tlv("62", additional);
      const result = TLVViewerService.parseQris(input);

      const tag62 = result.nodes.find((n) => n.tag === "62");
      expect(tag62.constructed).toBe(true);
      expect(tag62.children).toHaveLength(5);

      expect(tag62.children[0].tagName).toBe("Bill Number");
      expect(tag62.children[0].value).toBe("INV-001");
      expect(tag62.children[1].tagName).toBe("Mobile Number");
      expect(tag62.children[1].value).toBe("0812345678");
      expect(tag62.children[2].tagName).toBe("Store Label");
      expect(tag62.children[3].tagName).toBe("Reference Label");
      expect(tag62.children[4].tagName).toBe("Terminal Label");
    });

    it("parses additional data sub-tags (loyalty, customer, purpose, consumer)", () => {
      const additional =
        tlv("04", "LYL99") +
        tlv("06", "CST01") +
        tlv("08", "Bayar") +
        tlv("09", "AEM");
      const input = tlv("00", "01") + tlv("62", additional);
      const result = TLVViewerService.parseQris(input);

      const tag62 = result.nodes.find((n) => n.tag === "62");
      expect(tag62.children).toHaveLength(4);

      expect(tag62.children[0].tagName).toBe("Loyalty Number");
      expect(tag62.children[1].tagName).toBe("Customer Label");
      expect(tag62.children[2].tagName).toBe("Purpose of Transaction");
      expect(tag62.children[2].value).toBe("Bayar");
      expect(tag62.children[3].tagName).toBe("Additional Consumer Data Request");
      expect(tag62.children[3].value).toBe("AEM");
    });

    it("treats high-numbered sub-tags inside tag 62 as primitive", () => {
      const additional = tlv("07", "T001") + tlv("50", "PROPRIETARY-DATA-ABC") + tlv("99", "CUSTOM-FIELD-XYZ");
      const input = tlv("00", "01") + tlv("62", additional);
      const result = TLVViewerService.parseQris(input);

      const tag62 = result.nodes.find((n) => n.tag === "62");
      tag62.children.forEach((child) => {
        expect(child.constructed).toBe(false);
      });
    });

    // ── Language template (tag 64) ──────────────────────────────────────

    it("parses merchant information language template", () => {
      const lang = tlv("00", "ID") + tlv("01", "TOKO SERBA ADA") + tlv("02", "JAKARTA SELATAN");
      const input = tlv("00", "01") + tlv("64", lang);
      const result = TLVViewerService.parseQris(input);

      const tag64 = result.nodes.find((n) => n.tag === "64");
      expect(tag64.constructed).toBe(true);
      expect(tag64.tagName).toBe("Merchant Information (Language)");
      expect(tag64.children.find((c) => c.tag === "00").value).toBe("ID");
      expect(tag64.children.find((c) => c.tag === "00").tagName).toBe("Language Preference");
      expect(tag64.children.find((c) => c.tag === "01").tagName).toBe("Merchant Name (Alt Language)");
      expect(tag64.children.find((c) => c.tag === "02").tagName).toBe("Merchant City (Alt Language)");
    });

    // ── Value annotations ───────────────────────────────────────────────

    it("annotates static initiation method", () => {
      const result = TLVViewerService.parseQris(tlv("01", "11"));
      expect(result.nodes[0].annotation).toBe("Static");
    });

    it("annotates dynamic initiation method", () => {
      const result = TLVViewerService.parseQris(tlv("01", "12"));
      expect(result.nodes[0].annotation).toBe("Dynamic");
    });

    it("annotates MCC code", () => {
      const result = TLVViewerService.parseQris(tlv("52", "5411"));
      expect(result.nodes[0].annotation).toBe("Grocery Stores/Supermarkets");
    });

    it("annotates MCC code for restaurants", () => {
      const result = TLVViewerService.parseQris(tlv("52", "5812"));
      expect(result.nodes[0].annotation).toBe("Eating Places/Restaurants");
    });

    it("annotates IDR currency", () => {
      const result = TLVViewerService.parseQris(tlv("53", "360"));
      expect(result.nodes[0].annotation).toBe("IDR");
    });

    it.each([
      ["01", "Tip prompted"],
      ["02", "Fixed fee"],
      ["03", "Percentage fee"],
    ])("annotates tip indicator %s as '%s'", (value, expected) => {
      const result = TLVViewerService.parseQris(tlv("55", value));
      expect(result.nodes[0].annotation).toBe(expected);
    });

    // ── CRC validation with real payloads ───────────────────────────────

    it("validates CRC on a complete QRIS payload", () => {
      const input =
        "00020101021226690021ID.CO.BANKMANDIRI.WWW01189360000801004981600211710049816080303UME" +
        "5204152053033605405100115802ID5925QRIS API MPM SNAP Batukar6013Jakarta Barat61051185" +
        "06228070874257760501260551432835663047766";
      const crc = TLVViewerService.validateQrisCrc(input);
      expect(crc.present).toBe(true);
      expect(crc.actual).toBe("7766");
    });

    it("validates CRC on builder-generated payloads", () => {
      const sample = TLVViewerService.buildQrisSample();
      const crc = TLVViewerService.validateQrisCrc(sample);
      expect(crc.present).toBe(true);
      expect(crc.valid).toBe(true);
    });

    it("detects tampered CRC", () => {
      const payload = withCrc(tlv("00", "01") + tlv("58", "ID"));
      const tampered = payload.slice(0, -4) + "FFFF";
      const crc = TLVViewerService.validateQrisCrc(tampered);
      expect(crc.present).toBe(true);
      expect(crc.valid).toBe(false);
      expect(crc.expected).not.toBe("FFFF");
    });

    it("reports missing CRC on payload without tag 63", () => {
      const input = tlv("00", "01") + tlv("58", "ID") + tlv("59", "TOKO");
      const crc = TLVViewerService.validateQrisCrc(input);
      expect(crc.present).toBe(false);
    });

    // ── Edge cases & error handling ─────────────────────────────────────

    it("parses merchant name with special characters", () => {
      const input = tlv("00", "01") + tlv("59", "TOKO H. ABD. RAHMAN & SONS");
      const result = TLVViewerService.parseQris(input);
      expect(result.nodes.find((n) => n.tag === "59").value).toBe("TOKO H. ABD. RAHMAN & SONS");
    });

    it("parses city name with spaces", () => {
      const input = tlv("00", "01") + tlv("60", "Tangerang Selatan");
      const result = TLVViewerService.parseQris(input);
      expect(result.nodes.find((n) => n.tag === "60").value).toBe("Tangerang Selatan");
    });

    it("handles maximum-length value (99 chars)", () => {
      const longName = "A".repeat(99);
      const input = tlv("00", "01") + tlv("59", longName);
      const result = TLVViewerService.parseQris(input);
      expect(result.nodes.find((n) => n.tag === "59").value).toBe(longName);
    });

    it("handles empty constructed template", () => {
      const input = tlv("00", "01") + "2600";
      const result = TLVViewerService.parseQris(input);
      const tag26 = result.nodes.find((n) => n.tag === "26");
      expect(tag26.constructed).toBe(true);
      expect(tag26.children).toHaveLength(0);
    });

    it("throws for truncated payload", () => {
      expect(() => TLVViewerService.parseQris("000201010212260")).toThrow();
    });

    it("throws for non-numeric tag", () => {
      expect(() => TLVViewerService.parseQris("AB0201")).toThrow(/Invalid tag/i);
    });

    it("throws for non-numeric length", () => {
      expect(() => TLVViewerService.parseQris("00XX01")).toThrow(/Invalid length/i);
    });

    it("throws when value overruns input", () => {
      expect(() => TLVViewerService.parseQris("009901")).toThrow(/exceeds input/i);
    });

    it("throws for incomplete TLV (only tag, no length)", () => {
      expect(() => TLVViewerService.parseQris("00020100")).toThrow();
    });

    // ── QRIS Validation ─────────────────────────────────────────────────

    it("returns no validation issues for a complete valid QRIS", () => {
      const merchant = tlv("00", "ID.CO.BRI.WWW") + tlv("01", "936000200000001234") + tlv("03", "UME");
      const input = withCrc(
        tlv("00", "01") +
        tlv("01", "11") +
        tlv("26", merchant) +
        tlv("52", "5411") +
        tlv("53", "360") +
        tlv("58", "ID") +
        tlv("59", "TOKO MAKMUR") +
        tlv("60", "YOGYAKARTA")
      );
      const result = TLVViewerService.parseQris(input);
      expect(result.validation).toEqual([]);
    });

    it("reports missing mandatory tags", () => {
      const result = TLVViewerService.parseQris(tlv("00", "01"));
      const errors = result.validation.filter((v) => v.level === "error");
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((v) => v.message.includes("52"))).toBe(true);
      expect(errors.some((v) => v.message.includes("53"))).toBe(true);
      expect(errors.some((v) => v.message.includes("58"))).toBe(true);
      expect(errors.some((v) => v.message.includes("59"))).toBe(true);
      expect(errors.some((v) => v.message.includes("60"))).toBe(true);
      expect(errors.some((v) => v.message.includes("63"))).toBe(true);
    });

    it("warns when tag 01 is missing", () => {
      const result = TLVViewerService.parseQris(tlv("00", "01"));
      const warns = result.validation.filter((v) => v.level === "warn");
      expect(warns.some((v) => v.message.includes("Tag 01"))).toBe(true);
    });

    it("errors when tag 01 has invalid value", () => {
      const result = TLVViewerService.parseQris(tlv("00", "01") + tlv("01", "99"));
      expect(result.validation.some((v) => v.level === "error" && v.message.includes('"11" or "12"'))).toBe(true);
    });

    it("warns on unknown MCC code", () => {
      const merchant = tlv("00", "ID.CO.BRI.WWW") + tlv("01", "936000200000001234") + tlv("03", "UME");
      const input = withCrc(
        tlv("00", "01") + tlv("01", "11") + tlv("26", merchant) +
        tlv("52", "9999") + tlv("53", "360") + tlv("58", "ID") +
        tlv("59", "TEST") + tlv("60", "JAKARTA")
      );
      const result = TLVViewerService.parseQris(input);
      expect(result.validation.some((v) => v.level === "warn" && v.message.includes("9999"))).toBe(true);
    });

    it("warns on unknown currency code", () => {
      const merchant = tlv("00", "ID.CO.BRI.WWW") + tlv("01", "936000200000001234") + tlv("03", "UME");
      const input = withCrc(
        tlv("00", "01") + tlv("01", "11") + tlv("26", merchant) +
        tlv("52", "5411") + tlv("53", "000") + tlv("58", "ID") +
        tlv("59", "TEST") + tlv("60", "JAKARTA")
      );
      const result = TLVViewerService.parseQris(input);
      expect(result.validation.some((v) => v.level === "warn" && v.message.includes("000"))).toBe(true);
    });

    it("warns when no merchant account tags exist", () => {
      const input = withCrc(
        tlv("00", "01") + tlv("01", "11") +
        tlv("52", "5411") + tlv("53", "360") + tlv("58", "ID") +
        tlv("59", "TEST") + tlv("60", "JAKARTA")
      );
      const result = TLVViewerService.parseQris(input);
      expect(result.validation.some((v) => v.level === "warn" && v.message.includes("26-51"))).toBe(true);
    });

    // ── Auto-detection ──────────────────────────────────────────────────

    it("auto-detects QRIS from real payload", () => {
      const input =
        "00020101021226690021ID.CO.BANKMANDIRI.WWW01189360000801004981600211710049816080303UME" +
        "5204152053033605405100115802ID5925QRIS API MPM SNAP Batukar6013Jakarta Barat61051185" +
        "06228070874257760501260551432835663047766";
      expect(TLVViewerService.detectFormat(input)).toBe("qris");
    });

    it("auto-detect parses QRIS end-to-end via parse()", () => {
      const merchant = tlv("00", "ID.CO.BRI.WWW") + tlv("01", "936000200000001234") + tlv("03", "UME");
      const input = withCrc(
        tlv("00", "01") +
        tlv("01", "11") +
        tlv("26", merchant) +
        tlv("52", "5411") +
        tlv("53", "360") +
        tlv("58", "ID") +
        tlv("59", "TOKO MAKMUR") +
        tlv("60", "YOGYAKARTA")
      );
      const result = TLVViewerService.parse(input, "auto");

      expect(result.format).toBe("qris");
      expect(result.crc.valid).toBe(true);
      expect(result.nodes.find((n) => n.tag === "59").value).toBe("TOKO MAKMUR");
    });
  });

  // ── QRIS sample builder ───────────────────────────────────────────────

  describe("QRIS sample builder", () => {
    it("builds a parseable sample with valid CRC", () => {
      const sample = TLVViewerService.buildQrisSample();
      expect(sample.startsWith("000201")).toBe(true);

      const result = TLVViewerService.parse(sample, "qris");
      expect(result.format).toBe("qris");
      expect(result.crc.valid).toBe(true);
      expect(result.summary.nodeCount).toBeGreaterThan(5);
    });

    it("sample contains expected Indonesian fields", () => {
      const sample = TLVViewerService.buildQrisSample();
      const result = TLVViewerService.parseQris(sample);

      expect(result.nodes.find((n) => n.tag === "58").value).toBe("ID");
      expect(result.nodes.find((n) => n.tag === "53").value).toBe("360");
      expect(result.nodes.find((n) => n.tag === "53").annotation).toBe("IDR");

      const tag51 = result.nodes.find((n) => n.tag === "51");
      expect(tag51).toBeDefined();
      expect(tag51.children.find((c) => c.tag === "00").value).toBe("ID.CO.QRIS.WWW");
    });
  });

  // ── BER-TLV parsing ───────────────────────────────────────────────────

  describe("BER-TLV parsing", () => {
    it("parses a primitive TLV payload", () => {
      const result = TLVViewerService.parseBerTlv("5A03112233", "hex");

      expect(result.summary.nodeCount).toBe(1);
      expect(result.summary.byteLength).toBe(5);
      expect(result.rows[0].tag).toBe("5A");
      expect(result.rows[0].length).toBe(3);
    });

    it("parses nested constructed TLV payloads", () => {
      const result = TLVViewerService.parseBerTlv("6F0E8407A0000000031010A503500141", "hex");

      expect(result.summary.topLevelCount).toBe(1);
      expect(result.nodes[0].tag).toBe("6F");
      expect(result.nodes[0].children.length).toBe(2);
      expect(result.nodes[0].children[1].tag).toBe("A5");
    });

    it("supports Base64 input mode", () => {
      const result = TLVViewerService.parseBerTlv("WgMRIjM=", "base64");

      expect(result.rows[0].tag).toBe("5A");
      expect(result.rows[0].length).toBe(3);
    });

    it("parses long-form lengths", () => {
      const result = TLVViewerService.parseBerTlv("5A8103112233", "hex");
      expect(result.rows[0].length).toBe(3);
    });

    it("parses high-tag-number tags", () => {
      const result = TLVViewerService.parseBerTlv("9F3303E0F0C8", "hex");
      expect(result.rows[0].tag).toBe("9F33");
    });

    it("throws for odd-length hex input", () => {
      expect(() => TLVViewerService.parseBerTlv("ABC", "hex")).toThrow(/odd length/i);
    });

    it("throws for indefinite-length payloads", () => {
      expect(() => TLVViewerService.parseBerTlv("5A8000", "hex")).toThrow(/Indefinite length/i);
    });

    it("throws when value exceeds remaining bytes", () => {
      expect(() => TLVViewerService.parseBerTlv("5A051122", "hex")).toThrow(/exceeds available input length/i);
    });
  });

  // ── Format detection ──────────────────────────────────────────────────

  describe("format detection", () => {
    it("detects QRIS by 000201 prefix", () => {
      expect(TLVViewerService.detectFormat("000201010211...")).toBe("qris");
    });

    it("detects base64", () => {
      expect(TLVViewerService.detectFormat("WgMRIjM=")).toBe("ber-base64");
    });

    it("detects hex", () => {
      expect(TLVViewerService.detectFormat("6F0E8407A0000000031010")).toBe("ber-hex");
    });
  });

  // ── Unified parse() ───────────────────────────────────────────────────

  describe("parse() with auto-detect", () => {
    it("auto-detects and parses QRIS", () => {
      const sample = TLVViewerService.buildQrisSample();
      const result = TLVViewerService.parse(sample, "auto");
      expect(result.format).toBe("qris");
    });

    it("auto-detects and parses hex BER-TLV", () => {
      const result = TLVViewerService.parse("5A03112233", "auto");
      expect(result.format).toBe("ber-tlv");
    });
  });
});
