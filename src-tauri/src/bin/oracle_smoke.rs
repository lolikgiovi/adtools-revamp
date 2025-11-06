use std::env;

// Reuse library modules from the app
use ad_tools_lib::oracle::client;
use ad_tools_lib::oracle::credentials::CredentialManager;
use ad_tools_lib::oracle::types::{OracleClientStatus, OracleConnectionConfig};
use ad_tools_lib::oracle::query;

fn print_json<T: serde::Serialize>(value: &T) {
  match serde_json::to_string_pretty(value) {
    Ok(s) => println!("{}", s),
    Err(e) => eprintln!("failed to serialize: {}", e),
  }
}

fn usage() {
  eprintln!(
    "Oracle Smoke CLI\n\n\
    Commands:\n\
      ready                                 Check client detection\n\
      prime                                 Prime environment and load libclntsh.dylib\n\
      set-creds <id> <user> <pass>          Store credentials in macOS Keychain\n\
      get-creds <id>                        Show credential presence for id\n\
      meta --id <id> --host <host> --port <port> --service <service> \\\n+           [--schema <schema>] --table <table>\n\
                                           Fetch table metadata as JSON\n\
      test-conn --id <id> --host <host> --port <port> --service <service>\n\
                                           Attempt connection using stored creds\n\
    "
  );
}

fn cmd_ready() -> i32 {
  let status: OracleClientStatus = client::detect_client();
  print_json(&status);
  0
}

fn cmd_prime() -> i32 {
  match client::prime() {
    Ok(()) => {
      println!("Primed Oracle client environment and loaded libclntsh.dylib");
      0
    }
    Err(e) => {
      eprintln!("Prime failed: {}", e);
      1
    }
  }
}

fn cmd_set_creds(id: &str, user: &str, pass: &str) -> i32 {
  let cm = CredentialManager::new();
  match cm.set(id, user, pass) {
    Ok(()) => {
      println!("Stored credentials for '{}'", id);
      0
    }
    Err(e) => {
      eprintln!("Failed to store credentials: {}", e);
      2
    }
  }
}

fn cmd_get_creds(id: &str) -> i32 {
  let cm = CredentialManager::new();
  match cm.get(id) {
    Ok(status) => {
      print_json(&status);
      0
    }
    Err(e) => {
      eprintln!("Failed to get credentials: {}", e);
      3
    }
  }
}

fn parse_flag(args: &[String], name: &str) -> Option<String> {
  let mut it = args.iter();
  while let Some(tok) = it.next() {
    if tok == name {
      return it.next().cloned();
    }
  }
  None
}

fn cmd_meta(args: &[String]) -> i32 {
  let id = match parse_flag(args, "--id") { Some(v) => v, None => { eprintln!("Missing --id"); return 4; } };
  let host = match parse_flag(args, "--host") { Some(v) => v, None => { eprintln!("Missing --host"); return 4; } };
  let port = match parse_flag(args, "--port") { Some(v) => v, None => { eprintln!("Missing --port"); return 4; } };
  let service = match parse_flag(args, "--service") { Some(v) => v, None => { eprintln!("Missing --service"); return 4; } };
  let schema = parse_flag(args, "--schema");
  let table = match parse_flag(args, "--table") { Some(v) => v, None => { eprintln!("Missing --table"); return 4; } };

  let cfg = OracleConnectionConfig { id, host, port: match port.parse::<u16>() { Ok(p) => p, Err(_) => { eprintln!("Invalid --port"); return 4; } }, service_name: service, schema };

  let cm = CredentialManager::new();
  match query::fetch_table_metadata(&cm, &cfg, cfg.schema.as_deref(), &table) {
    Ok(meta) => { print_json(&meta); 0 }
    Err(e) => { eprintln!("Metadata fetch failed: {}", e); 9 }
  }
}

fn cmd_test_conn(args: &[String]) -> i32 {
  // Required flags
  let id = match parse_flag(args, "--id") { Some(v) => v, None => { eprintln!("Missing --id"); return 4; } };
  let host = match parse_flag(args, "--host") { Some(v) => v, None => { eprintln!("Missing --host"); return 4; } };
  let port = match parse_flag(args, "--port") { Some(v) => v, None => { eprintln!("Missing --port"); return 4; } };
  let service = match parse_flag(args, "--service") { Some(v) => v, None => { eprintln!("Missing --service"); return 4; } };

  // Detect and prime
  let status = client::detect_client();
  if !status.installed {
    eprintln!("Oracle client not detected. Install via scripts/install-oracle-instant-client.sh");
    return 5;
  }
  if let Err(e) = client::prime() {
    eprintln!("Prime failed: {}", e);
    return 6;
  }

  // Load creds
  let cm = CredentialManager::new();
  let (username, password) = match cm.get_secret(&id) {
    Ok(p) => p,
    Err(e) => {
      eprintln!("Failed to load credentials for '{}': {}", id, e);
      return 7;
    }
  };

  // Connect
  let connect_str = format!("{}:{}/{}", host, port, service);
  match oracle::Connection::connect(&username, &password, &connect_str) {
    Ok(conn) => {
      drop(conn);
      println!("Connection succeeded for id '{}' to {}", id, connect_str);
      0
    }
    Err(e) => {
      eprintln!("Connection failed: {}", e);
      8
    }
  }
}

fn main() {
  let args: Vec<String> = env::args().collect();
  if args.len() < 2 {
    usage();
    std::process::exit(1);
  }

  let code = match args[1].as_str() {
    "ready" => cmd_ready(),
    "prime" => cmd_prime(),
    "set-creds" => {
      if args.len() < 5 { eprintln!("Usage: set-creds <id> <user> <pass>"); 2 } else { cmd_set_creds(&args[2], &args[3], &args[4]) }
    }
    "get-creds" => {
      if args.len() < 3 { eprintln!("Usage: get-creds <id>"); 3 } else { cmd_get_creds(&args[2]) }
    }
    "meta" => cmd_meta(&args[2..].to_vec()),
    "test-conn" => cmd_test_conn(&args[2..].to_vec()),
    _ => { usage(); 1 }
  };

  std::process::exit(code);
}