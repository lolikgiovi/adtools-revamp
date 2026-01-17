/**
 * Excel Comparator - Orchestrates comparison between sets of Excel/CSV files
 */

import * as FileParser from "./file-parser.js";
import { compareDatasets } from "./diff-engine.js";
import { convertToViewFormat } from "./diff-adapter.js";

export class ExcelComparator {
  /**
   * Compare multiple matched pairs of files
   * @param {Array} pairs - Array of { reference: File, comparator: File, settings: { mode, pkColumns } }
   * @param {Object} options - Global comparison options (e.g., normalize)
   * @returns {Object} Consolidated results
   */
  static async compareFileSets(pairs, options = {}) {
    const { normalize = true, onProgress = null } = options;

    const consolidatedResults = {
      env1_name: "Reference",
      env2_name: "Comparator",
      table: "Excel Comparison",
      summary: {
        total: 0,
        matches: 0,
        differs: 0,
        only_in_env1: 0,
        only_in_env2: 0,
      },
      rows: [],
    };

    const totalFiles = pairs.length;

    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      if (onProgress) {
        onProgress({
          phase: "parsing",
          fileIndex: i,
          totalFiles,
          fileName: pair.reference.name,
          percent: Math.round((i / totalFiles) * 100),
        });
      }

      try {
        // Parse files
        const refData = await FileParser.parseFile(pair.reference);
        const compData = await FileParser.parseFile(pair.comparator);

        // Identify common fields
        const fields = Array.from(new Set([...refData.headers, ...compData.headers]));

        // Get per-pair settings or fall back to defaults
        const pairMode = pair.settings?.mode || "key";
        const pairPkString = pair.settings?.pkColumns || "";
        const pairPkColumns = pairPkString
          ? pairPkString
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : [fields[0]]; // Default to first column if empty

        // Run comparison
        const jsResult = compareDatasets(refData.rows, compData.rows, {
          keyColumns: pairPkColumns,
          fields,
          normalize,
          matchMode: pairMode,
          onProgress: (p) => {
            if (onProgress) {
              onProgress({
                ...p,
                phase: `Comparing ${pair.reference.name}`,
                fileIndex: i,
                totalFiles,
              });
            }
          },
        });

        // Convert to view format
        const viewResult = convertToViewFormat(jsResult, {
          env1Name: "Reference",
          env2Name: "Comparator",
          tableName: pair.reference.name,
          keyColumns: pairPkColumns,
        });

        // Add file source info to rows (required for result selection UI)
        viewResult.rows.forEach((row) => {
          row._sourceFile = pair.reference.name;
        });

        // Merge into consolidated results
        consolidatedResults.summary.total += viewResult.summary.total;
        consolidatedResults.summary.matches += viewResult.summary.matches;
        consolidatedResults.summary.differs += viewResult.summary.differs;
        consolidatedResults.summary.only_in_env1 += viewResult.summary.only_in_env1;
        consolidatedResults.summary.only_in_env2 += viewResult.summary.only_in_env2;

        consolidatedResults.rows.push(...viewResult.rows);
      } catch (error) {
        console.error(`Failed to compare ${pair.reference.name}:`, error);
        // Continue with other files
      }
    }

    // Sort consolidated results: prefers differs first across all files
    consolidatedResults.rows.sort((a, b) => {
      const order = { differ: 0, only_in_env1: 1, only_in_env2: 2, match: 3 };
      if (order[a.status] !== order[b.status]) {
        return order[a.status] - order[b.status];
      }
      // Within same status, sort by filename then original order
      if (a._sourceFile !== b._sourceFile) {
        return (a._sourceFile || "").localeCompare(b._sourceFile || "");
      }
      return 0; // Keep relative order
    });

    return consolidatedResults;
  }
}

export default ExcelComparator;
