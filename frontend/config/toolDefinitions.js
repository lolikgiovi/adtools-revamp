const TOOL_MODULES = {
  "uuid-generator": {
    description: "Generate UUID v4 strings for unique identifiers",
    load: () => import("../tools/uuid-generator/main.js").then((module) => ({ ToolClass: module.UUIDGenerator })),
  },
  "json-tools": {
    description: "JSON Tools for validation, formatting, and manipulation",
    load: () => import("../tools/json-tools/main.js").then((module) => ({ ToolClass: module.JSONTools })),
  },
  "base64-tools": {
    description: "Encode and decode Base64 with text and file support",
    load: () => import("../tools/base64-tools/main.js").then((module) => ({ ToolClass: module.Base64Tools })),
  },
  "char-counter": {
    description: "Count characters, words, lines, and UTF-8 bytes as you type",
    load: () => import("../tools/char-counter/main.js").then((module) => ({ ToolClass: module.CharCounter })),
  },
  "tlv-viewer": {
    description: "Parse QRIS & BER-TLV payloads with tree and table views",
    load: () => import("../tools/tlv-viewer/main.js").then((module) => ({ ToolClass: module.TLVViewer })),
  },
  "qr-tools": {
    description: "Generate static QR codes from text or URLs",
    load: () => import("../tools/qr-tools/main.js").then((module) => ({ ToolClass: module.QRTools })),
  },
  "quick-query": {
    description: "Generate Oracle SQL from schema/data with attachments and previews",
    load: () => import("../tools/quick-query/main.js").then((module) => ({ ToolClass: module.QuickQuery })),
  },
  querify: {
    description: "Generate SQL in bulk from Excel files using Quick Query schemas",
    load: () => import("../tools/querify/main.js").then((module) => ({ ToolClass: module.QuerifyTool })),
  },
  "compare-config": {
    description: "Compare Oracle database configs between environments",
    load: () => import("../tools/compare-config/main.js").then((module) => ({ ToolClass: module.CompareConfigTool })),
  },
  "run-query": {
    description: "Run Oracle SQL Query via Jenkins job and stream the build logs",
    load: () => import("../tools/run-query/main.js").then((module) => ({ ToolClass: module.JenkinsRunner })),
  },
  "run-batch": {
    description: "Trigger Jenkins batch jobs with configurable parameters",
    load: () => import("../tools/run-batch/main.js").then((module) => ({ ToolClass: module.RunBatch })),
  },
  "html-template": {
    description: "Edit and preview HTML templates with live rendering",
    load: () => import("../tools/html-editor/main.js").then((module) => ({ ToolClass: module.HTMLTemplateTool })),
  },
  "splunk-template": {
    description: "Edit Splunk templates with formatting, minify, syntax highlighting, and field review",
    load: () => import("../tools/splunk-template/main.js").then((module) => ({ ToolClass: module.SplunkVTLEditor })),
  },
  "sql-in-clause": {
    description: "Convert newline lists into SQL IN clause formats",
    load: () => import("../tools/sql-in-clause/main.js").then((module) => ({ ToolClass: module.SQLInClauseTool })),
  },
  "check-image": {
    description: "Verify image IDs across CDN environments",
    load: () => import("../tools/image-checker/main.js").then((module) => ({ ToolClass: module.CheckImageTool })),
  },
  "master-lockey": {
    description: "View and search localization keys from configured domains",
    load: () => import("../tools/master-lockey/main.js").then((module) => ({ ToolClass: module.MasterLockey })),
  },
  "merge-sql": {
    description: "Merge multiple SQL files into combined MERGE/INSERT/UPDATE and SELECT files",
    load: () => import("../tools/merge-sql/main.js").then((module) => ({ ToolClass: module.MergeSqlTool })),
  },
};

export function buildToolDefinitions(configTools = []) {
  const definitions = new Map();

  configTools.forEach((cfg) => {
    if (!cfg?.id) return;
    const entry = TOOL_MODULES[cfg.id];
    if (!entry) {
      console.warn(`Missing tool module mapping for: ${cfg.id}`);
      return;
    }

    definitions.set(cfg.id, {
      id: String(cfg.id),
      name: String(cfg.name || cfg.id),
      description: String(entry.description || ""),
      category: String(cfg.category || "general"),
      icon: String(cfg.icon || "tool"),
      showInSidebar: cfg.showInSidebar !== false,
      showOnHome: cfg.showOnHome !== false,
      enabled: cfg.enabled !== false,
      requiresTauri: Boolean(cfg.requiresTauri),
      order: Number(cfg.order) || 0,
      load: entry.load,
    });
  });

  return definitions;
}

export function getToolDefinition(definitions, toolId) {
  return definitions instanceof Map ? definitions.get(toolId) || null : null;
}

export function getToolDefinitionsList(definitions) {
  return definitions instanceof Map ? Array.from(definitions.values()) : [];
}
