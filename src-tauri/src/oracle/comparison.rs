use crate::oracle::credentials::CredentialManager;
use crate::oracle::types::OracleConnectionConfig;
use crate::oracle::query;
use crate::oracle::sanitize;

use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

fn build_pk_value_object(pk_cols: &[String], data: &HashMap<String, Option<String>>) -> Value {
  let mut obj = serde_json::Map::new();
  for k in pk_cols {
    let v = data.get(k).and_then(|x| x.clone());
    match v {
      Some(s) => { obj.insert(k.clone(), Value::String(s)); },
      None => { obj.insert(k.clone(), Value::Null); },
    }
  }
  Value::Object(obj)
}

pub fn compare(
  cm: &CredentialManager,
  env1: &OracleConnectionConfig,
  env2: &OracleConnectionConfig,
  table: &str,
  where_clause: Option<&str>,
  fields: Option<&[String]>,
) -> Result<Value, String> {
  let table = sanitize::normalize_identifier(table).ok_or_else(|| "Invalid table identifier".to_string())?;

  // Fetch rows for each environment
  let (pk1, field_order1, rows1) = query::fetch_rows_for_comparison(cm, env1, env1.schema.as_deref(), &table, fields, where_clause)?;
  let (pk2, field_order2, rows2) = query::fetch_rows_for_comparison(cm, env2, env2.schema.as_deref(), &table, fields, where_clause)?;

  // Align on a single PK list: prefer env1, otherwise env2
  let pk_cols = if !pk1.is_empty() { pk1 } else { pk2 };
  let field_order = if !field_order1.is_empty() { field_order1 } else { field_order2 };

  let mut all_keys: HashSet<String> = HashSet::new();
  for k in rows1.keys() { all_keys.insert(k.clone()); }
  for k in rows2.keys() { all_keys.insert(k.clone()); }

  let mut comparisons: Vec<Value> = Vec::new();
  let mut matches = 0usize;
  let mut differences = 0usize;
  let mut only_env1 = 0usize;
  let mut only_env2 = 0usize;

  for key in all_keys.into_iter() {
    let d1 = rows1.get(&key);
    let d2 = rows2.get(&key);

    match (d1, d2) {
      (Some(data1), Some(data2)) => {
        // Compare field by field
        let mut diffs: Vec<Value> = Vec::new();
        for f in &field_order {
          let v1 = data1.get(f).cloned().flatten();
          let v2 = data2.get(f).cloned().flatten();
          if v1 != v2 {
            diffs.push(json!({"field": f, "env1": v1, "env2": v2}));
          }
        }

        if diffs.is_empty() {
          matches += 1;
          comparisons.push(json!({
            "primary_key": build_pk_value_object(&pk_cols, data1),
            "status": "Match",
            "env1_data": data1,
            "env2_data": data2,
          }));
        } else {
          differences += 1;
          comparisons.push(json!({
            "primary_key": build_pk_value_object(&pk_cols, data1),
            "status": "Differ",
            "differences": diffs,
            "env1_data": data1,
            "env2_data": data2,
          }));
        }
      }
      (Some(data1), None) => {
        only_env1 += 1;
        comparisons.push(json!({
          "primary_key": build_pk_value_object(&pk_cols, data1),
          "status": "OnlyInEnv1",
          "env1_data": data1,
          "env2_data": serde_json::Value::Null,
        }));
      }
      (None, Some(data2)) => {
        only_env2 += 1;
        comparisons.push(json!({
          "primary_key": build_pk_value_object(&pk_cols, data2),
          "status": "OnlyInEnv2",
          "env1_data": serde_json::Value::Null,
          "env2_data": data2,
        }));
      }
      (None, None) => { /* impossible */ }
    }
  }

  let total = matches + differences + only_env1 + only_env2;
  let timestamp = chrono::Utc::now().to_rfc3339();

  Ok(json!({
    "env1": env1.id,
    "env2": env2.id,
    "table": table,
    "timestamp": timestamp,
    "summary": {
      "total": total,
      "matches": matches,
      "differences": differences,
      "only_env1": only_env1,
      "only_env2": only_env2,
    },
    "fields": field_order,
    "primary_key": pk_cols,
    "comparisons": comparisons,
  }))
}

pub fn to_csv(payload: &Value) -> Result<String, String> {
  // CSV focuses on differences; columns: primary_key,status,field,env1,env2
  let comps = payload.get("comparisons").and_then(|v| v.as_array()).ok_or_else(|| "Invalid payload: comparisons missing".to_string())?;
  let mut out = String::new();
  out.push_str("primary_key,status,field,env1,env2\n");
  for c in comps {
    let status = c.get("status").and_then(|v| v.as_str()).unwrap_or("");
    let pk = c.get("primary_key").map(|v| v.to_string()).unwrap_or_else(|| "{}".to_string());
    match status {
      "Differ" => {
        if let Some(diffs) = c.get("differences").and_then(|v| v.as_array()) {
          for d in diffs {
            let field = d.get("field").and_then(|v| v.as_str()).unwrap_or("");
            let env1 = d.get("env1").map(|v| match v { Value::String(s) => s.clone(), Value::Null => String::new(), _ => v.to_string() }).unwrap_or_default();
            let env2 = d.get("env2").map(|v| match v { Value::String(s) => s.clone(), Value::Null => String::new(), _ => v.to_string() }).unwrap_or_default();
            out.push_str(&format!("\"{}\",{},\"{}\",\"{}\",\"{}\"\n", pk.replace('"', "'"), status, field.replace('"', "'"), env1.replace('"', "'"), env2.replace('"', "'")));
          }
        }
      }
      _ => { /* skip non-difference rows */ }
    }
  }
  Ok(out)
}