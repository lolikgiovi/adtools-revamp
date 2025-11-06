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
  if !is_safe_identifier(id) { return None; }
  Some(id.trim().to_uppercase())
}

pub fn is_suspicious_where_clause(where_clause: &str) -> bool {
  let lc = where_clause.to_lowercase();
  // Block dangerous tokens and comment markers
  let blocked = [";", "--", "/*", "*/", "alter ", "drop ", "truncate ", "insert ", "update ", "delete ", "merge ", "grant ", "revoke ", "create ", "execute ", "call "];
  blocked.iter().any(|b| lc.contains(b))
}