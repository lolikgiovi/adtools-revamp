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