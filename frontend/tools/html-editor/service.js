import { parse, render } from "velocityjs";

const RESERVED_CONTEXT_NAMES = new Set(["format", "foreach"]);

function referencePath(node) {
  if (!node || node.type !== "references" || !node.id) return "";
  const parts = [node.id];
  for (const segment of node.path || []) {
    if (segment.type !== "property" || !segment.id) break;
    parts.push(segment.id);
  }
  return parts.join(".");
}

function collectExternalReferences(node, locals, variables) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    const header = node[0];
    if (header?.type === "foreach") {
      collectExternalReferences(header.from, locals, variables);
      const blockLocals = new Set(locals);
      blockLocals.add(header.to);
      node.slice(1).forEach((child) => collectExternalReferences(child, blockLocals, variables));
      return;
    }
    if (header?.type === "macro") {
      const blockLocals = new Set(locals);
      (header.args || []).forEach((arg) => blockLocals.add(String(arg?.id || arg || "").replace(/^\$/, "")));
      node.slice(1).forEach((child) => collectExternalReferences(child, blockLocals, variables));
      return;
    }
    node.forEach((child) => {
      if (child?.type === "set") {
        collectExternalReferences(child.equal?.[1], locals, variables);
        const assigned = referencePath(child.equal?.[0]);
        if (assigned) locals.add(assigned.split(".")[0]);
      } else {
        collectExternalReferences(child, locals, variables);
      }
    });
    return;
  }
  if (node.type === "references") {
    const path = referencePath(node);
    const root = path.split(".")[0];
    if (path && !locals.has(root) && !RESERVED_CONTEXT_NAMES.has(root) && root !== "baseUrl") variables.add(path);
    (node.path || []).forEach((segment) => collectExternalReferences(segment, locals, variables));
    return;
  }
  Object.values(node).forEach((child) => collectExternalReferences(child, locals, variables));
}

function extractWithFallback(template) {
  const variables = new Set();
  const referenceRe = /(?<!\$)\$!?\{?\s*([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*)/g;
  let match;
  while ((match = referenceRe.exec(template)) !== null) variables.add(match[1]);
  return variables;
}

/**
 * Extract external VTL references from interpolation, directives, conditions,
 * method arguments, and nested property paths. Locals introduced by #set,
 * #foreach, and #macro are omitted, as is the built-in $format helper.
 */
export function extractVtlVariables(template = "") {
  if (!template) return [];

  let ast;
  try {
    ast = parse(String(template));
  } catch (_) {
    return Array.from(extractWithFallback(String(template)))
      .filter((name) => !RESERVED_CONTEXT_NAMES.has(name.split(".")[0]) && name !== "baseUrl")
      .sort();
  }

  const variables = new Set();
  collectExternalReferences(ast, new Set(), variables);

  return Array.from(variables).sort();
}

export function debounce(fn, delay = 250) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

export function getVtlValue(values, path) {
  if (!values || typeof values !== "object") return undefined;
  if (Object.prototype.hasOwnProperty.call(values, path)) return values[path];
  return path.split(".").reduce((value, key) => (value == null ? undefined : value[key]), values);
}

export function setVtlValue(values, path, value) {
  const target = values && typeof values === "object" ? values : {};
  if (Object.prototype.hasOwnProperty.call(target, path)) {
    target[path] = value;
    return target;
  }
  const parts = String(path).split(".");
  let cursor = target;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) {
      cursor[part] = value;
    } else {
      if (!cursor[part] || typeof cursor[part] !== "object" || Array.isArray(cursor[part])) cursor[part] = {};
      cursor = cursor[part];
    }
  });
  return target;
}

export function deleteVtlValue(values, path) {
  if (!values || typeof values !== "object") return;
  if (Object.prototype.hasOwnProperty.call(values, path)) delete values[path];
  const parts = String(path).split(".");
  const parents = [];
  let cursor = values;
  for (const part of parts.slice(0, -1)) {
    if (!cursor?.[part] || typeof cursor[part] !== "object") return;
    parents.push([cursor, part]);
    cursor = cursor[part];
  }
  delete cursor[parts.at(-1)];
  parents.reverse().forEach(([parent, key]) => {
    if (Object.keys(parent[key]).length === 0) delete parent[key];
  });
}

export function buildVtlValuesExport(template = "", values = {}) {
  const output = {};
  extractVtlVariables(template).forEach((path) => {
    setVtlValue(output, path, getVtlValue(values, path) ?? "");
  });
  return output;
}

function buildContext(values) {
  const context = {};
  if (!values || typeof values !== "object") return context;
  Object.entries(values).forEach(([key, value]) => {
    if (!key.includes(".")) context[key] = value;
  });
  Object.entries(values).forEach(([key, value]) => {
    if (key.includes(".")) setVtlValue(context, key, value);
  });
  return context;
}

function parseTemplateDate(input) {
  const text = String(input ?? "").trim();
  const match = text.match(/^(\d{4})-?(\d{2})-?(\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(?:Z|([+-])(\d{2})(?::?(\d{2}))?)?)?$/);
  if (!match) return null;
  const [, year, month, day, hour = "00", minute = "00", second = "00", millis = "0", sign, zoneHour = "00", zoneMinute = "00"] = match;
  let timestamp = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second, +millis.padEnd(3, "0"));
  if (sign) timestamp -= (sign === "+" ? 1 : -1) * (+zoneHour * 60 + +zoneMinute) * 60_000;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateParts(date, locale) {
  const localeName = String(locale || "en").replace("_", "-");
  const numeric = new Intl.DateTimeFormat(localeName, {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(numeric.formatToParts(date).map(({ type, value }) => [type, value]));
  parts.monthShort = new Intl.DateTimeFormat(localeName, { timeZone: "UTC", month: "short" }).format(date);
  parts.monthLong = new Intl.DateTimeFormat(localeName, { timeZone: "UTC", month: "long" }).format(date);
  return parts;
}

function javaDateFormat(input, pattern, locale) {
  const date = parseTemplateDate(input);
  if (!date) return String(input ?? "");
  let parts;
  try {
    parts = dateParts(date, locale);
  } catch (_) {
    parts = dateParts(date, "en");
  }
  const hour24 = Number(parts.hour);
  const hour12 = hour24 % 12 || 12;
  const replacements = {
    yyyy: parts.year,
    MMMM: parts.monthLong,
    MMM: parts.monthShort,
    MM: parts.month,
    M: String(Number(parts.month)),
    dd: parts.day,
    d: String(Number(parts.day)),
    HH: String(hour24).padStart(2, "0"),
    H: String(hour24),
    hh: String(hour12).padStart(2, "0"),
    h: String(hour12),
    mm: parts.minute,
    m: String(Number(parts.minute)),
    ss: parts.second,
    s: String(Number(parts.second)),
    a: hour24 < 12 ? "AM" : "PM",
  };
  return String(pattern).replace(/M{4,}|yyyy|MMM|MM|M|dd|d|HH|H|hh|h|mm|m|ss|s|a/g, (token) =>
    token.length > 4 && token[0] === "M" ? parts.monthLong : replacements[token],
  );
}

function decimalString(input, minimumFractionDigits = 2, maximumFractionDigits = minimumFractionDigits, grouping = true) {
  const number = Number(String(input ?? "").replace(/,/g, ""));
  if (!Number.isFinite(number)) return String(input ?? "");
  return new Intl.NumberFormat("en-US", { useGrouping: grouping, minimumFractionDigits, maximumFractionDigits }).format(number);
}

function sha256(value) {
  const bytes = new TextEncoder().encode(String(value));
  const words = [];
  const bitLength = bytes.length * 8;
  bytes.forEach((byte, index) => (words[index >> 2] = (words[index >> 2] || 0) | (byte << (24 - (index % 4) * 8))));
  words[bitLength >> 5] = (words[bitLength >> 5] || 0) | (0x80 << (24 - (bitLength % 32)));
  words[(((bitLength + 64) >> 9) << 4) + 15] = bitLength;
  const constants = [];
  const initial = [];
  let candidate = 2;
  while (constants.length < 64) {
    let prime = true;
    for (let divisor = 2; divisor * divisor <= candidate; divisor++) if (candidate % divisor === 0) prime = false;
    if (prime) {
      if (initial.length < 8) initial.push((Math.sqrt(candidate) * 0x100000000) | 0);
      constants.push((Math.cbrt(candidate) * 0x100000000) | 0);
    }
    candidate++;
  }
  const hash = initial.slice();
  const rotate = (number, amount) => (number >>> amount) | (number << (32 - amount));
  for (let offset = 0; offset < words.length; offset += 16) {
    const schedule = words.slice(offset, offset + 16);
    for (let index = 0; index < 16; index++) schedule[index] = schedule[index] || 0;
    for (let index = 16; index < 64; index++) {
      const a = schedule[index - 15];
      const b = schedule[index - 2];
      schedule[index] =
        (schedule[index - 16] +
          (rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3)) +
          schedule[index - 7] +
          (rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10))) |
        0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index++) {
      const t1 = (h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + constants[index] + schedule[index]) | 0;
      const t2 = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      [a, b, c, d, e, f, g, h] = [(t1 + t2) | 0, a, b, c, (d + t1) | 0, e, f, g];
    }
    [a, b, c, d, e, f, g, h].forEach((value, index) => (hash[index] = (hash[index] + value) | 0));
  }
  return hash.map((word) => (word >>> 0).toString(16).padStart(8, "0")).join("");
}

export const templateFormatter = {
  dateShort: (input, locale) => javaDateFormat(input, "d/M/yyyy", locale),
  dateLong: (input, locale) => javaDateFormat(input, "d MMM yyyy", locale).replace("Agt", "Agu"),
  dateFull: (input, locale) => javaDateFormat(input, "d MMMMMMMMMMMMMMM yyyy", locale),
  time12: (input, locale) => javaDateFormat(input, "h:mm:ss a", locale),
  time24: (input, locale) => javaDateFormat(input, "HH:mm:ss", locale),
  formatDate: javaDateFormat,
  amount: (input) => decimalString(input),
  smsCurrency: (input) => decimalString(input, 2, 2, false),
  trimLeft10: (input) => String(input ?? "").slice(0, 10),
  trimLeft11: (input) => String(input ?? "").slice(0, 11),
  trimLeft25: (input) =>
    String(input ?? "")
      .slice(0, 25)
      .trim(),
  mask: (input) => `****${String(input ?? "").slice(-4)}`,
  currency: (input) => {
    const number = Number(String(input ?? "").replace(/,/g, ""));
    return Number.isFinite(number)
      ? new Intl.NumberFormat("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(number)
      : String(input ?? "");
  },
  add: (...numbers) => numbers.reduce((total, number) => total + (Number(String(number ?? "").trim() || 0) || 0), 0).toString(),
  encrypt: (input, salt) => sha256(`${input ?? ""}${salt ?? ""}`),
  currencyValas: (input) => {
    const source = String(input ?? "");
    const fractionDigits = source.includes(".") ? source.split(".")[1].length : 0;
    const number = Number(source);
    return Number.isFinite(number)
      ? new Intl.NumberFormat("id-ID", { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }).format(number)
      : "";
  },
};

/** Render an Apache Velocity-style template using values and TemplateFormatter helpers. */
export function renderVtlTemplate(template = "", values = {}) {
  if (!template) return template;
  return render(String(template), { ...buildContext(values), format: templateFormatter });
}

/** Return the preview source either with VTL evaluated or with the template syntax left untouched. */
export function getPreviewContent(template = "", values = {}, mode = "rendered") {
  const source = String(template ?? "");
  return mode === "plain" ? source : renderVtlTemplate(source, values);
}
