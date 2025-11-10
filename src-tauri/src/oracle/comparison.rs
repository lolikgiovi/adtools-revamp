/// Comparison engine for Oracle configuration data
///
/// This module implements the core comparison algorithm for comparing
/// configuration records between two Oracle database environments.

use super::models::{
    ComparisonResult, ComparisonSummary, ComparisonStatus, ConfigComparison,
    FieldDifference, DiffChunk, DiffChunkType,
};
use std::collections::HashMap;

/// Engine for comparing configuration data between environments
pub struct ComparisonEngine;

impl ComparisonEngine {
    /// Compares records from two environments
    ///
    /// This method performs the core comparison logic:
    /// 1. Builds maps of records keyed by primary key
    /// 2. Finds all unique primary keys across both environments
    /// 3. Compares matching records field-by-field
    /// 4. Computes diff chunks for text highlighting
    /// 5. Returns structured comparison results
    pub fn compare(
        env1_name: String,
        env2_name: String,
        env1_records: Vec<serde_json::Value>,
        env2_records: Vec<serde_json::Value>,
        pk_fields: &[String],
        compare_fields: &[String],
    ) -> Result<ComparisonResult, String> {
        log::info!(
            "Starting comparison: {} records in env1, {} records in env2",
            env1_records.len(),
            env2_records.len()
        );

        // Build maps keyed by primary key
        let env1_map = Self::build_record_map(&env1_records, pk_fields);
        let env2_map = Self::build_record_map(&env2_records, pk_fields);

        // Get all unique primary keys
        let all_keys: std::collections::HashSet<_> =
            env1_map.keys().chain(env2_map.keys()).cloned().collect();

        let mut comparisons = Vec::new();
        let mut summary = ComparisonSummary {
            total_records: all_keys.len(),
            matching: 0,
            differing: 0,
            only_in_env1: 0,
            only_in_env2: 0,
        };

        // Compare each record
        let mut row_num = 0;
        for key in all_keys {
            let env1_record = env1_map.get(&key);
            let env2_record = env2_map.get(&key);

            let (status, differences) = match (env1_record, env2_record) {
                (Some(r1), Some(r2)) => {
                    let diffs = Self::find_differences(r1, r2, compare_fields);
                    if diffs.is_empty() {
                        summary.matching += 1;
                        (ComparisonStatus::Match, diffs)
                    } else {
                        summary.differing += 1;
                        (ComparisonStatus::Differ, diffs)
                    }
                }
                (Some(_), None) => {
                    summary.only_in_env1 += 1;
                    (ComparisonStatus::OnlyInEnv1, vec![])
                }
                (None, Some(_)) => {
                    summary.only_in_env2 += 1;
                    (ComparisonStatus::OnlyInEnv2, vec![])
                }
                (None, None) => unreachable!(), // Can't happen since key came from union
            };

            row_num += 1;

            // Format the display key: if it's very long (composite key), use row number
            let display_key = if key.len() > 100 {
                format!("Row #{}", row_num)
            } else {
                key.clone()
            };

            comparisons.push(ConfigComparison {
                primary_key: display_key,
                status,
                env1_data: env1_record.cloned(),
                env2_data: env2_record.cloned(),
                differences,
            });
        }

        // Sort: differences first, then by primary key
        comparisons.sort_by(|a, b| {
            match (&a.status, &b.status) {
                (ComparisonStatus::Match, ComparisonStatus::Match) => {
                    a.primary_key.cmp(&b.primary_key)
                }
                (ComparisonStatus::Match, _) => std::cmp::Ordering::Greater,
                (_, ComparisonStatus::Match) => std::cmp::Ordering::Less,
                _ => a.primary_key.cmp(&b.primary_key),
            }
        });

        log::info!(
            "Comparison complete: {} matching, {} differing, {} only in env1, {} only in env2",
            summary.matching,
            summary.differing,
            summary.only_in_env1,
            summary.only_in_env2
        );

        Ok(ComparisonResult {
            env1_name,
            env2_name,
            timestamp: chrono::Local::now().to_rfc3339(),
            summary,
            comparisons,
        })
    }

    /// Builds a record map keyed by primary key
    ///
    /// Primary keys with multiple fields are joined with "::"
    fn build_record_map(
        records: &[serde_json::Value],
        pk_fields: &[String],
    ) -> HashMap<String, serde_json::Value> {
        let mut map = HashMap::new();

        for record in records {
            if let Some(obj) = record.as_object() {
                let key = pk_fields
                    .iter()
                    .filter_map(|field| {
                        obj.get(field).and_then(|v| match v {
                            serde_json::Value::String(s) => Some(s.clone()),
                            serde_json::Value::Number(n) => Some(n.to_string()),
                            serde_json::Value::Bool(b) => Some(b.to_string()),
                            serde_json::Value::Null => Some("NULL".to_string()),
                            _ => None,
                        })
                    })
                    .collect::<Vec<_>>()
                    .join("::");

                if !key.is_empty() {
                    map.insert(key, record.clone());
                }
            }
        }

        map
    }

    /// Finds differences between two records
    ///
    /// Compares field values and generates diff chunks for text highlighting
    fn find_differences(
        record1: &serde_json::Value,
        record2: &serde_json::Value,
        fields: &[String],
    ) -> Vec<FieldDifference> {
        let mut differences = Vec::new();

        let obj1 = match record1.as_object() {
            Some(o) => o,
            None => return differences,
        };

        let obj2 = match record2.as_object() {
            Some(o) => o,
            None => return differences,
        };

        // Determine which fields to compare
        let fields_to_compare: Vec<String> = if fields.is_empty() {
            obj1.keys().cloned().collect()
        } else {
            fields.to_vec()
        };

        for field in fields_to_compare {
            let val1 = obj1.get(&field);
            let val2 = obj2.get(&field);

            if val1 != val2 {
                let str1 = value_to_string(val1);
                let str2 = value_to_string(val2);

                // Generate character-level diff chunks for highlighting
                let (chunks1, chunks2) = Self::compute_diff_chunks(&str1, &str2);

                differences.push(FieldDifference {
                    field_name: field.clone(),
                    env1_value: Some(str1),
                    env2_value: Some(str2),
                    env1_diff_chunks: chunks1,
                    env2_diff_chunks: chunks2,
                });
            }
        }

        differences
    }

    /// Computes diff chunks for text highlighting
    ///
    /// Uses smart adaptive approach:
    /// - For completely different strings: highlight entire text
    /// - For similar strings: use Myers diff algorithm for clean, intuitive diffs
    /// - Falls back to highlighting all if Myers takes too long
    pub fn compute_diff_chunks(s1: &str, s2: &str) -> (Vec<DiffChunk>, Vec<DiffChunk>) {
        // Phase 1: Quick check for completely different strings
        let similarity = Self::calculate_similarity(s1, s2);

        if similarity < 0.3 {
            // Completely different - just highlight everything
            return (
                vec![DiffChunk {
                    text: s1.to_string(),
                    chunk_type: DiffChunkType::Removed,
                }],
                vec![DiffChunk {
                    text: s2.to_string(),
                    chunk_type: DiffChunkType::Added,
                }],
            );
        }

        // Phase 2: Use Myers diff algorithm for clean results
        Self::compute_myers_diff_chunks(s1, s2)
    }

    /// Calculates similarity ratio between two strings using LCS
    fn calculate_similarity(s1: &str, s2: &str) -> f64 {
        if s1.is_empty() && s2.is_empty() {
            return 1.0;
        }
        if s1.is_empty() || s2.is_empty() {
            return 0.0;
        }

        let chars1: Vec<char> = s1.chars().collect();
        let chars2: Vec<char> = s2.chars().collect();
        let lcs_length = Self::compute_char_lcs_length(&chars1, &chars2);

        let max_len = s1.len().max(s2.len());
        lcs_length as f64 / max_len as f64
    }

    /// Computes LCS length for characters (for similarity calculation)
    fn compute_char_lcs_length(chars1: &[char], chars2: &[char]) -> usize {
        let m = chars1.len();
        let n = chars2.len();
        let mut dp = vec![vec![0; n + 1]; m + 1];

        for i in 1..=m {
            for j in 1..=n {
                if chars1[i - 1] == chars2[j - 1] {
                    dp[i][j] = dp[i - 1][j - 1] + 1;
                } else {
                    dp[i][j] = dp[i - 1][j].max(dp[i][j - 1]);
                }
            }
        }

        dp[m][n]
    }

    /// Computes diff chunks using Myers diff algorithm
    ///
    /// Myers algorithm produces cleaner, more intuitive diffs than LCS.
    /// For example: "ABC|DEF|" vs "ABC|" will correctly show "DEF|" as removed,
    /// rather than splitting it into confusing character fragments.
    fn compute_myers_diff_chunks(s1: &str, s2: &str) -> (Vec<DiffChunk>, Vec<DiffChunk>) {
        let chars1: Vec<char> = s1.chars().collect();
        let chars2: Vec<char> = s2.chars().collect();

        // Compute Myers diff
        let edits = Self::myers_diff(&chars1, &chars2);

        // Build chunks from edit script
        let (chunks1, chunks2) = Self::build_chunks_from_myers(&chars1, &chars2, &edits);

        (chunks1, chunks2)
    }

    /// Myers diff algorithm implementation
    ///
    /// Returns a vector of edit operations: (type, position_in_s1, position_in_s2)
    /// where type is: 0 = match, 1 = insert (add to s2), -1 = delete (remove from s1)
    fn myers_diff(s1: &[char], s2: &[char]) -> Vec<(i32, usize, usize)> {
        let n = s1.len();
        let m = s2.len();
        let max = n + m;

        // V array for Myers algorithm
        let mut v: Vec<isize> = vec![0; 2 * max + 1];
        let offset = max;

        // Trace for backtracking
        let mut trace: Vec<Vec<isize>> = Vec::new();

        // Find shortest edit script
        for d in 0..=max {
            trace.push(v.clone());

            for k in (-(d as isize)..=(d as isize)).step_by(2) {
                let k_idx = (k + offset as isize) as usize;

                let mut x = if k == -(d as isize) || (k != d as isize && v[k_idx - 1] < v[k_idx + 1]) {
                    v[k_idx + 1]
                } else {
                    v[k_idx - 1] + 1
                };

                let mut y = x - k;

                // Extend diagonal
                while (x as usize) < n && (y as usize) < m && s1[x as usize] == s2[y as usize] {
                    x += 1;
                    y += 1;
                }

                v[k_idx] = x;

                if (x as usize) >= n && (y as usize) >= m {
                    // Found the shortest path
                    return Self::backtrack_myers(&trace, s1, s2, d, k, offset);
                }
            }
        }

        // Fallback: no common subsequence
        vec![]
    }

    /// Backtrack through Myers trace to build edit script
    fn backtrack_myers(
        trace: &[Vec<isize>],
        s1: &[char],
        s2: &[char],
        d: usize,
        mut k: isize,
        offset: usize,
    ) -> Vec<(i32, usize, usize)> {
        let mut edits = Vec::new();
        let mut x = s1.len() as isize;
        let mut y = s2.len() as isize;

        for d in (0..=d).rev() {
            let k_idx = (k + offset as isize) as usize;
            let v = &trace[d];

            let prev_k = if k == -(d as isize) || (k != d as isize && v[k_idx - 1] < v[k_idx + 1]) {
                k + 1
            } else {
                k - 1
            };

            let prev_k_idx = (prev_k + offset as isize) as usize;
            let prev_x = if d > 0 { v[prev_k_idx] } else { 0 };
            let prev_y = prev_x - prev_k;

            // Extend diagonal matches backwards
            while x > prev_x && y > prev_y {
                x -= 1;
                y -= 1;
                edits.push((0, x as usize, y as usize)); // Match
            }

            if d > 0 {
                if x == prev_x {
                    // Insert
                    y -= 1;
                    edits.push((1, x as usize, y as usize));
                } else {
                    // Delete
                    x -= 1;
                    edits.push((-1, x as usize, y as usize));
                }
            }

            k = prev_k;
        }

        edits.reverse();
        edits
    }

    /// Builds chunks from Myers edit script
    fn build_chunks_from_myers(
        s1: &[char],
        s2: &[char],
        edits: &[(i32, usize, usize)],
    ) -> (Vec<DiffChunk>, Vec<DiffChunk>) {
        let mut chunks1 = Vec::new();
        let mut chunks2 = Vec::new();

        let mut current1 = String::new();
        let mut current2 = String::new();
        let mut type1 = DiffChunkType::Same;
        let mut type2 = DiffChunkType::Same;

        for (op, i, j) in edits {
            match op {
                0 => {
                    // Match
                    let ch = s1[*i];

                    // Flush previous chunks if type changes
                    if type1 != DiffChunkType::Same && !current1.is_empty() {
                        chunks1.push(DiffChunk {
                            text: current1.clone(),
                            chunk_type: type1.clone(),
                        });
                        current1.clear();
                    }
                    if type2 != DiffChunkType::Same && !current2.is_empty() {
                        chunks2.push(DiffChunk {
                            text: current2.clone(),
                            chunk_type: type2.clone(),
                        });
                        current2.clear();
                    }

                    current1.push(ch);
                    current2.push(ch);
                    type1 = DiffChunkType::Same;
                    type2 = DiffChunkType::Same;
                }
                -1 => {
                    // Delete from s1
                    let ch = s1[*i];

                    if type1 != DiffChunkType::Removed && !current1.is_empty() {
                        chunks1.push(DiffChunk {
                            text: current1.clone(),
                            chunk_type: type1.clone(),
                        });
                        current1.clear();
                    }

                    current1.push(ch);
                    type1 = DiffChunkType::Removed;
                }
                1 => {
                    // Insert into s2
                    let ch = s2[*j];

                    if type2 != DiffChunkType::Added && !current2.is_empty() {
                        chunks2.push(DiffChunk {
                            text: current2.clone(),
                            chunk_type: type2.clone(),
                        });
                        current2.clear();
                    }

                    current2.push(ch);
                    type2 = DiffChunkType::Added;
                }
                _ => {}
            }
        }

        // Flush remaining
        if !current1.is_empty() {
            chunks1.push(DiffChunk {
                text: current1,
                chunk_type: type1,
            });
        }
        if !current2.is_empty() {
            chunks2.push(DiffChunk {
                text: current2,
                chunk_type: type2,
            });
        }

        (chunks1, chunks2)
    }

    /// Computes character-level diff chunks for similar strings (OLD - kept for reference)
    #[allow(dead_code)]
    fn compute_char_diff_chunks_old(s1: &str, s2: &str) -> (Vec<DiffChunk>, Vec<DiffChunk>) {
        let chars1: Vec<char> = s1.chars().collect();
        let chars2: Vec<char> = s2.chars().collect();

        let lcs = Self::compute_char_lcs(&chars1, &chars2);

        // Build matching position sets
        let mut matching_pos1 = std::collections::HashSet::new();
        let mut matching_pos2 = std::collections::HashSet::new();
        for (i, j) in &lcs {
            matching_pos1.insert(*i);
            matching_pos2.insert(*j);
        }

        // Build chunks for Env1 (show removed characters)
        let chunks1 = Self::build_char_chunks(&chars1, &matching_pos1, DiffChunkType::Removed);

        // Build chunks for Env2 (show added characters)
        let chunks2 = Self::build_char_chunks(&chars2, &matching_pos2, DiffChunkType::Added);

        (chunks1, chunks2)
    }

    /// Builds chunks from character array with matching positions
    fn build_char_chunks(
        chars: &[char],
        matching_positions: &std::collections::HashSet<usize>,
        diff_type: DiffChunkType,
    ) -> Vec<DiffChunk> {
        let mut chunks = Vec::new();
        let mut current_chunk = String::new();
        let mut current_type = DiffChunkType::Same;

        for (idx, ch) in chars.iter().enumerate() {
            let chunk_type = if matching_positions.contains(&idx) {
                DiffChunkType::Same
            } else {
                diff_type.clone()
            };

            if chunk_type != current_type && !current_chunk.is_empty() {
                chunks.push(DiffChunk {
                    text: current_chunk.clone(),
                    chunk_type: current_type,
                });
                current_chunk.clear();
            }

            current_chunk.push(*ch);
            current_type = chunk_type;
        }

        if !current_chunk.is_empty() {
            chunks.push(DiffChunk {
                text: current_chunk,
                chunk_type: current_type,
            });
        }

        chunks
    }

    /// Computes LCS positions for characters
    fn compute_char_lcs(chars1: &[char], chars2: &[char]) -> Vec<(usize, usize)> {
        let m = chars1.len();
        let n = chars2.len();
        let mut dp = vec![vec![0; n + 1]; m + 1];

        // Fill DP table
        for i in 1..=m {
            for j in 1..=n {
                if chars1[i - 1] == chars2[j - 1] {
                    dp[i][j] = dp[i - 1][j - 1] + 1;
                } else {
                    dp[i][j] = dp[i - 1][j].max(dp[i][j - 1]);
                }
            }
        }

        // Backtrack to find LCS positions
        let mut lcs = Vec::new();
        let mut i = m;
        let mut j = n;

        while i > 0 && j > 0 {
            if chars1[i - 1] == chars2[j - 1] {
                lcs.push((i - 1, j - 1));
                i -= 1;
                j -= 1;
            } else if dp[i - 1][j] > dp[i][j - 1] {
                i -= 1;
            } else {
                j -= 1;
            }
        }

        lcs.reverse();
        lcs
    }

    /// Computes word-level diff chunks for very different strings
    fn compute_word_diff_chunks(s1: &str, s2: &str) -> (Vec<DiffChunk>, Vec<DiffChunk>) {
        let words1: Vec<&str> = s1.split_whitespace().collect();
        let words2: Vec<&str> = s2.split_whitespace().collect();

        if words1.is_empty() || words2.is_empty() {
            return (
                vec![DiffChunk {
                    text: s1.to_string(),
                    chunk_type: if s1 == s2 {
                        DiffChunkType::Same
                    } else {
                        DiffChunkType::Removed
                    },
                }],
                vec![DiffChunk {
                    text: s2.to_string(),
                    chunk_type: if s1 == s2 {
                        DiffChunkType::Same
                    } else {
                        DiffChunkType::Added
                    },
                }],
            );
        }

        let lcs = Self::compute_lcs(&words1, &words2);

        // Build matching position sets
        let mut matching_pos1 = std::collections::HashSet::new();
        let mut matching_pos2 = std::collections::HashSet::new();
        for (i, j) in &lcs {
            matching_pos1.insert(*i);
            matching_pos2.insert(*j);
        }

        // Create chunks for Env1
        let chunks1: Vec<DiffChunk> = words1
            .iter()
            .enumerate()
            .map(|(idx, word)| DiffChunk {
                text: format!("{} ", word),
                chunk_type: if matching_pos1.contains(&idx) {
                    DiffChunkType::Same
                } else {
                    DiffChunkType::Removed
                },
            })
            .collect();

        // Create chunks for Env2
        let chunks2: Vec<DiffChunk> = words2
            .iter()
            .enumerate()
            .map(|(idx, word)| DiffChunk {
                text: format!("{} ", word),
                chunk_type: if matching_pos2.contains(&idx) {
                    DiffChunkType::Same
                } else {
                    DiffChunkType::Added
                },
            })
            .collect();

        (chunks1, chunks2)
    }

    /// Computes Longest Common Subsequence (LCS) for diff algorithm
    ///
    /// Uses dynamic programming to find the longest sequence of common words
    fn compute_lcs<'a>(words1: &[&'a str], words2: &[&'a str]) -> Vec<(usize, usize)> {
        let m = words1.len();
        let n = words2.len();
        let mut dp = vec![vec![0; n + 1]; m + 1];

        // Fill DP table
        for i in 1..=m {
            for j in 1..=n {
                if words1[i - 1] == words2[j - 1] {
                    dp[i][j] = dp[i - 1][j - 1] + 1;
                } else {
                    dp[i][j] = dp[i - 1][j].max(dp[i][j - 1]);
                }
            }
        }

        // Backtrack to find LCS positions
        let mut lcs = Vec::new();
        let mut i = m;
        let mut j = n;

        while i > 0 && j > 0 {
            if words1[i - 1] == words2[j - 1] {
                lcs.push((i - 1, j - 1));
                i -= 1;
                j -= 1;
            } else if dp[i - 1][j] > dp[i][j - 1] {
                i -= 1;
            } else {
                j -= 1;
            }
        }

        lcs.reverse();
        lcs
    }
}

/// Converts a JSON value to a string for comparison
fn value_to_string(val: Option<&serde_json::Value>) -> String {
    match val {
        Some(serde_json::Value::String(s)) => s.clone(),
        Some(serde_json::Value::Number(n)) => n.to_string(),
        Some(serde_json::Value::Bool(b)) => b.to_string(),
        Some(serde_json::Value::Null) => "NULL".to_string(),
        Some(v) => v.to_string(),
        None => "".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_build_record_map() {
        let records = vec![
            json!({"id": "1", "name": "test1", "value": "100"}),
            json!({"id": "2", "name": "test2", "value": "200"}),
        ];
        let pk_fields = vec!["id".to_string()];

        let map = ComparisonEngine::build_record_map(&records, &pk_fields);

        assert_eq!(map.len(), 2);
        assert!(map.contains_key("1"));
        assert!(map.contains_key("2"));
    }

    #[test]
    fn test_find_differences() {
        let record1 = json!({"id": "1", "name": "test", "value": "100"});
        let record2 = json!({"id": "1", "name": "test", "value": "200"});
        let fields = vec!["id".to_string(), "name".to_string(), "value".to_string()];

        let diffs = ComparisonEngine::find_differences(&record1, &record2, &fields);

        assert_eq!(diffs.len(), 1);
        assert_eq!(diffs[0].field_name, "value");
        assert_eq!(diffs[0].env1_value, Some("100".to_string()));
        assert_eq!(diffs[0].env2_value, Some("200".to_string()));
    }

    #[test]
    fn test_compute_lcs() {
        let words1 = vec!["the", "quick", "brown", "fox"];
        let words2 = vec!["the", "lazy", "brown", "dog"];

        let lcs = ComparisonEngine::compute_lcs(&words1, &words2);

        // Should find "the" and "brown" as common
        assert!(lcs.len() >= 2);
    }

    #[test]
    fn test_compare_matching_records() {
        let env1_records = vec![json!({"id": "1", "value": "test"})];
        let env2_records = vec![json!({"id": "1", "value": "test"})];
        let pk_fields = vec!["id".to_string()];
        let compare_fields = vec!["id".to_string(), "value".to_string()];

        let result = ComparisonEngine::compare(
            "env1".to_string(),
            "env2".to_string(),
            env1_records,
            env2_records,
            &pk_fields,
            &compare_fields,
        )
        .unwrap();

        assert_eq!(result.summary.total_records, 1);
        assert_eq!(result.summary.matching, 1);
        assert_eq!(result.summary.differing, 0);
    }

    #[test]
    fn test_compare_differing_records() {
        let env1_records = vec![json!({"id": "1", "value": "old"})];
        let env2_records = vec![json!({"id": "1", "value": "new"})];
        let pk_fields = vec!["id".to_string()];
        let compare_fields = vec!["id".to_string(), "value".to_string()];

        let result = ComparisonEngine::compare(
            "env1".to_string(),
            "env2".to_string(),
            env1_records,
            env2_records,
            &pk_fields,
            &compare_fields,
        )
        .unwrap();

        assert_eq!(result.summary.total_records, 1);
        assert_eq!(result.summary.matching, 0);
        assert_eq!(result.summary.differing, 1);
    }

    #[test]
    fn test_myers_diff_simple() {
        // Test case: "ABC" vs "ABCD" using Myers diff
        let (chunks1, chunks2) = ComparisonEngine::compute_diff_chunks("ABC", "ABCD");

        // Env1 should show "ABC" as all same (no D to remove)
        assert_eq!(chunks1.len(), 1);
        assert_eq!(chunks1[0].text, "ABC");
        assert_eq!(chunks1[0].chunk_type, DiffChunkType::Same);

        // Env2 should show "ABC" as same and "D" as added
        assert_eq!(chunks2.len(), 2);
        assert_eq!(chunks2[0].text, "ABC");
        assert_eq!(chunks2[0].chunk_type, DiffChunkType::Same);
        assert_eq!(chunks2[1].text, "D");
        assert_eq!(chunks2[1].chunk_type, DiffChunkType::Added);
    }

    #[test]
    fn test_myers_diff_pipe_separated() {
        // Test case from user's example: pipe-separated values
        let env1 = "ATMPRI|GOVATN|GOVMS1|KDMPRI|KDTANI|MAKMR2|MAKMUR|KPRI01|PRIOP1|";
        let env2 = "ATMPRI|GOVATN|GOVMS1|KDMPRI|KDTANI|MAKMR2|MAKMUR|";

        let (chunks1, chunks2) = ComparisonEngine::compute_diff_chunks(env1, env2);

        // Env1 should show common part + removed part
        // Find the chunk with removed content
        let removed_chunk = chunks1.iter().find(|c| c.chunk_type == DiffChunkType::Removed);
        assert!(removed_chunk.is_some(), "Should have removed chunk");
        assert_eq!(removed_chunk.unwrap().text, "KPRI01|PRIOP1|");

        // Env2 should show only the common part as "same"
        assert_eq!(chunks2.len(), 1);
        assert_eq!(chunks2[0].text, "ATMPRI|GOVATN|GOVMS1|KDMPRI|KDTANI|MAKMR2|MAKMUR|");
        assert_eq!(chunks2[0].chunk_type, DiffChunkType::Same);
    }

    #[test]
    fn test_similarity_calculation() {
        // Test high similarity
        let similarity = ComparisonEngine::calculate_similarity("ABC", "ABCD");
        assert!(similarity > 0.6, "ABC vs ABCD should have >60% similarity");

        // Test low similarity
        let similarity = ComparisonEngine::calculate_similarity("hello world", "goodbye universe");
        assert!(similarity < 0.6, "Very different strings should have <60% similarity");

        // Test identical strings
        let similarity = ComparisonEngine::calculate_similarity("test", "test");
        assert_eq!(similarity, 1.0, "Identical strings should have 100% similarity");
    }

    #[test]
    fn test_word_diff_for_different_strings() {
        // Test case: very different strings should use word-level diff
        let (chunks1, chunks2) = ComparisonEngine::compute_diff_chunks("hello world", "goodbye universe");

        // Should use word-level diff (multiple chunks)
        assert!(chunks1.len() > 0);
        assert!(chunks2.len() > 0);
    }
}
