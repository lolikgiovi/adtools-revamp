// ── QRIS / EMV QR Tag Dictionaries ──────────────────────────────────────────

const QRIS_ROOT_TAGS = {
  "00": "Payload Format Indicator",
  "01": "Point of Initiation Method",
  "02": "Visa",
  "03": "Visa",
  "04": "Mastercard",
  "05": "Mastercard",
  "06": "EMVCo",
  "07": "EMVCo",
  "08": "EMVCo",
  "09": "Discover",
  "10": "Discover",
  "11": "AMEX",
  "12": "AMEX",
  "13": "JCB",
  "14": "JCB",
  "15": "UnionPay",
  "16": "UnionPay",
  "17": "EMVCo",
  "18": "EMVCo",
  "19": "EMVCo",
  "20": "EMVCo",
  "21": "EMVCo",
  "22": "EMVCo",
  "23": "EMVCo",
  "24": "EMVCo",
  "25": "EMVCo",
  "26": "Merchant Account Information",
  "27": "Merchant Account Information",
  "28": "Merchant Account Information",
  "29": "Merchant Account Information",
  "30": "Merchant Account Information",
  "31": "Merchant Account Information",
  "32": "Merchant Account Information",
  "33": "Merchant Account Information",
  "34": "Merchant Account Information",
  "35": "Merchant Account Information",
  "36": "Merchant Account Information",
  "37": "Merchant Account Information",
  "38": "Merchant Account Information",
  "39": "Merchant Account Information",
  "40": "Merchant Account Information",
  "41": "Merchant Account Information",
  "42": "Merchant Account Information",
  "43": "Merchant Account Information",
  "44": "Merchant Account Information",
  "45": "Merchant Account Information",
  "46": "Merchant Account Information",
  "47": "Merchant Account Information",
  "48": "Merchant Account Information",
  "49": "Merchant Account Information",
  "50": "Merchant Account Information",
  "51": "Merchant Account Information",
  "52": "Merchant Category Code",
  "53": "Transaction Currency",
  "54": "Transaction Amount",
  "55": "Tip or Convenience Indicator",
  "56": "Value of Convenience Fee (Fixed)",
  "57": "Value of Convenience Fee (%)",
  "58": "Country Code",
  "59": "Merchant Name",
  "60": "Merchant City",
  "61": "Postal Code",
  "62": "Additional Data Field",
  "63": "CRC",
  "64": "Merchant Information (Language)",
};

const QRIS_MERCHANT_SUBTAGS = {
  "00": "Globally Unique Identifier",
  "01": "Merchant PAN / ID",
  "02": "Merchant ID",
  "03": "Merchant Criteria",
};

const QRIS_ADDITIONAL_SUBTAGS = {
  "01": "Bill Number",
  "02": "Mobile Number",
  "03": "Store Label",
  "04": "Loyalty Number",
  "05": "Reference Label",
  "06": "Customer Label",
  "07": "Terminal Label",
  "08": "Purpose of Transaction",
  "09": "Additional Consumer Data Request",
};

const QRIS_LANGUAGE_SUBTAGS = {
  "00": "Language Preference",
  "01": "Merchant Name (Alt Language)",
  "02": "Merchant City (Alt Language)",
};

const CURRENCY_CODES = { "360": "IDR", "840": "USD", "702": "SGD", "458": "MYR", "764": "THB", "608": "PHP", "704": "VND" };

// Merchant Category Codes (ISO 18245)
const MCC_CODES = {
  "0000": "Not Applicable",
  "1520": "General Contractors",
  "4111": "Local/Suburban Transportation",
  "4121": "Taxicabs/Limousines",
  "4131": "Bus Lines",
  "4214": "Motor Freight/Trucking",
  "4411": "Cruise Lines",
  "4511": "Airlines",
  "4722": "Travel Agencies",
  "4784": "Tolls/Bridge Fees",
  "4812": "Telecommunication Equipment",
  "4814": "Telecommunication Services",
  "4816": "Computer Network/IT Services",
  "4829": "Wire Transfer/Money Orders",
  "4899": "Cable/Pay TV",
  "4900": "Utilities",
  "5111": "Stationery/Office Supplies",
  "5137": "Uniforms/Commercial Clothing",
  "5139": "Commercial Footwear",
  "5169": "Chemicals/Allied Products",
  "5172": "Petroleum Products",
  "5192": "Books/Periodicals/Newspapers",
  "5193": "Florists",
  "5200": "Home Supply Warehouses",
  "5211": "Building Materials/Lumber",
  "5261": "Nurseries/Lawn & Garden",
  "5300": "General Wholesale",
  "5311": "Department Stores",
  "5331": "Variety Stores",
  "5399": "General Merchandise",
  "5411": "Grocery Stores/Supermarkets",
  "5422": "Freezer/Locker Meat Provisioners",
  "5441": "Candy/Nut/Confectionery",
  "5451": "Dairy Products",
  "5462": "Bakeries",
  "5499": "Misc Food Stores",
  "5511": "Auto Dealers (New & Used)",
  "5521": "Auto Dealers (Used Only)",
  "5531": "Auto/Home Supply Stores",
  "5532": "Automotive Tire Stores",
  "5533": "Automotive Parts/Accessories",
  "5541": "Gas Stations",
  "5542": "Fuel Dispenser/Automated",
  "5611": "Men's/Boys' Clothing",
  "5621": "Women's Ready-to-Wear",
  "5631": "Women's Accessories",
  "5641": "Children's/Infants' Wear",
  "5651": "Family Clothing",
  "5661": "Shoe Stores",
  "5691": "Men's/Women's Clothing",
  "5699": "Misc Apparel/Accessories",
  "5712": "Furniture/Home Furnishings",
  "5713": "Floor Covering",
  "5714": "Drapery/Window Coverings",
  "5718": "Fireplace/Accessories",
  "5719": "Misc Home Furnishings",
  "5722": "Household Appliances",
  "5732": "Electronics Stores",
  "5733": "Music Stores/Instruments",
  "5734": "Computer Software Stores",
  "5735": "Record Stores",
  "5811": "Caterers",
  "5812": "Eating Places/Restaurants",
  "5813": "Bars/Taverns/Nightclubs",
  "5814": "Fast Food Restaurants",
  "5815": "Digital Goods: Media",
  "5816": "Digital Goods: Games",
  "5817": "Digital Goods: Applications",
  "5818": "Digital Goods: Large Volume",
  "5912": "Drug Stores/Pharmacies",
  "5921": "Package Stores/Beer/Wine/Liquor",
  "5931": "Used Merchandise/Secondhand",
  "5941": "Sporting Goods",
  "5942": "Book Stores",
  "5943": "Stationery Stores",
  "5944": "Jewelry/Watches/Clocks",
  "5945": "Hobby/Toy/Game Shops",
  "5946": "Camera/Photographic Supply",
  "5947": "Gift/Card/Novelty/Souvenir",
  "5948": "Luggage/Leather Goods",
  "5949": "Sewing/Needlework/Fabric",
  "5950": "Glassware/Crystal",
  "5960": "Direct Marketing: Insurance",
  "5963": "Door-to-Door Sales",
  "5964": "Direct Marketing: Catalog",
  "5965": "Direct Marketing: Combination",
  "5966": "Direct Marketing: Outbound Telemarketing",
  "5967": "Direct Marketing: Inbound Teleservices",
  "5968": "Direct Marketing: Subscriptions",
  "5969": "Direct Marketing: Other",
  "5970": "Artist Supply/Craft Shops",
  "5971": "Art Dealers/Galleries",
  "5972": "Stamp/Coin Stores",
  "5973": "Religious Goods",
  "5975": "Hearing Aids",
  "5976": "Orthopedic Goods/Prosthetics",
  "5977": "Cosmetic Stores",
  "5978": "Typewriter Stores",
  "5983": "Fuel Dealers",
  "5992": "Florists",
  "5993": "Cigar/Tobacco Stores",
  "5994": "News Dealers/Newsstands",
  "5995": "Pet Shops/Food/Supplies",
  "5996": "Swimming Pools",
  "5997": "Electric Razor Stores",
  "5998": "Tent/Awning Shops",
  "5999": "Misc Specialty Retail",
  "6010": "Financial Institutions: Cash",
  "6011": "Automated Cash Disbursements",
  "6012": "Financial Institutions: Merchandise",
  "6051": "Non-Financial Institutions: Foreign Currency/Money Orders",
  "6211": "Security Brokers/Dealers",
  "6300": "Insurance Sales/Underwriting",
  "6513": "Real Estate Agents/Rentals",
  "7011": "Hotels/Motels/Resorts",
  "7032": "Sporting/Recreation Camps",
  "7033": "Trailer Parks/Campgrounds",
  "7210": "Laundry/Cleaning/Garment",
  "7211": "Laundry Services: Family/Commercial",
  "7216": "Dry Cleaners",
  "7217": "Carpet/Upholstery Cleaning",
  "7221": "Photographic Studios",
  "7230": "Beauty/Barber Shops",
  "7251": "Shoe Repair/Hat Cleaning",
  "7261": "Funeral Services/Crematories",
  "7273": "Dating/Escort Services",
  "7276": "Tax Preparation Services",
  "7277": "Counseling Services",
  "7278": "Buying/Shopping Services",
  "7296": "Clothing Rental",
  "7297": "Massage Parlors",
  "7298": "Health/Beauty Spas",
  "7299": "Misc Personal Services",
  "7311": "Advertising Services",
  "7321": "Consumer Credit Reporting",
  "7333": "Commercial Photography/Art/Graphics",
  "7338": "Quick Copy/Reproduction",
  "7339": "Stenographic/Secretarial Services",
  "7342": "Exterminating/Disinfecting",
  "7349": "Cleaning/Maintenance/Janitorial",
  "7361": "Employment/Temp Agencies",
  "7372": "Computer Programming/Data Processing",
  "7375": "Information Retrieval Services",
  "7379": "Computer Repair",
  "7392": "Management/Consulting/PR",
  "7393": "Detective/Protective/Security",
  "7394": "Equipment Rental/Leasing",
  "7395": "Photo Developing",
  "7399": "Misc Business Services",
  "7512": "Car Rental Agencies",
  "7513": "Truck/Utility Trailer Rentals",
  "7519": "Motor Home/RV Rentals",
  "7523": "Parking Lots/Garages",
  "7531": "Auto Body Repair",
  "7534": "Tire Retreading/Repair",
  "7535": "Auto Paint Shops",
  "7538": "Auto Service Shops",
  "7542": "Car Washes",
  "7549": "Towing Services",
  "7622": "Electronics Repair",
  "7623": "A/C, Refrigeration Repair",
  "7629": "Appliance Repair",
  "7631": "Watch/Clock/Jewelry Repair",
  "7641": "Furniture Repair/Refinishing",
  "7692": "Welding Repair",
  "7699": "Misc Repair Shops",
  "7800": "Government-Owned Lotteries",
  "7801": "Government-Licensed Online Casinos",
  "7802": "Government-Licensed Horse/Dog Racing",
  "7829": "Motion Picture/Video Distribution",
  "7832": "Motion Picture Theaters",
  "7841": "Video Tape Rental",
  "7911": "Dance Studios/Schools",
  "7922": "Theatrical Producers",
  "7929": "Bands/Orchestras/Entertainers",
  "7932": "Billiard/Pool",
  "7933": "Bowling Alleys",
  "7941": "Commercial Sports/Athletic Fields",
  "7991": "Tourist Attractions/Exhibits",
  "7992": "Golf Courses (Public)",
  "7993": "Video Amusement Game Supplies",
  "7994": "Video Game Arcades",
  "7995": "Betting/Casino Gambling",
  "7996": "Amusement Parks/Carnivals",
  "7997": "Country Clubs/Membership",
  "7998": "Aquariums/Seaquariums",
  "7999": "Misc Recreation Services",
  "8011": "Doctors",
  "8021": "Dentists/Orthodontists",
  "8031": "Osteopaths",
  "8041": "Chiropractors",
  "8042": "Optometrists/Ophthalmologists",
  "8043": "Opticians/Optical Goods",
  "8049": "Podiatrists/Chiropodists",
  "8050": "Nursing/Personal Care Facilities",
  "8062": "Hospitals",
  "8071": "Medical/Dental Labs",
  "8099": "Medical Services/Health Practitioners",
  "8111": "Legal Services/Attorneys",
  "8211": "Schools/Educational Services",
  "8220": "Colleges/Universities",
  "8241": "Correspondence Schools",
  "8244": "Business/Secretarial Schools",
  "8249": "Trade/Vocational Schools",
  "8299": "Schools/Educational Services (Other)",
  "8351": "Child Care Services",
  "8398": "Charitable/Social Service Orgs",
  "8641": "Civic/Social/Fraternal Associations",
  "8651": "Political Organizations",
  "8661": "Religious Organizations",
  "8675": "Automobile Associations",
  "8699": "Membership Organizations (Other)",
  "8734": "Testing Laboratories",
  "8911": "Architectural/Engineering/Surveying",
  "8931": "Accounting/Auditing/Bookkeeping",
  "8999": "Professional Services (Other)",
  "9211": "Court Costs/Fines",
  "9222": "Fines",
  "9223": "Bail/Bond Payments",
  "9311": "Tax Payments",
  "9399": "Government Services (Other)",
  "9402": "Postal Services: Government Only",
  "9405": "Intra-Government Purchases",
};

const QRIS_MANDATORY_TAGS = ["00", "52", "53", "58", "59", "60", "63"];

function getQrisTagName(tag, parentTag) {
  if (!parentTag) return QRIS_ROOT_TAGS[tag] || null;

  const parentNum = parseInt(parentTag, 10);
  if (parentNum >= 26 && parentNum <= 51) return QRIS_MERCHANT_SUBTAGS[tag] || null;
  if (parentTag === "62") return QRIS_ADDITIONAL_SUBTAGS[tag] || null;
  if (parentTag === "64") return QRIS_LANGUAGE_SUBTAGS[tag] || null;

  return null;
}

function getQrisValueAnnotation(tag, value) {
  if (tag === "01") {
    if (value === "11") return "Static";
    if (value === "12") return "Dynamic";
  }
  if (tag === "52" && MCC_CODES[value]) return MCC_CODES[value];
  if (tag === "53" && CURRENCY_CODES[value]) return CURRENCY_CODES[value];
  if (tag === "55") {
    if (value === "01") return "Tip prompted";
    if (value === "02") return "Fixed fee";
    if (value === "03") return "Percentage fee";
  }
  return null;
}

// ── CRC-CCITT ───────────────────────────────────────────────────────────────

function crcCCITT(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc;
}

function validateQrisCrc(input) {
  const crcTagIdx = input.lastIndexOf("6304");
  if (crcTagIdx === -1) return { present: false };

  const payloadForCrc = input.substring(0, crcTagIdx + 4);
  const expected = crcCCITT(payloadForCrc).toString(16).toUpperCase().padStart(4, "0");
  const actual = input.substring(crcTagIdx + 4, crcTagIdx + 8).toUpperCase();

  return { present: true, valid: expected === actual, expected, actual };
}

// ── EMV QR / QRIS Parser ───────────────────────────────────────────────────

function isQrisConstructedTag(tag, depth) {
  // Only root-level tags are templates; sub-tags within templates are primitive
  if (depth > 0) return false;
  const n = parseInt(tag, 10);
  if (isNaN(n)) return false;
  if (n >= 26 && n <= 51) return true;
  if (n === 62 || n === 64) return true;
  if (n >= 80 && n <= 99) return true;
  return false;
}

function parseEmvQrNodes(text, start, end, depth, state, parentTag) {
  if (depth > 10) throw new Error("Maximum nesting depth exceeded.");

  const nodes = [];
  let cursor = start;

  while (cursor < end) {
    const remaining = end - cursor;
    if (remaining < 4) {
      if (remaining > 0) {
        throw new Error(`Incomplete TLV at position ${cursor}: need at least 4 characters for tag+length, got ${remaining}.`);
      }
      break;
    }

    const tag = text.substring(cursor, cursor + 2);
    const lenStr = text.substring(cursor + 2, cursor + 4);
    const len = parseInt(lenStr, 10);

    if (!/^\d{2}$/.test(tag)) throw new Error(`Invalid tag "${tag}" at position ${cursor}.`);
    if (!/^\d{2}$/.test(lenStr) || isNaN(len)) throw new Error(`Invalid length "${lenStr}" at position ${cursor + 2}.`);

    const valueStart = cursor + 4;
    const valueEnd = valueStart + len;

    if (valueEnd > end) {
      throw new Error(`Value for tag ${tag} at position ${cursor} exceeds input (needs ${len} chars, ${end - valueStart} available).`);
    }

    const value = text.substring(valueStart, valueEnd);
    const rowIndex = state.nextRowIndex++;
    const constructed = isQrisConstructedTag(tag, depth);
    const tagName = getQrisTagName(tag, parentTag);
    const annotation = !constructed ? getQrisValueAnnotation(tag, value) : null;

    const node = {
      rowIndex,
      depth,
      offset: cursor,
      tag,
      tagName,
      constructed,
      length: len,
      value,
      annotation,
      children: [],
    };

    state.rows.push({
      rowIndex: node.rowIndex,
      depth: node.depth,
      offset: node.offset,
      tag: node.tag,
      tagName: node.tagName,
      constructed: node.constructed,
      length: node.length,
      value: node.value,
      annotation: node.annotation,
    });

    if (constructed && len > 0) {
      node.children = parseEmvQrNodes(text, valueStart, valueEnd, depth + 1, state, tag);
    }

    nodes.push(node);
    cursor = valueEnd;
  }

  return nodes;
}

function toQrisJsonTree(nodes) {
  return nodes.map((node) => {
    const entry = { tag: node.tag };
    if (node.tagName) entry.name = node.tagName;
    entry.length = node.length;
    entry.value = node.value;
    if (node.annotation) entry.annotation = node.annotation;
    if (node.children && node.children.length > 0) entry.children = toQrisJsonTree(node.children);
    return entry;
  });
}

function validateQrisPayload(nodes) {
  const issues = [];
  const tagMap = {};
  for (const node of nodes) {
    tagMap[node.tag] = node.value;
  }

  for (const tag of QRIS_MANDATORY_TAGS) {
    if (!(tag in tagMap)) {
      const name = QRIS_ROOT_TAGS[tag] || tag;
      issues.push({ level: "error", message: `Missing mandatory tag ${tag} (${name}).` });
    }
  }

  if ("00" in tagMap && tagMap["00"] !== "01") {
    issues.push({ level: "error", message: `Tag 00 (Payload Format Indicator) must be "01", got "${tagMap["00"]}".` });
  }

  if ("01" in tagMap && tagMap["01"] !== "11" && tagMap["01"] !== "12") {
    issues.push({ level: "error", message: `Tag 01 (Point of Initiation Method) must be "11" or "12", got "${tagMap["01"]}".` });
  }

  if (!("01" in tagMap)) {
    issues.push({ level: "warn", message: "Tag 01 (Point of Initiation Method) is missing. It is recommended by EMVCo." });
  }

  const hasMerchantAccount = nodes.some((n) => {
    const num = parseInt(n.tag, 10);
    return num >= 26 && num <= 51;
  });
  if (!hasMerchantAccount) {
    issues.push({ level: "warn", message: "No Merchant Account Information tags (26-51) found." });
  }

  if ("52" in tagMap && !MCC_CODES[tagMap["52"]]) {
    issues.push({ level: "warn", message: `Tag 52 (Merchant Category Code) value "${tagMap["52"]}" is not a recognized MCC.` });
  }

  if ("53" in tagMap && !CURRENCY_CODES[tagMap["53"]]) {
    issues.push({ level: "warn", message: `Tag 53 (Transaction Currency) value "${tagMap["53"]}" is not a recognized currency code.` });
  }

  if ("58" in tagMap && tagMap["58"].length !== 2) {
    issues.push({ level: "warn", message: `Tag 58 (Country Code) should be 2 characters, got "${tagMap["58"]}" (${tagMap["58"].length} chars).` });
  }

  return issues;
}

function parseQris(input) {
  const text = String(input || "").trim();
  if (!text) throw new Error("Input is empty.");

  const crc = validateQrisCrc(text);

  const state = { nextRowIndex: 1, rows: [] };
  const nodes = parseEmvQrNodes(text, 0, text.length, 0, state, null);
  const maxDepth = state.rows.reduce((d, r) => Math.max(d, r.depth), 0);
  const validation = validateQrisPayload(nodes);

  return {
    format: "qris",
    nodes,
    rows: state.rows,
    jsonTree: toQrisJsonTree(nodes),
    crc,
    validation,
    summary: {
      charLength: text.length,
      nodeCount: state.rows.length,
      maxDepth,
      topLevelCount: nodes.length,
    },
  };
}

// ── QRIS Sample Builder ────────────────────────────────────────────────────

function buildQrisSample() {
  // Build each tag properly with correct lengths
  const merchant26 = "0011ID.DANA.WWW" + "0118936009153000000123" + "0303UME";
  const merchant51 = "0014ID.CO.QRIS.WWW" + "0215ID1020010000001" + "0303UME";
  const additional62 = "0703A01";

  const parts = [
    "000201",
    "010211",
    "26" + String(merchant26.length).padStart(2, "0") + merchant26,
    "51" + String(merchant51.length).padStart(2, "0") + merchant51,
    "52045411",
    "5303360",
    "5802ID",
    "5909TOKO BUDI",
    "6007JAKARTA",
    "610510110",
    "62" + String(additional62.length).padStart(2, "0") + additional62,
  ];
  const body = parts.join("") + "6304";
  const crc = crcCCITT(body).toString(16).toUpperCase().padStart(4, "0");
  return body + crc;
}

// ── BER-TLV Parser (existing) ──────────────────────────────────────────────

const TAG_CLASS_LABELS = ["Universal", "Application", "Context-specific", "Private"];

function sanitizeHexInput(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";

  const cleaned = raw.replace(/0x/gi, "").replace(/[\s,:;|_-]+/g, "").replace(/[^a-fA-F0-9]/g, "");
  if (!cleaned) return "";
  if (cleaned.length % 2 !== 0) throw new Error("Hex input has odd length. Every byte must contain two hex characters.");
  return cleaned.toUpperCase();
}

function bytesToHex(bytes, separator = " ") {
  return Array.from(bytes).map((v) => v.toString(16).toUpperCase().padStart(2, "0")).join(separator);
}

function bytesFromHexInput(input) {
  const normalized = sanitizeHexInput(input);
  if (!normalized) return new Uint8Array();
  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < normalized.length; i += 2) bytes[i / 2] = parseInt(normalized.slice(i, i + 2), 16);
  return bytes;
}

function bytesFromBase64Input(input) {
  const normalized = String(input || "").replace(/\s+/g, "");
  if (!normalized) return new Uint8Array();
  try {
    const binary = atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch (_) {
    throw new Error("Base64 input is invalid.");
  }
}

function getPrintablePreview(valueBytes, maxLength = 48) {
  if (!valueBytes || valueBytes.length === 0) return "";
  let decoded = "";
  try {
    decoded = new TextDecoder("utf-8", { fatal: false }).decode(valueBytes);
  } catch (_) {
    return "";
  }
  const compact = decoded.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  const printable = compact.split("").filter((c) => { const code = c.charCodeAt(0); return code >= 32 && code <= 126; }).length;
  if (printable / compact.length < 0.75) return "";
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}...` : compact;
}

function parseTag(bytes, offset) {
  if (offset >= bytes.length) throw new Error("Unexpected end of input while reading tag.");
  const first = bytes[offset];
  const tagBytes = [first];
  let cursor = offset + 1;

  if ((first & 0x1f) === 0x1f) {
    let found = false;
    let guard = 0;
    while (cursor < bytes.length) {
      const next = bytes[cursor];
      tagBytes.push(next);
      cursor++;
      guard++;
      if (guard > 8) throw new Error(`Tag at offset ${offset} exceeds supported high-tag-number length.`);
      if ((next & 0x80) === 0) { found = true; break; }
    }
    if (!found) throw new Error(`Tag at offset ${offset} is truncated.`);
  }

  return {
    tagBytes,
    tagHex: bytesToHex(tagBytes, ""),
    tagClass: TAG_CLASS_LABELS[(first >> 6) & 0x03],
    constructed: (first & 0x20) !== 0,
    nextOffset: cursor,
  };
}

function parseLength(bytes, offset) {
  if (offset >= bytes.length) throw new Error("Unexpected end of input while reading length.");
  const first = bytes[offset];
  if ((first & 0x80) === 0) return { length: first, lengthBytes: [first], nextOffset: offset + 1 };

  const count = first & 0x7f;
  if (count === 0) throw new Error(`Indefinite length at offset ${offset} is not supported.`);
  if (count > 6) throw new Error(`Length field at offset ${offset} is too large.`);

  const start = offset + 1;
  const end = start + count;
  if (end > bytes.length) throw new Error(`Length field at offset ${offset} is truncated.`);

  let length = 0;
  for (let i = start; i < end; i++) length = length * 256 + bytes[i];
  return { length, lengthBytes: Array.from(bytes.slice(offset, end)), nextOffset: end };
}

function parseBerNodes(bytes, start, end, depth, state) {
  if (depth > 32) throw new Error("Maximum TLV nesting depth exceeded.");
  const nodes = [];
  let cursor = start;

  while (cursor < end) {
    const currentOffset = cursor;
    const tagInfo = parseTag(bytes, cursor);
    const lengthInfo = parseLength(bytes, tagInfo.nextOffset);
    const valueStart = lengthInfo.nextOffset;
    const valueEnd = valueStart + lengthInfo.length;
    if (valueEnd > end) throw new Error(`Value at offset ${currentOffset} exceeds available input length.`);

    const valueBytes = bytes.slice(valueStart, valueEnd);
    const rawBytes = bytes.slice(currentOffset, valueEnd);
    const rowIndex = state.nextRowIndex++;

    const node = {
      rowIndex,
      depth,
      offset: currentOffset,
      tag: tagInfo.tagHex,
      tagClass: tagInfo.tagClass,
      constructed: tagInfo.constructed,
      length: lengthInfo.length,
      valueHex: bytesToHex(valueBytes),
      rawHex: bytesToHex(rawBytes),
      valuePreview: getPrintablePreview(valueBytes),
      children: [],
    };

    state.rows.push({
      rowIndex: node.rowIndex,
      depth: node.depth,
      offset: node.offset,
      tagClass: node.tagClass,
      tag: node.tag,
      constructed: node.constructed,
      length: node.length,
      valuePreview: node.valuePreview,
      valueHex: node.valueHex,
      rawHex: node.rawHex,
    });

    if (tagInfo.constructed && lengthInfo.length > 0) {
      node.children = parseBerNodes(bytes, valueStart, valueEnd, depth + 1, state);
    }

    nodes.push(node);
    cursor = valueEnd;
  }

  return nodes;
}

function toBerJsonTree(nodes) {
  return nodes.map((n) => ({
    tag: n.tag,
    class: n.tagClass,
    constructed: n.constructed,
    length: n.length,
    offset: n.offset,
    valueHex: n.valueHex,
    preview: n.valuePreview || undefined,
    children: toBerJsonTree(n.children),
  }));
}

function parseBerTlv(input, inputMode = "hex") {
  const bytes = inputMode === "base64" ? bytesFromBase64Input(input) : bytesFromHexInput(input);
  if (!bytes || bytes.length === 0) throw new Error("Input is empty.");

  const state = { nextRowIndex: 1, rows: [] };
  const nodes = parseBerNodes(bytes, 0, bytes.length, 0, state);
  const maxDepth = state.rows.reduce((d, r) => Math.max(d, r.depth), 0);

  return {
    format: "ber-tlv",
    bytes,
    nodes,
    rows: state.rows,
    jsonTree: toBerJsonTree(nodes),
    summary: {
      byteLength: bytes.length,
      nodeCount: state.rows.length,
      maxDepth,
      topLevelCount: nodes.length,
    },
  };
}

// ── Auto-detect ─────────────────────────────────────────────────────────────

function detectFormat(input) {
  const trimmed = String(input || "").trim();
  if (!trimmed) return "qris";

  // QRIS payloads always start with "000201" (Payload Format Indicator = "01")
  if (trimmed.startsWith("000201")) return "qris";

  // If it looks like it could be base64 (has + / = and no spaces between hex pairs)
  if (/^[A-Za-z0-9+/]+=*$/.test(trimmed) && /[+/=]/.test(trimmed)) return "ber-base64";

  // If it's purely hex characters (possibly with separators)
  const hexCleaned = trimmed.replace(/0x/gi, "").replace(/[\s,:;|_-]+/g, "");
  if (/^[a-fA-F0-9]+$/.test(hexCleaned)) return "ber-hex";

  // Default to QRIS for text input
  return "qris";
}

// ── Main entry ──────────────────────────────────────────────────────────────

function parse(input, format = "auto") {
  const resolvedFormat = format === "auto" ? detectFormat(input) : format;

  if (resolvedFormat === "qris") return parseQris(input);
  if (resolvedFormat === "ber-base64") return parseBerTlv(input, "base64");
  return parseBerTlv(input, "hex");
}

export const TLVViewerService = {
  sanitizeHexInput,
  bytesFromHexInput,
  bytesToHex,
  parse,
  parseQris,
  parseBerTlv,
  detectFormat,
  validateQrisCrc,
  validateQrisPayload,
  crcCCITT,
  buildQrisSample,
};

export { parseLength, parseTag };
