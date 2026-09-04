/**
 * Current tool guide content for the About page.
 *
 * Tool names, ordering, availability, and descriptions come from the live
 * tool registry. This module owns the concise usage steps shown beside them.
 */
export const toolGuides = {
  "uuid-generator": {
    summary: "Generate one or many UUID v4 values without extra formatting.",
    howToUse: ["Choose a quantity and output format.", "Generate the UUIDs.", "Copy the result or regenerate a fresh set."],
    notes: "Useful for test data, identifiers, and fixtures.",
  },
  "json-tools": {
    summary: "Validate, format, minify, escape, and inspect JSON structures.",
    howToUse: [
      "Paste or type JSON in the editor.",
      "Choose an operation such as Beautify, Minify, or Extract Keys.",
      "Review the output and copy it when ready.",
    ],
    notes: "The To Table view is useful for quickly scanning nested data.",
  },
  "base64-tools": {
    summary: "Encode and decode Base64 text or files.",
    howToUse: ["Open the Encode or Decode tab.", "Enter text or select a file.", "Run the operation, then copy or save the result."],
    notes: "Use the file mode when the payload is not practical to paste into the editor.",
  },
  "tlv-viewer": {
    summary: "Parse QRIS and BER-TLV payloads into readable tree and table views.",
    howToUse: [
      "Paste a TLV payload into the input.",
      "Choose the parser mode if prompted.",
      "Parse the payload and inspect tags, lengths, and values.",
    ],
    notes: "Useful for checking payment payloads and nested tag structure.",
  },
  "qr-tools": {
    summary: "Generate a static QR code from text or a URL.",
    howToUse: ["Enter the text or URL to encode.", "Generate the QR code.", "Download the image or copy the encoded value."],
    notes: "No account or external generator is needed.",
  },
  "quick-query": {
    summary: "Generate Oracle MERGE, INSERT, or UPDATE SQL from schema-backed spreadsheet data.",
    howToUse: [
      "Choose a query type and select or create a schema.",
      "Enter data in the grid or attach a spreadsheet.",
      "Generate the SQL, review it in the editor, then copy or save it.",
    ],
    notes: "Import default schemas from Settings when starting with a new environment.",
  },
  querify: {
    summary: "Generate SQL in bulk from Excel files using Quick Query schemas.",
    howToUse: [
      "Add one or more XLSX, XLS, or CSV files.",
      "Check the detected schema and table matches.",
      "Generate the batch output and download or copy the SQL.",
    ],
    notes: "Keep file names and saved Quick Query schema names aligned for reliable matching.",
  },
  "compare-config": {
    summary: "Compare Oracle environments or Excel/CSV files and inspect row-level differences.",
    howToUse: [
      "Choose Oracle, Excel, or a mixed comparison.",
      "Configure both sources and select the matching key fields.",
      "Run the comparison, filter the results, and export JSON, Excel, or CSV.",
    ],
    notes: "Oracle comparisons require the Desktop App; file comparisons run in the Web App too.",
  },
  "run-query": {
    summary: "Run Oracle SQL through a Jenkins job and stream the build logs.",
    howToUse: [
      "Configure the Jenkins URL, username, and API token in Settings.",
      "Write the SQL and choose the target environment.",
      "Run the job, follow the live logs, and use History or Templates for repeat work.",
    ],
    notes: "Desktop-only. The API token is stored in macOS Keychain.",
  },
  "run-batch": {
    summary: "Trigger Jenkins batch jobs with configurable parameters and live logs.",
    howToUse: [
      "Choose an environment, batch, and job.",
      "Run the job and follow its console output.",
      "Save a configuration for repeat runs and review History for past executions.",
    ],
    notes: "Desktop-only. Jenkins access and a configured job are required.",
  },
  "html-template": {
    summary: "Edit and preview HTML templates with formatting, minification, and VTL support.",
    howToUse: [
      "Paste or write HTML in the editor.",
      "Format, minify, or extract VTL fields as needed.",
      "Use the live preview and environment selector to check the result.",
    ],
    notes: "Preview runs locally in a sandboxed iframe.",
  },
  "splunk-template": {
    summary: "Edit Splunk templates with formatting, minification, syntax highlighting, and field review.",
    howToUse: [
      "Paste or write the Splunk template.",
      "Format or minify the content.",
      "Use Fields Review to inspect detected variables before copying the result.",
    ],
    notes: "Keep the field review open when checking a template before handoff.",
  },
  "sql-in-clause": {
    summary: "Convert newline-separated values into SQL IN clauses and ready-to-run SELECT statements.",
    howToUse: [
      "Paste one value per line.",
      "Choose quoting and output options, or enable SELECT mode.",
      "Generate the clause and copy it into your query.",
    ],
    notes: "The tool handles duplicate and blank-line cleanup for faster preparation.",
  },
  "merge-sql": {
    summary: "Merge multiple SQL files into combined DML, SELECT, and validation outputs with duplicate detection.",
    howToUse: [
      "Upload SQL files or a folder, or paste SQL into text mode.",
      "Process the input and review tables, duplicates, and dangerous statements.",
      "Edit if needed, then download the merged, SELECT, or validation SQL.",
    ],
    notes: "Work is persisted locally in IndexedDB so a refresh does not discard the current state.",
  },
  "check-image": {
    summary: "Verify image UUIDs or content paths across configured CDN environments.",
    howToUse: [
      "Add environment base URLs in Settings.",
      "Enter one image UUID or content path per line.",
      "Run the check and review the status for each identifier.",
    ],
    notes: "Batch checks are useful for finding missing or inaccessible campaign assets.",
  },
  "master-lockey": {
    summary: "View, search, and inspect localization keys from configured language-pack domains.",
    howToUse: [
      "Configure language-pack URLs in Settings.",
      "Load a domain and language pack.",
      "Search or filter the full identifier, then inspect the matching values.",
    ],
    notes: "Desktop-only. Confluence links can be opened when the integration is configured.",
  },
};

function buildGuideContent(title, guide) {
  return `# ${title}\n\n${guide.summary}\n\n## How to use\n${guide.howToUse.map((step, index) => `${index + 1}. ${step}`).join("\n")}\n\n## Notes\n${guide.notes}`;
}

const toolGuideItems = Object.entries(toolGuides).map(([id, guide]) => ({
  id,
  title: id,
  content: buildGuideContent(id, guide),
}));

/**
 * Kept as a small compatibility layer for the existing page helpers.
 * The About page now renders the guide catalog directly rather than nesting
 * a second navigation shell inside the app.
 */
export const tutorialContent = {
  categories: [
    {
      id: "tools",
      name: "Tool guides",
      items: toolGuideItems,
    },
  ],
};

export function getSearchableItems() {
  return tutorialContent.categories.flatMap((category) =>
    category.items.map((item) => ({
      categoryId: category.id,
      categoryName: category.name,
      ...item,
    })),
  );
}

export function findContentById(itemId) {
  for (const category of tutorialContent.categories) {
    const item = category.items.find((candidate) => candidate.id === itemId);
    if (item) return { category, item };
  }
  return null;
}
