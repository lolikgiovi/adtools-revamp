import { parse } from "velocityjs";

export const DEFAULT_VELOCITY_ENDPOINT = "http://sandbox.everest.supporting.devmandiri.co.id/api-migration/v1/velocity/template";

export const DEFAULT_VELOCITY_HEADERS = {
  "accept-language": "id-ID",
  "content-type": "application/json",
  "x-device-id": "8A921BF0-CBA6-48D1-A151-F8A1836A4C1B",
};

export const DEFAULT_TEMPLATE = '{\n  "coba": "$!{environment}"\n}';

export const DEFAULT_PAYLOAD = JSON.stringify(
  {
    apiContext: {},
    environment: "beta",
    isEmandateOn: true,
    isAutoDebitOn: true,
    autoDebitPaymentListFromDB: [],
    emandateList: [],
    billReminderList: [],
    finalApiResponse: null,
  },
  null,
  2,
);

export function getErrorPosition(errorMessage = "") {
  const match = String(errorMessage).match(/position\s+(\d+)/i);
  return match ? Number(match[1]) : null;
}

export function parseJsonObject(content, label = "JSON") {
  try {
    const parsed = JSON.parse(String(content || ""));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { value: null, error: `${label} must be a JSON object.` };
    }
    return { value: parsed, error: null };
  } catch (error) {
    return { value: null, error: `${label} syntax error: ${error.message}`, position: getErrorPosition(error.message) };
  }
}

export function parseHeaderSettings(rawHeaders) {
  if (rawHeaders && typeof rawHeaders === "object" && !Array.isArray(rawHeaders)) {
    return normalizeHeaders(rawHeaders);
  }

  const raw = String(rawHeaders ?? "").trim();
  if (!raw) return { headers: { ...DEFAULT_VELOCITY_HEADERS }, error: null };

  const { value, error, position } = parseJsonObject(raw, "Headers");
  if (error) return { headers: null, error, position };
  return normalizeHeaders(value);
}

function normalizeHeaders(input) {
  const headers = {};
  for (const [key, value] of Object.entries(input || {})) {
    const cleanKey = String(key || "").trim();
    if (!cleanKey) continue;
    headers[cleanKey] = String(value ?? "");
  }
  headers["content-type"] = headers["content-type"] || headers["Content-Type"] || "application/json";
  return { headers, error: null };
}

export function buildRequestBody(template, payloadObject) {
  return {
    context: payloadObject,
    template: String(template ?? ""),
  };
}

export function validateVelocitySyntax(template) {
  try {
    const source = String(template ?? "");
    const directiveBalance = validateDirectiveBalance(source);
    if (!directiveBalance.valid) return directiveBalance;
    parse(source);
    return { valid: true, error: null };
  } catch (error) {
    return {
      valid: false,
      error: error?.message || String(error),
      position: typeof error?.hash?.loc?.first_column === "number" ? error.hash.loc.first_column : null,
    };
  }
}

export function validateDirectiveBalance(source) {
  const text = String(source ?? "");
  const stack = [];
  const directiveRe = /#(if|foreach|macro|define|else|elseif|end)\b/g;
  let match;
  while ((match = directiveRe.exec(text)) !== null) {
    const directive = match[1].toLowerCase();
    if (["if", "foreach", "macro", "define"].includes(directive)) {
      stack.push({ directive, position: match.index });
      continue;
    }
    if (directive === "else" || directive === "elseif") {
      if (stack.length === 0) {
        return { valid: false, error: `#${directive} without matching opener`, position: match.index };
      }
      continue;
    }
    if (directive === "end") {
      if (stack.length === 0) {
        return { valid: false, error: "#end without matching opener", position: match.index };
      }
      stack.pop();
    }
  }
  if (stack.length > 0) {
    const last = stack[stack.length - 1];
    return { valid: false, error: `#${last.directive} is missing #end`, position: last.position };
  }
  return { valid: true, error: null };
}

export function extractTemplateFromResponse(data) {
  if (Array.isArray(data)) {
    return { template: JSON.stringify(data), error: null, path: "$" };
  }

  if (!data || typeof data !== "object") {
    return { template: null, error: "Endpoint response must be a JSON object." };
  }

  const foundTemplate = findStringField(data, "template");
  if (foundTemplate) {
    return { template: foundTemplate.value, error: null, path: foundTemplate.path };
  }

  const fallback = findFirstStringPath(data, [
    ["data"],
    ["result"],
    ["response"],
    ["payload"],
    ["body"],
    ["data", "result"],
    ["data", "response"],
    ["data", "payload"],
    ["data", "body"],
  ]);
  if (fallback) {
    return { template: fallback.value, error: null, path: fallback.path };
  }

  if (isLikelyRenderedJson(data)) {
    return { template: JSON.stringify(data), error: null, path: "$" };
  }

  const keys = summarizeResponseKeys(data);
  return {
    template: null,
    error: `Endpoint response must include a string field named "template". Received keys: ${keys || "(none)"}.`,
  };
}

function isLikelyRenderedJson(data) {
  const keys = Object.keys(data || {});
  if (keys.length === 0) return true;

  const envelopeKeys = new Set([
    "code",
    "correlationId",
    "detail",
    "error",
    "errors",
    "message",
    "meta",
    "requestId",
    "responseCode",
    "responseMessage",
    "status",
    "success",
    "timestamp",
  ]);
  const hasEnvelopeSignal = keys.some((key) => envelopeKeys.has(key));
  const hasPayloadLikeKey = keys.some((key) => !envelopeKeys.has(key));

  return hasPayloadLikeKey || !hasEnvelopeSignal;
}

function findStringField(value, fieldName, path = [], seen = new Set(), depth = 0) {
  if (!value || typeof value !== "object" || depth > 5 || seen.has(value)) return null;
  seen.add(value);

  for (const [key, child] of Object.entries(value)) {
    const nextPath = [...path, key];
    if (key.toLowerCase() === fieldName.toLowerCase() && typeof child === "string") {
      return { value: child, path: nextPath.join(".") };
    }
    const nested = findStringField(child, fieldName, nextPath, seen, depth + 1);
    if (nested) return nested;
  }

  return null;
}

function findFirstStringPath(source, paths) {
  for (const path of paths) {
    let cursor = source;
    for (const segment of path) {
      cursor = cursor?.[segment];
    }
    if (typeof cursor === "string") {
      return { value: cursor, path: path.join(".") };
    }
  }
  return null;
}

function summarizeResponseKeys(data) {
  const keys = [];
  const queue = [{ value: data, path: "" }];
  const seen = new Set();
  while (queue.length && keys.length < 12) {
    const { value, path } = queue.shift();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
      const nextPath = path ? `${path}.${key}` : key;
      keys.push(nextPath);
      if (child && typeof child === "object") queue.push({ value: child, path: nextPath });
      if (keys.length >= 12) break;
    }
  }
  return keys.join(", ");
}

export function classifyResult(text) {
  const raw = String(text ?? "");
  const trimmed = raw.trim();
  if (!trimmed) {
    return { type: "text", raw, display: "", valid: true, error: null };
  }

  if (/^[\[{]/.test(trimmed)) {
    try {
      const parsed = JSON.parse(trimmed);
      return { type: "json", raw, display: JSON.stringify(parsed, null, 2), valid: true, error: null };
    } catch (error) {
      return { type: "json", raw, display: raw, valid: false, error: error.message, position: getErrorPosition(error.message) };
    }
  }

  if (/^\s*<!doctype\s+html\b/i.test(raw) || /^\s*<html[\s>]/i.test(raw) || /^\s*<[a-z][\w:-]*(?:\s[^>]*)?>[\s\S]*<\/[a-z][\w:-]*>\s*$/i.test(raw)) {
    return { type: "html", raw, display: raw, valid: true, error: null };
  }

  return { type: "text", raw, display: raw, valid: true, error: null };
}

export function getSettingsValue(key, fallback = "") {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch (_) {
    return fallback;
  }
}

export function getVelocitySettings() {
  const endpoint = getSettingsValue("config.velocityTemplate.endpoint", DEFAULT_VELOCITY_ENDPOINT).trim();
  const headersRaw = getSettingsValue("config.velocityTemplate.headers", JSON.stringify(DEFAULT_VELOCITY_HEADERS, null, 2));
  const customFunctionsRaw = getSettingsValue("config.velocityTemplate.customFunctions", "[]");
  let customFunctions = [];
  try {
    const parsed = JSON.parse(customFunctionsRaw);
    customFunctions = Array.isArray(parsed) ? parsed.map((item) => String(item ?? "").trim()).filter(Boolean) : [];
  } catch (_) {
    customFunctions = [];
  }
  return { endpoint, headersRaw, customFunctions };
}

export function formatVelocityParseError(error) {
  if (error?.name === "AbortError") {
    return "Velocity endpoint timed out after 30 seconds.";
  }

  const rawMessage = error?.message || String(error);
  const message = `Velocity parse failed: ${rawMessage}`;
  const jsonRenderHint = getRenderedJsonErrorHint(rawMessage);
  if (jsonRenderHint) {
    return `${message}\n${jsonRenderHint}`;
  }

  if (isLikelyConnectionError(rawMessage)) {
    return `${message}\nIf the endpoint works in curl but fails here, check browser/WebView CORS policy.`;
  }

  return message;
}

export function getRenderedOutputFromError(error) {
  return extractRenderedOutputFromMessage(error?.message || String(error || ""));
}

function getRenderedJsonErrorHint(message) {
  const raw = String(message || "");
  if (!/Unexpected character|expected a valid value|JSON parse|JsonParseException|Unrecognized token/i.test(raw)) return "";

  const hints = ["The endpoint rendered the template, then rejected the rendered output because it is not valid JSON."];
  if (/[{,]\s*[A-Za-z_$][\w$-]*\s*:/.test(raw)) {
    hints.push('Quote JSON object keys, for example `"ApplicationID"` instead of `ApplicationID`.');
  }
  if (/:\s*,/.test(raw)) {
    hints.push("Empty Velocity values cannot be left blank in JSON; render `null` or an empty string instead.");
  }
  if (/:\s*[A-Za-z_][\w.-]*(?:\s*[,}])/.test(raw)) {
    hints.push('Quote string values, for example `"EVREMASUAT2605NRNW00000355"`.');
  }

  return hints.join(" ");
}

function extractRenderedOutputFromMessage(message) {
  const raw = String(message || "");
  const sourceMatch = raw.match(/\[Source:\s*(?:\([^)]+\)\s*)?([\s\S]*?);\s*line:\s*\d+,\s*column:\s*\d+\]/i);
  const source = sourceMatch?.[1]?.trim();
  if (!source || source === "UNKNOWN") return "";
  return source.replace(/\.\.\.\s*$/, "").trim();
}

function isLikelyConnectionError(message) {
  return /Failed to fetch|NetworkError|Load failed|CORS|blocked by|origin|preflight/i.test(String(message || ""));
}

export async function requestVelocityTemplate({ endpoint, headers, template, payload, fetchImpl = fetch, signal } = {}) {
  const target = String(endpoint || "").trim();
  if (!target) throw new Error("Velocity endpoint is not configured.");

  const response = await fetchImpl(target, {
    method: "POST",
    headers: headers || { ...DEFAULT_VELOCITY_HEADERS },
    body: JSON.stringify(buildRequestBody(template, payload)),
    signal,
  });

  const responseText = await response.text();
  let data = null;
  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch (error) {
    throw new Error(`Endpoint returned non-JSON response: ${error.message}`);
  }

  if (!response.ok) {
    const message = data?.message || data?.error || data?.detail?.message || data?.detail || response.statusText || `HTTP ${response.status}`;
    const error = new Error(String(message));
    error.renderedOutput = getRenderedOutputFromError(error);
    throw error;
  }

  const extracted = extractTemplateFromResponse(data);
  if (extracted.error) throw new Error(extracted.error);
  return extracted.template;
}

export const VelocityTemplateService = {
  DEFAULT_TEMPLATE,
  DEFAULT_PAYLOAD,
  DEFAULT_VELOCITY_ENDPOINT,
  DEFAULT_VELOCITY_HEADERS,
  buildRequestBody,
  classifyResult,
  extractTemplateFromResponse,
  getRenderedOutputFromError,
  getSettingsValue,
  getVelocitySettings,
  formatVelocityParseError,
  parseHeaderSettings,
  parseJsonObject,
  requestVelocityTemplate,
  validateDirectiveBalance,
  validateVelocitySyntax,
};
