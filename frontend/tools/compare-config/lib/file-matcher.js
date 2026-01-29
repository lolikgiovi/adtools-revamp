/**
 * FileMatcher - Match files between reference and comparator sets
 * Supports filename-based and folder-relative-path matching
 *
 * Enhanced with base name matching for common naming patterns:
 * - Exact match: CONFIG.APP_CONFIG == CONFIG.APP_CONFIG
 * - Suffix match: CONFIG.APP_CONFIG == CONFIG.APP_CONFIG (AFTER)
 * - Prefix match: CONFIG.APP_CONFIG (BEFORE) == CONFIG.APP_CONFIG (AFTER)
 * - Prefix match: CONFIG.APP_CONFIG (BEFORE) == CONFIG.APP_CONFIG
 */

/**
 * Common suffixes to strip when matching base names
 * Matches patterns like (BEFORE), (AFTER), (OLD), (NEW), (PROD), (DEV), (1), (2), etc.
 */
const SUFFIX_PATTERN = /\s*\((?:BEFORE|AFTER|OLD|NEW|PROD|DEV|UAT|SIT|QA|STAGING|TEST|LIVE|BACKUP|\d+)\)\s*$/i;

/**
 * Extract base filename without common suffixes and extension
 * @param {string} filename - e.g., "CONFIG.APP_CONFIG (BEFORE).xlsx"
 * @returns {string} - e.g., "config.app_config"
 */
export function extractBaseName(filename) {
  // Remove extension
  const withoutExt = filename.replace(/\.(xlsx|xls|csv)$/i, '');

  // Remove common suffixes
  const withoutSuffix = withoutExt.replace(SUFFIX_PATTERN, '').trim();

  return withoutSuffix.toLowerCase();
}

/**
 * Check if two filenames match (exact or base name)
 * @param {string} name1 - First filename
 * @param {string} name2 - Second filename
 * @returns {{ match: boolean, type: 'exact' | 'base' | null }}
 */
export function filenamesMatch(name1, name2) {
  const n1 = name1.toLowerCase();
  const n2 = name2.toLowerCase();

  // Exact match (with extension)
  if (n1 === n2) {
    return { match: true, type: 'exact' };
  }

  // Exact match without extension
  const base1NoExt = n1.replace(/\.(xlsx|xls|csv)$/i, '');
  const base2NoExt = n2.replace(/\.(xlsx|xls|csv)$/i, '');
  if (base1NoExt === base2NoExt) {
    return { match: true, type: 'exact' };
  }

  // Base name match (removing suffixes like BEFORE/AFTER)
  const base1 = extractBaseName(n1);
  const base2 = extractBaseName(n2);
  if (base1 === base2 && base1.length > 0) {
    return { match: true, type: 'base' };
  }

  return { match: false, type: null };
}

/**
 * Find matching comparator file for a reference file
 * @param {string} refFileName - Reference filename
 * @param {{ id: string, file: File }[]} comparatorFiles - Array of comparator files with IDs
 * @returns {{ id: string, file: File, matchType: 'exact' | 'base' } | null}
 */
export function findMatchingFile(refFileName, comparatorFiles) {
  // First pass: look for exact matches
  for (const compFile of comparatorFiles) {
    const result = filenamesMatch(refFileName, compFile.file.name);
    if (result.match && result.type === 'exact') {
      return { ...compFile, matchType: 'exact' };
    }
  }

  // Second pass: look for base name matches
  for (const compFile of comparatorFiles) {
    const result = filenamesMatch(refFileName, compFile.file.name);
    if (result.match && result.type === 'base') {
      return { ...compFile, matchType: 'base' };
    }
  }

  return null;
}

/**
 * Auto-match files by filename (case-insensitive)
 * Uses enhanced matching with base name support
 * @param {File[]} referenceFiles - Files from reference source
 * @param {File[]} comparatorFiles - Files from comparator source
 * @returns {MatchResult}
 */
export function autoMatch(referenceFiles, comparatorFiles) {
  const matches = [];
  const unmatchedRef = [];
  const matchedCompIndices = new Set();

  // Build case-insensitive lookup for comparator files
  const compLookup = new Map();
  comparatorFiles.forEach((file, index) => {
    const key = file.name.toLowerCase();
    if (!compLookup.has(key)) {
      compLookup.set(key, []);
    }
    compLookup.get(key).push({ file, index });
  });

  // Match reference files
  for (const refFile of referenceFiles) {
    const key = refFile.name.toLowerCase();
    const candidates = compLookup.get(key);

    if (candidates && candidates.length > 0) {
      // Take first unmatched candidate
      const candidate = candidates.find((c) => !matchedCompIndices.has(c.index));
      if (candidate) {
        matches.push({
          reference: refFile,
          comparator: candidate.file,
        });
        matchedCompIndices.add(candidate.index);
      } else {
        unmatchedRef.push(refFile);
      }
    } else {
      unmatchedRef.push(refFile);
    }
  }

  // Collect unmatched comparator files
  const unmatchedComp = comparatorFiles.filter((_, index) => !matchedCompIndices.has(index));

  return { matches, unmatchedRef, unmatchedComp };
}

/**
 * Auto-match files from folders by relative path (case-insensitive)
 * Uses webkitRelativePath to match files by their path within folders
 * @param {File[]} referenceFiles - Files from reference folder
 * @param {File[]} comparatorFiles - Files from comparator folder
 * @param {string} refBaseDir - Base directory name for reference
 * @param {string} compBaseDir - Base directory name for comparator
 * @returns {MatchResult}
 */
export function autoMatchFolders(referenceFiles, comparatorFiles, refBaseDir, compBaseDir) {
  const matches = [];
  const unmatchedRef = [];
  const matchedCompIndices = new Set();

  // Build lookup by relative path
  const compLookup = new Map();
  comparatorFiles.forEach((file, index) => {
    const relativePath = getRelativePath(file, compBaseDir);
    const key = relativePath.toLowerCase();
    if (!compLookup.has(key)) {
      compLookup.set(key, []);
    }
    compLookup.get(key).push({ file, index, relativePath });
  });

  // Match reference files
  for (const refFile of referenceFiles) {
    const refRelativePath = getRelativePath(refFile, refBaseDir);
    const key = refRelativePath.toLowerCase();
    const candidates = compLookup.get(key);

    if (candidates && candidates.length > 0) {
      const candidate = candidates.find((c) => !matchedCompIndices.has(c.index));
      if (candidate) {
        matches.push({
          reference: refFile,
          comparator: candidate.file,
          relativePath: refRelativePath,
        });
        matchedCompIndices.add(candidate.index);
      } else {
        unmatchedRef.push(refFile);
      }
    } else {
      unmatchedRef.push(refFile);
    }
  }

  // Collect unmatched comparator files
  const unmatchedComp = comparatorFiles.filter((_, index) => !matchedCompIndices.has(index));

  return { matches, unmatchedRef, unmatchedComp };
}

/**
 * Get the relative path of a file within its folder
 * @param {File} file - File with webkitRelativePath
 * @param {string} baseDir - Base directory name to strip
 * @returns {string}
 */
export function getRelativePath(file, baseDir) {
  const fullPath = file.webkitRelativePath || file.name;

  // If fullPath starts with baseDir, strip it
  if (fullPath.startsWith(baseDir + "/")) {
    return fullPath.substring(baseDir.length + 1);
  }

  // Otherwise return the full path (or just filename if no path)
  return fullPath;
}

/**
 * Extract base directory name from folder selection
 * @param {File[]} files - Files from folder selection
 * @returns {string|null}
 */
export function extractBaseDir(files) {
  if (files.length === 0) return null;

  const firstPath = files[0].webkitRelativePath;
  if (!firstPath) return null;

  // Base dir is the first path segment
  const slashIndex = firstPath.indexOf("/");
  return slashIndex > 0 ? firstPath.substring(0, slashIndex) : firstPath;
}

/**
 * Create a match manually
 * @param {File} reference - Reference file
 * @param {File} comparator - Comparator file
 * @returns {FileMatch}
 */
export function createManualMatch(reference, comparator) {
  return {
    reference,
    comparator,
    isManual: true,
  };
}

/**
 * Get match statistics
 * @param {MatchResult} result
 * @returns {MatchStats}
 */
export function getMatchStats(result) {
  return {
    matched: result.matches.length,
    unmatchedRef: result.unmatchedRef.length,
    unmatchedComp: result.unmatchedComp.length,
    total: result.matches.length + result.unmatchedRef.length + result.unmatchedComp.length,
  };
}

/**
 * Check if two filenames are similar (for suggestion purposes)
 * Uses simple Levenshtein-like similarity
 * @param {string} name1
 * @param {string} name2
 * @param {number} threshold - Similarity threshold (0-1)
 * @returns {boolean}
 */
export function areFileNamesSimilar(name1, name2, threshold = 0.4) {
  const n1 = name1.toLowerCase();
  const n2 = name2.toLowerCase();

  if (n1 === n2) return true;

  // Simple similarity: longest common substring / max length
  const maxLen = Math.max(n1.length, n2.length);
  if (maxLen === 0) return true;

  const lcsLength = longestCommonSubstring(n1, n2);
  return lcsLength / maxLen >= threshold;
}

/**
 * Find longest common substring length
 * @param {string} s1
 * @param {string} s2
 * @returns {number}
 */
function longestCommonSubstring(s1, s2) {
  const m = s1.length;
  const n = s2.length;

  if (m === 0 || n === 0) return 0;

  let maxLen = 0;
  const dp = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
        maxLen = Math.max(maxLen, dp[i][j]);
      }
    }
  }

  return maxLen;
}

/**
 * Suggest manual matches for unmatched files
 * @param {File[]} unmatchedRef - Unmatched reference files
 * @param {File[]} unmatchedComp - Unmatched comparator files
 * @returns {MatchSuggestion[]}
 */
export function suggestMatches(unmatchedRef, unmatchedComp) {
  const suggestions = [];

  for (const refFile of unmatchedRef) {
    const candidates = [];

    for (const compFile of unmatchedComp) {
      if (areFileNamesSimilar(refFile.name, compFile.name)) {
        candidates.push(compFile);
      }
    }

    if (candidates.length > 0) {
      suggestions.push({
        reference: refFile,
        candidates,
      });
    }
  }

  return suggestions;
}

/**
 * @typedef {Object} FileMatch
 * @property {File} reference - Reference file
 * @property {File} comparator - Comparator file
 * @property {string} [relativePath] - Relative path (for folder matches)
 * @property {boolean} [isManual] - Whether manually paired
 */

/**
 * @typedef {Object} MatchResult
 * @property {FileMatch[]} matches - Matched file pairs
 * @property {File[]} unmatchedRef - Unmatched reference files
 * @property {File[]} unmatchedComp - Unmatched comparator files
 */

/**
 * @typedef {Object} MatchStats
 * @property {number} matched - Number of matched pairs
 * @property {number} unmatchedRef - Number of unmatched reference files
 * @property {number} unmatchedComp - Number of unmatched comparator files
 * @property {number} total - Total files considered
 */

/**
 * @typedef {Object} MatchSuggestion
 * @property {File} reference - Reference file
 * @property {File[]} candidates - Potential matches
 */
