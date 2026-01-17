/**
 * Excel Comparator - Orchestrates comparison between sets of Excel/CSV files
 */

import * as FileParser from "./file-parser.js";
import { compareDatasets } from "./diff-engine.js";
import { convertToViewFormat } from "./diff-adapter.js";

export class ExcelComparator {
  /**
   * Compare multiple matched pairs of files
   * @param {Array} matches - Array of { reference: File, comparator: File }
   * @param {Object} options - Comparison options
   * @returns {Object} Consolidated results
   */
  static async compareFileSets(matches, options = {}) {
    const { rowMatching = "key", pkColumns = "", normalize = true, onProgress = null } = options;

    const keyColumns = pkColumns
      ? pkColumns
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

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

    const totalFiles = matches.length;

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      if (onProgress) {
        onProgress({
          phase: "parsing",
          fileIndex: i,
          totalFiles,
          fileName: match.reference.name,
          percent: Math.round((i / totalFiles) * 100),
        });
      }

      try {
        // Parse files
        const refData = await FileParser.parseFile(match.reference);
        const compData = await FileParser.parseFile(match.comparator);

        // Identify common fields (or use all fields if needed)
        const fields = Array.from(new Set([...refData.headers, ...compData.headers]));

        // Calculate actual PK columns if none provided
        const actualPk = keyColumns.length > 0 ? keyColumns : [fields[0]];

        // Run comparison
        const jsResult = compareDatasets(refData.rows, compData.rows, {
          keyColumns: actualPk,
          fields,
          normalize,
          matchMode: rowMatching,
          onProgress: (p) => {
            if (onProgress) {
              onProgress({
                ...p,
                phase: `Comparing ${match.reference.name}`,
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
          tableName: match.reference.name,
          keyColumns: actualPk,
        });

        // Add file source info to rows if multi-file
        if (totalFiles > 1) {
          viewResult.rows.forEach((row) => {
            row._sourceFile = match.reference.name;
          });
        }

        // Merge into consolidated results
        consolidatedResults.summary.total += viewResult.summary.total;
        consolidatedResults.summary.matches += viewResult.summary.matches;
        consolidatedResults.summary.differs += viewResult.summary.differs;
        consolidatedResults.summary.only_in_env1 += viewResult.summary.only_in_env1;
        consolidatedResults.summary.only_in_env2 += viewResult.summary.only_in_env2;

        consolidatedResults.rows.push(...viewResult.rows);
      } catch (error) {
        console.error(`Failed to compare ${match.reference.name}:`, error);
        // Continue with other files
      }
    }

    // Sort consolidated results: prefers differs first across all files
    consolidatedResults.rows.sort((a, b) => {
      const order = { differ: 0, only_in_env1: 1, only_in_env2: 2, match: 3 };
      return order[a.status] - order[b.status];
    });

    return consolidatedResults;
  }
}

export default ExcelComparator;
