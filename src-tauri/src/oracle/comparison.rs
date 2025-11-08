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

            comparisons.push(ConfigComparison {
                primary_key: key,
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
    /// Uses word-based LCS algorithm for performance
    pub fn compute_diff_chunks(s1: &str, s2: &str) -> (Vec<DiffChunk>, Vec<DiffChunk>) {
        // Split by whitespace to get word tokens
        let words1: Vec<&str> = s1.split_whitespace().collect();
        let words2: Vec<&str> = s2.split_whitespace().collect();

        // Simple LCS-based diff (Longest Common Subsequence)
        let lcs = Self::compute_lcs(&words1, &words2);

        let mut chunks1 = Vec::new();
        let mut chunks2 = Vec::new();
        let mut i = 0;
        let mut j = 0;
        let mut lcs_idx = 0;

        while i < words1.len() || j < words2.len() {
            if lcs_idx < lcs.len() {
                let (lcs_i, lcs_j) = lcs[lcs_idx];

                // Add removed words (only in s1)
                while i < lcs_i {
                    chunks1.push(DiffChunk {
                        text: format!("{} ", words1[i]),
                        chunk_type: DiffChunkType::Removed,
                    });
                    i += 1;
                }

                // Add added words (only in s2)
                while j < lcs_j {
                    chunks2.push(DiffChunk {
                        text: format!("{} ", words2[j]),
                        chunk_type: DiffChunkType::Added,
                    });
                    j += 1;
                }

                // Add common word
                chunks1.push(DiffChunk {
                    text: format!("{} ", words1[i]),
                    chunk_type: DiffChunkType::Same,
                });
                chunks2.push(DiffChunk {
                    text: format!("{} ", words2[j]),
                    chunk_type: DiffChunkType::Same,
                });
                i += 1;
                j += 1;
                lcs_idx += 1;
            } else {
                // Remaining words after LCS
                while i < words1.len() {
                    chunks1.push(DiffChunk {
                        text: format!("{} ", words1[i]),
                        chunk_type: DiffChunkType::Removed,
                    });
                    i += 1;
                }
                while j < words2.len() {
                    chunks2.push(DiffChunk {
                        text: format!("{} ", words2[j]),
                        chunk_type: DiffChunkType::Added,
                    });
                    j += 1;
                }
            }
        }

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
}
