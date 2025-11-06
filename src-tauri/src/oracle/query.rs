use crate::oracle::credentials::CredentialManager;
use crate::oracle::types::{OracleColumnMeta, OracleConnectionConfig, OracleTableMeta};
use crate::oracle::{client, sanitize};

use std::collections::HashSet;

fn connect(cm: &CredentialManager, cfg: &OracleConnectionConfig) -> Result<oracle::Connection, String> {
  client::prime()?;
  let (username, password) = cm.get_secret(&cfg.id)?;
  let connect_str = format!("{}:{}/{}", cfg.host, cfg.port, cfg.service_name);
  oracle::Connection::connect(&username, &password, &connect_str).map_err(|e| e.to_string())
}

fn fetch_pk_columns(conn: &oracle::Connection, schema: Option<&str>, table: &str) -> Result<HashSet<String>, String> {
  let mut pk = HashSet::new();
  if let Some(owner) = schema {
    let sql = "SELECT acc.column_name \
               FROM all_cons_columns acc \
               JOIN all_constraints ac \
                 ON acc.owner = ac.owner \
                AND acc.constraint_name = ac.constraint_name \
              WHERE ac.constraint_type = 'P' \
                AND acc.table_name = :1 \
                AND acc.owner = :2 \
              ORDER BY acc.position";
    let rows = conn.query(sql, &[&table, &owner]).map_err(|e| e.to_string())?;
    for row_result in rows {
      let row = row_result.map_err(|e| e.to_string())?;
      let name: String = row.get(0).map_err(|e| e.to_string())?;
      pk.insert(name.to_uppercase());
    }
  } else {
    let sql = "SELECT ucc.column_name \
               FROM user_cons_columns ucc \
               JOIN user_constraints uc \
                 ON ucc.constraint_name = uc.constraint_name \
              WHERE uc.constraint_type = 'P' \
                AND ucc.table_name = :1 \
              ORDER BY ucc.position";
    let rows = conn.query(sql, &[&table]).map_err(|e| e.to_string())?;
    for row_result in rows {
      let row = row_result.map_err(|e| e.to_string())?;
      let name: String = row.get(0).map_err(|e| e.to_string())?;
      pk.insert(name.to_uppercase());
    }
  }
  Ok(pk)
}

pub fn fetch_table_metadata(cm: &CredentialManager, cfg: &OracleConnectionConfig, schema: Option<&str>, table: &str) -> Result<OracleTableMeta, String> {
  let table = sanitize::normalize_identifier(table).ok_or_else(|| "Invalid table identifier".to_string())?;
  let schema = match schema.or_else(|| cfg.schema.as_deref()) {
    Some(s) => Some(sanitize::normalize_identifier(s).ok_or_else(|| "Invalid schema identifier".to_string())?),
    None => None,
  };

  let conn = connect(cm, cfg)?;
  let pk_set = fetch_pk_columns(&conn, schema.as_deref(), &table)?;

  let mut columns: Vec<OracleColumnMeta> = Vec::new();
  if let Some(owner) = schema.as_deref() {
    let sql = "SELECT column_name, data_type, data_length, nullable, TO_CHAR(data_default) \
               FROM all_tab_columns \
              WHERE table_name = :1 AND owner = :2 \
              ORDER BY column_id";
    let rows = conn.query(sql, &[&table, &owner]).map_err(|e| e.to_string())?;
    for row_result in rows {
      let row = row_result.map_err(|e| e.to_string())?;
      let name: String = row.get(0).map_err(|e| e.to_string())?;
      let data_type: String = row.get(1).map_err(|e| e.to_string())?;
      let data_length: Option<i64> = row.get(2).map_err(|e| e.to_string())?;
      let nullable: String = row.get(3).map_err(|e| e.to_string())?;
      let data_default: Option<String> = row.get(4).map_err(|e| e.to_string())?;
      columns.push(OracleColumnMeta {
        name: name.clone(),
        data_type,
        data_length,
        nullable: nullable == "Y",
        data_default,
        is_primary_key: pk_set.contains(&name.to_uppercase()),
      });
    }
  } else {
    let sql = "SELECT column_name, data_type, data_length, nullable, TO_CHAR(data_default) \
               FROM user_tab_columns \
              WHERE table_name = :1 \
              ORDER BY column_id";
    let rows = conn.query(sql, &[&table]).map_err(|e| e.to_string())?;
    for row_result in rows {
      let row = row_result.map_err(|e| e.to_string())?;
      let name: String = row.get(0).map_err(|e| e.to_string())?;
      let data_type: String = row.get(1).map_err(|e| e.to_string())?;
      let data_length: Option<i64> = row.get(2).map_err(|e| e.to_string())?;
      let nullable: String = row.get(3).map_err(|e| e.to_string())?;
      let data_default: Option<String> = row.get(4).map_err(|e| e.to_string())?;
      columns.push(OracleColumnMeta {
        name: name.clone(),
        data_type,
        data_length,
        nullable: nullable == "Y",
        data_default,
        is_primary_key: pk_set.contains(&name.to_uppercase()),
      });
    }
  }

  Ok(OracleTableMeta { schema, table, columns })
}

// Build a SELECT expression suitable for textual comparison based on Oracle data type.
fn select_expr_for_column(col: &OracleColumnMeta) -> String {
  let name = sanitize::normalize_identifier(&col.name).unwrap_or_else(|| col.name.clone());
  let dt = col.data_type.to_uppercase();
  let expr = match dt.as_str() {
    // Text types: use column as-is
    "CHAR" | "VARCHAR2" | "NCHAR" | "NVARCHAR2" => format!("{}", name),
    // Numeric: convert to text
    "NUMBER" => format!("TO_CHAR({})", name),
    // Date/time types: canonicalize format
    "DATE" => format!("TO_CHAR({}, 'YYYY-MM-DD HH24:MI:SS')", name),
    dt if dt.starts_with("TIMESTAMP") => format!("TO_CHAR({}, 'YYYY-MM-DD HH24:MI:SS.FF')", name),
    // Large text
    "CLOB" => format!("DBMS_LOB.SUBSTR({}, 4000, 1)", name),
    // Binary/RAW types: represent deterministically
    "BLOB" => "'[BINARY DATA]'".to_string(),
    "RAW" => format!("RAWTOHEX({})", name),
    // Fallback: attempt textual conversion
    _ => format!("TO_CHAR({})", name),
  };
  // Alias to the original column name in uppercase (stable key)
  let alias = sanitize::normalize_identifier(&col.name).unwrap_or_else(|| col.name.to_uppercase());
  format!("{} AS {}", expr, alias)
}

// Fetch rows from a table for comparison, returning (pk_columns, selected_fields, rows_by_key)
pub fn fetch_rows_for_comparison(
  cm: &CredentialManager,
  cfg: &OracleConnectionConfig,
  schema: Option<&str>,
  table: &str,
  fields: Option<&[String]>,
  where_clause: Option<&str>,
) -> Result<(Vec<String>, Vec<String>, std::collections::HashMap<String, std::collections::HashMap<String, Option<String>>>), String> {
  let table = sanitize::normalize_identifier(table).ok_or_else(|| "Invalid table identifier".to_string())?;
  let schema = match schema.or_else(|| cfg.schema.as_deref()) {
    Some(s) => Some(sanitize::normalize_identifier(s).ok_or_else(|| "Invalid schema identifier".to_string())?),
    None => None,
  };

  if let Some(clause) = where_clause {
    if sanitize::is_suspicious_where_clause(clause) {
      return Err("Suspicious WHERE clause detected".to_string());
    }
  }

  let conn = connect(cm, cfg)?;

  // Build column metadata
  let pk_set = fetch_pk_columns(&conn, schema.as_deref(), &table)?;
  let mut all_columns: Vec<OracleColumnMeta> = Vec::new();
  if let Some(owner) = schema.as_deref() {
    let sql = "SELECT column_name, data_type, data_length, nullable, TO_CHAR(data_default) \
               FROM all_tab_columns \
              WHERE table_name = :1 AND owner = :2 \
              ORDER BY column_id";
    let rows = conn.query(sql, &[&table, &owner]).map_err(|e| e.to_string())?;
    for row_result in rows {
      let row = row_result.map_err(|e| e.to_string())?;
      let name: String = row.get(0).map_err(|e| e.to_string())?;
      let data_type: String = row.get(1).map_err(|e| e.to_string())?;
      let data_length: Option<i64> = row.get(2).map_err(|e| e.to_string())?;
      let nullable: String = row.get(3).map_err(|e| e.to_string())?;
      let data_default: Option<String> = row.get(4).map_err(|e| e.to_string())?;
      all_columns.push(OracleColumnMeta {
        name: name.clone(),
        data_type,
        data_length,
        nullable: nullable == "Y",
        data_default,
        is_primary_key: pk_set.contains(&name.to_uppercase()),
      });
    }
  } else {
    let sql = "SELECT column_name, data_type, data_length, nullable, TO_CHAR(data_default) \
               FROM user_tab_columns \
              WHERE table_name = :1 \
              ORDER BY column_id";
    let rows = conn.query(sql, &[&table]).map_err(|e| e.to_string())?;
    for row_result in rows {
      let row = row_result.map_err(|e| e.to_string())?;
      let name: String = row.get(0).map_err(|e| e.to_string())?;
      let data_type: String = row.get(1).map_err(|e| e.to_string())?;
      let data_length: Option<i64> = row.get(2).map_err(|e| e.to_string())?;
      let nullable: String = row.get(3).map_err(|e| e.to_string())?;
      let data_default: Option<String> = row.get(4).map_err(|e| e.to_string())?;
      all_columns.push(OracleColumnMeta {
        name: name.clone(),
        data_type,
        data_length,
        nullable: nullable == "Y",
        data_default,
        is_primary_key: pk_set.contains(&name.to_uppercase()),
      });
    }
  }

  // Determine selected fields and their metadata
  let mut col_map: std::collections::HashMap<String, OracleColumnMeta> = std::collections::HashMap::new();
  for c in &all_columns { col_map.insert(c.name.to_uppercase(), c.clone()); }

  let selected_fields: Vec<String> = if let Some(list) = fields {
    let mut v = Vec::new();
    for f in list {
      let norm = sanitize::normalize_identifier(f).ok_or_else(|| format!("Invalid column identifier: {}", f))?;
      let up = norm.to_uppercase();
      if !col_map.contains_key(&up) {
        return Err(format!("Column not found: {}", up));
      }
      v.push(up);
    }
    v
  } else {
    all_columns.iter().map(|c| c.name.to_uppercase()).collect()
  };

  // Build PK column list; fallback to first selected field if none
  let mut pk_cols: Vec<String> = all_columns.iter()
    .filter(|c| c.is_primary_key)
    .map(|c| c.name.to_uppercase())
    .collect();
  if pk_cols.is_empty() {
    if let Some(first) = selected_fields.get(0) {
      pk_cols.push(first.clone());
    }
  }

  // SELECT list
  let select_exprs: Vec<String> = selected_fields.iter()
    .map(|name| {
      let meta = col_map.get(name).expect("selected field must exist in metadata");
      select_expr_for_column(meta)
    })
    .collect();

  let from_qualifier = if let Some(owner) = schema.as_deref() {
    format!("{}.{}", owner, table)
  } else {
    table.clone()
  };

  let mut sql = format!("SELECT {} FROM {}", select_exprs.join(", "), from_qualifier);
  if let Some(clause) = where_clause { if !clause.trim().is_empty() { sql.push_str(&format!(" WHERE {}", clause)); } }

  let mut rows_by_key: std::collections::HashMap<String, std::collections::HashMap<String, Option<String>>> = std::collections::HashMap::new();
  let rows = conn.query(&sql, &[]).map_err(|e| e.to_string())?;
  for row_result in rows {
    let row = row_result.map_err(|e| e.to_string())?;
    let mut data: std::collections::HashMap<String, Option<String>> = std::collections::HashMap::new();
    for (idx, name) in selected_fields.iter().enumerate() {
      let value: Option<String> = row.get(idx).map_err(|e| e.to_string())?;
      data.insert(name.clone(), value);
    }
    // Build composite key
    let mut key_parts: Vec<String> = Vec::new();
    for pk in &pk_cols {
      let v = data.get(pk).cloned().flatten().unwrap_or_else(|| "NULL".to_string());
      key_parts.push(format!("{}={}", pk, v));
    }
    let key = key_parts.join("|");
    rows_by_key.insert(key, data);
  }

  Ok((pk_cols, selected_fields, rows_by_key))
}