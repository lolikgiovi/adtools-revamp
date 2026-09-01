import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../../core/Runtime.js";

export const DEFAULT_JIRA_URL = "https://jira.corp.devmandiri.co.id";
export const DEFAULT_PROJECT_KEY = "EVDEV";
export const ALLOW_INVALID_TLS_KEY = "config.jira.allowInvalidTls";
export const GLOBAL_DEFAULTS_KEY = "ticket-template-create.global-defaults";
export const TARGET_ISSUE_TYPES = ["BE-Sub-Task", "FE-Sub-Task"];
export const STREAMS = {
  ios: { label: "iOS", prefix: "[iOS]", mandatoryLabel: "fe_ios" },
  android: { label: "Android", prefix: "[Android]", mandatoryLabel: "fe_android" },
  web: { label: "Web", prefix: "[Web]", mandatoryLabel: "fe_web" },
  be: { label: "Backend", prefix: "[API]", mandatoryLabel: "be_api" },
};
export const BE_COMPONENTS = {
  API: "be_api",
  Table: "be_table",
  Service: "be_service",
  Consumer: "be_consumer",
  Batch: "be_batch",
};

const PEOPLE_STREAMS = ["ios", "android", "web", "be"];

export function createDefaultGlobalDefaults() {
  return {
    version: 2,
    labels: {
      common: ["ad_dev_task"],
      ios: ["fe_ios"],
      android: ["fe_android"],
      web: ["fe_web"],
      be: Object.fromEntries(Object.entries(BE_COMPONENTS).map(([component, label]) => [component, [label]])),
    },
    people: {
      common: { saAdLead: "", saAdSubLeads: [] },
      streams: Object.fromEntries(
        ["ios", "android", "web", "be"].map((stream) => [stream, { developer: "", developerLead: "", developerSubLeads: [] }]),
      ),
    },
    shared: {
      priorityId: "4",
      adStoryPointId: "",
      devStoryPointId: "",
      squadId: "",
      releaseId: "",
      taskTriggerId: "",
    },
    dateRule: { startOffsetDays: 0, deadlineOffsetDays: 3 },
  };
}

export function mergeGlobalDefaults(value) {
  const defaults = createDefaultGlobalDefaults();
  if (!value || typeof value !== "object") return defaults;
  const merged = {
    ...defaults,
    ...value,
    labels: { ...defaults.labels, ...value.labels, be: { ...defaults.labels.be, ...value.labels?.be } },
    people: {
      ...defaults.people,
      ...value.people,
      common: { ...defaults.people.common, ...value.people?.common },
      streams: { ...defaults.people.streams },
    },
    shared: { ...defaults.shared, ...value.shared },
    dateRule: { ...defaults.dateRule, ...value.dateRule },
  };
  PEOPLE_STREAMS.forEach((stream) => {
    merged.people.streams[stream] = { ...defaults.people.streams[stream], ...(value.people?.streams?.[stream] || {}) };
  });
  return merged;
}

export function resolveFeatureConfiguration(globalDefaults, feature = {}) {
  const global = mergeGlobalDefaults(globalDefaults);
  const overrides = feature.overrides || {
    shared: feature.shared || {},
    people: { common: {}, streams: feature.people || {} },
    dateRule: feature.dateRule || {},
  };
  const people = {
    common: { ...global.people.common, ...(overrides.people?.common || {}) },
    streams: {},
  };
  PEOPLE_STREAMS.forEach((stream) => {
    people.streams[stream] = {
      ...global.people.streams[stream],
      ...(overrides.people?.streams?.[stream] || overrides.people?.[stream] || {}),
    };
  });
  return {
    featureLabels: normalizeLabels(feature.featureLabels || feature.shared?.extraLabels || []),
    shared: { ...global.shared, ...(overrides.shared || {}) },
    people,
    dateRule: { ...global.dateRule, ...(overrides.dateRule || {}) },
  };
}

export function normalizeLabels(value) {
  return splitValues(value);
}

export function labelsForStream(globalDefaults, stream, beComponent = "API", featureLabels = []) {
  const labels = [
    ...(globalDefaults?.labels?.common || []),
    ...(stream === "be" ? globalDefaults?.labels?.be?.[beComponent] || [] : globalDefaults?.labels?.[stream] || []),
    ...normalizeLabels(featureLabels),
  ];
  return [...new Set(labels.map((label) => String(label).trim()).filter(Boolean))];
}
export function normalizeBaseUrl(value) {
  const url = new URL(String(value || "").trim());
  if (url.protocol !== "https:") throw new Error("Jira URL must use HTTPS.");
  if (url.search || url.hash) throw new Error("Jira URL cannot contain a query string or fragment.");
  return url.toString().replace(/\/+$/, "");
}

export function normalizeProjectKey(value) {
  const key = String(value || "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z][A-Z0-9_-]*$/.test(key)) throw new Error("Enter a valid Jira project key.");
  return key;
}

export function normalizeIssueKey(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/(?:^|\/browse\/)([A-Za-z][A-Za-z0-9_]*-\d+)(?:[/?#].*)?$/i);
  if (!match) throw new Error(`Invalid Jira issue key: ${raw || "empty value"}`);
  return match[1].toUpperCase();
}

export function formatFieldValue(value) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(formatFieldValue).join(", ");
  if (typeof value === "object") {
    return value.value || value.name || value.displayName || value.key || value.id || JSON.stringify(value);
  }
  return String(value);
}

export function createDiscoveryRequest({ baseUrl, projectKey, allowInvalidTls = false, sampleIssues = [] }) {
  return {
    baseUrl: normalizeBaseUrl(baseUrl),
    projectKey: normalizeProjectKey(projectKey),
    sampleIssueKeys: sampleIssues.map((sample) => normalizeIssueKey(sample.key)),
    issueTypeNames: TARGET_ISSUE_TYPES,
    allowInvalidTls: Boolean(allowInvalidTls),
  };
}

export function addDaysIso(isoDate, days) {
  const date = new Date(`${isoDate || todayIso()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function todayIso() {
  return new Date().toLocaleDateString("en-CA");
}

export function splitValues(value) {
  return [
    ...new Set(
      String(value || "")
        .split(/[,\n]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

export function mandatoryLabels(stream, beComponent = "API") {
  const defaults = createDefaultGlobalDefaults();
  if (!defaults.labels[stream] && stream !== "be") throw new Error(`Unknown ticket stream: ${stream}`);
  return labelsForStream(defaults, stream, beComponent);
}

export function buildSummary(stream, summaryBody, beComponent = "API") {
  const body = String(summaryBody || "").trim();
  if (!body) throw new Error(`${STREAMS[stream]?.label || stream} summary is required.`);
  const prefix = stream === "be" ? `[${beComponent}]` : STREAMS[stream]?.prefix;
  if (!prefix) throw new Error(`Unknown ticket stream: ${stream}`);
  return `${prefix} ${body}`;
}

function validateStreams(streams) {
  const selected = [...new Set(streams || [])];
  if (!selected.length) throw new Error("Select at least one ticket to create.");
  if (selected.some((stream) => !PEOPLE_STREAMS.includes(stream))) throw new Error("Unknown ticket stream.");
  if (selected.includes("be") && selected.length > 1) throw new Error("Choose either FE or BE mode, not both.");
  if (selected.includes("web") && selected.length > 1) throw new Error("Web is a standalone FE mode. Deselect iOS and Android.");
  return selected;
}

function required(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function summaryBodyFor(stream, summaries = {}) {
  return stream === "ios" || stream === "android" ? summaries.mobile : summaries[stream];
}

export function buildTicketPreview({ streams, component = "API", summaries, globalDefaults, featureLabels, parentKey }) {
  return validateStreams(streams).map((stream) => {
    const body = String(summaryBodyFor(stream, summaries) || "").trim();
    return {
      stream,
      summary: body ? buildSummary(stream, body, component) : "Summary required",
      parentKey: String(parentKey || "").trim(),
      labels: labelsForStream(globalDefaults, stream, component, featureLabels),
    };
  });
}

export function buildTicketBundle({
  streams,
  component = "API",
  summaries,
  issueTypeIds,
  globalDefaults,
  featureLabels,
  shared = {},
  people = {},
}) {
  const selected = validateStreams(streams);
  const common = people.common || {};
  const normalizedShared = {
    priorityId: shared.priorityId || null,
    adStoryPointId: required(shared.adStoryPointId, "AD Story Point"),
    devStoryPointId: shared.devStoryPointId || null,
    squadId: required(shared.squadId, "Squad"),
    releaseId: required(shared.releaseId, "Release Number"),
    startDate: required(shared.startDate, "Start Development On"),
    deadline: required(shared.deadline, "Deadline"),
    saAdLead: required(common.saAdLead, "SA/AD Lead"),
    saAdSubLeads: splitValues(required(common.saAdSubLeads, "SA/AD Sub-Lead")),
    taskTriggerId: required(shared.taskTriggerId, "Task Trigger By"),
    description: String(shared.description || "").trim(),
    confluencePage: String(shared.confluencePage || "").trim(),
  };

  return selected.map((stream) => {
    const streamPeople = people.streams?.[stream] || {};
    const labels = labelsForStream(globalDefaults, stream, component, featureLabels);
    if (!labels.length) throw new Error("At least one label is required.");
    return {
      issueTypeId: required(issueTypeIds?.[stream], `${STREAMS[stream].label} issue type`),
      stream,
      summary: buildSummary(stream, summaryBodyFor(stream, summaries), component),
      labels,
      ...normalizedShared,
      developer: required(streamPeople.developer, `${stream} Developer`),
      developerLead: required(streamPeople.developerLead, `${stream} Developer Lead`),
      developerSubLeads: splitValues(required(streamPeople.developerSubLeads, `${stream} Developer Sub-Lead`)),
    };
  });
}

export class JiraDiscoveryService {
  loadConnection() {
    return {
      baseUrl: localStorage.getItem("config.jira.url") || DEFAULT_JIRA_URL,
      projectKey: localStorage.getItem("config.jira.projectKey") || DEFAULT_PROJECT_KEY,
      allowInvalidTls: localStorage.getItem(ALLOW_INVALID_TLS_KEY) === "true",
    };
  }

  saveConnection(baseUrl, projectKey, allowInvalidTls = false) {
    const normalized = {
      baseUrl: normalizeBaseUrl(baseUrl),
      projectKey: normalizeProjectKey(projectKey),
      allowInvalidTls: Boolean(allowInvalidTls),
    };
    localStorage.setItem("config.jira.url", normalized.baseUrl);
    localStorage.setItem("config.jira.projectKey", normalized.projectKey);
    localStorage.setItem(ALLOW_INVALID_TLS_KEY, String(normalized.allowInvalidTls));
    return normalized;
  }

  async hasPat() {
    if (!isTauri()) return false;
    return invoke("has_jira_pat");
  }

  async discover(options) {
    if (!isTauri()) throw new Error("Jira discovery is available only in the desktop app.");
    const request = createDiscoveryRequest(options);
    return invoke("jira_discover", request);
  }

  async resolveParent({ baseUrl, projectKey, issueKey, allowInvalidTls }) {
    return this.resolveParents({ baseUrl, projectKey, issueKeys: [issueKey], allowInvalidTls });
  }

  async resolveParents({ baseUrl, projectKey, issueKeys, allowInvalidTls }) {
    if (!isTauri()) throw new Error("Jira parent lookup is available only in the desktop app.");
    return invoke("jira_resolve_parents", {
      baseUrl: normalizeBaseUrl(baseUrl),
      projectKey: normalizeProjectKey(projectKey),
      issueKeys: [...new Set(issueKeys.map(normalizeIssueKey))],
      allowInvalidTls: Boolean(allowInvalidTls),
    });
  }

  async searchUsers({ baseUrl, projectKey, query, allowInvalidTls }) {
    if (!isTauri()) throw new Error("Jira user lookup is available only in the desktop app.");
    return invoke("jira_search_users", {
      baseUrl: normalizeBaseUrl(baseUrl),
      projectKey: normalizeProjectKey(projectKey),
      query: String(query || "").trim(),
      allowInvalidTls: Boolean(allowInvalidTls),
    });
  }

  async searchLabels({ baseUrl, projectKey, query, allowInvalidTls }) {
    if (!isTauri()) throw new Error("Jira label lookup is available only in the desktop app.");
    return invoke("jira_search_labels", {
      baseUrl: normalizeBaseUrl(baseUrl),
      projectKey: normalizeProjectKey(projectKey),
      query: String(query || "").trim(),
      allowInvalidTls: Boolean(allowInvalidTls),
    });
  }

  async createSubtasks({ baseUrl, projectKey, parentKey, tickets, allowInvalidTls }) {
    if (!isTauri()) throw new Error("Jira ticket creation is available only in the desktop app.");
    return invoke("jira_create_subtasks", {
      baseUrl: normalizeBaseUrl(baseUrl),
      projectKey: normalizeProjectKey(projectKey),
      parentKey: normalizeIssueKey(parentKey),
      tickets,
      allowInvalidTls: Boolean(allowInvalidTls),
    });
  }
}
