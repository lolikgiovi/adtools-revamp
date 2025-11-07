// Minimal sanitization helpers for identifiers and where clause

pub fn is_safe_identifier(id: &str) -> bool {
  // Allow letters, numbers, underscore; optional dot for schema.table
  // Disallow quotes, spaces, semicolons, comment markers
  if id.is_empty() || id.len() > 128 { return false; }
  let mut dot_count = 0;
  for ch in id.chars() {
    match ch {
      'A'..='Z' | 'a'..='z' | '0'..='9' | '_' => {}
      '.' => { dot_count += 1; if dot_count > 1 { return false; } }
      _ => return false,
    }
  }
  true
}

pub fn normalize_identifier(id: &str) -> Option<String> {
  let trimmed = id.trim();
  if !is_safe_identifier(trimmed) { return None; }
  Some(trimmed.to_uppercase())
}

pub fn is_suspicious_where_clause(where_clause: &str) -> bool {
  let lc = where_clause.to_lowercase();
  // Block dangerous tokens and comment markers
  let blocked = [";", "--", "/*", "*/", "alter ", "drop ", "truncate ", "insert ", "update ", "delete ", "merge ", "grant ", "revoke ", "create ", "execute ", "call "];
  blocked.iter().any(|b| lc.contains(b))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_is_safe_identifier_basic() {
    assert!(is_safe_identifier("APP_CONFIG"));
    assert!(is_safe_identifier("app_config"));
    assert!(is_safe_identifier("SCHEMA.TABLE"));
    assert!(!is_safe_identifier("SCHEMA.TABLE.EXTRA")); // more than one dot
    assert!(!is_safe_identifier("APP CONFIG")); // space not allowed
    assert!(!is_safe_identifier("APP-CONFIG")); // dash not allowed
    assert!(!is_safe_identifier("APP\"CONFIG")); // quote not allowed
  }

  #[test]
  fn test_normalize_identifier_uppercase_trim() {
    assert_eq!(normalize_identifier("  app_config  "), Some("APP_CONFIG".to_string()));
    assert_eq!(normalize_identifier("schema.table"), Some("SCHEMA.TABLE".to_string()));
    assert_eq!(normalize_identifier("bad id"), None);
  }

  #[test]
  fn test_is_suspicious_where_clause_detection() {
    assert_eq!(is_suspicious_where_clause("KEY = 'X'"), false);
    assert_eq!(is_suspicious_where_clause("KEY IN ('A','B')"), false);
    assert_eq!(is_suspicious_where_clause("DROP TABLE USERS"), true);
    assert_eq!(is_suspicious_where_clause("name LIKE 'x%' -- comment"), true);
    assert_eq!(is_suspicious_where_clause("/* injection */ id = 1"), true);
  }
}