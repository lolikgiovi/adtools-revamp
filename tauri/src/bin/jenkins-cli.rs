use std::env;
use std::fs;

use ad_tools_lib::{jenkins, load_credentials};
use reqwest::Client;
use keyring::Entry;

const KEYCHAIN_SERVICE: &str = "ad-tools:jenkins";

/// Read Jenkins username from keychain (for CLI use - no localStorage available)
fn get_username_from_keychain() -> Result<String, String> {
  let entry = Entry::new(KEYCHAIN_SERVICE, "__username__").map_err(|e| e.to_string())?;
  entry.get_password().map_err(|e| format!("Username not found in keychain: {}", e))
}

fn main() {
  tauri::async_runtime::block_on(async_main());
}

async fn async_main() {
  let mut args: Vec<String> = env::args().collect();
  if args.len() < 2 {
    print_usage();
    return;
  }
  // drop program name
  args.remove(0);
  let cmd = args.remove(0);

  match cmd.as_str() {
    "env-choices" => {
      if args.len() != 2 { print_usage(); return; }
      let base_url = &args[0];
      let job = &args[1];
      run_env_choices(base_url, job).await;
    }
    "trigger-job" => {
      if args.len() < 3 { print_usage(); return; }
      let base_url = args[0].clone();
      let job = args[1].clone();
      let env_name = args[2].clone();
      let mut sql_text: Option<String> = None;
      let mut i = 3;
      while i < args.len() {
        match args[i].as_str() {
          "--sql" => {
            i += 1; if i < args.len() { sql_text = Some(args[i].clone()); } else { eprintln!("--sql requires a value"); return; }
          }
          "--sql-file" => {
            i += 1; if i < args.len() { sql_text = fs::read_to_string(&args[i]).ok(); } else { eprintln!("--sql-file requires a path"); return; }
          }
          other => { eprintln!("Unknown arg: {}", other); print_usage(); return; }
        }
        i += 1;
      }
      let sql_text = sql_text.unwrap_or_else(|| "SELECT 1".to_string());
      run_trigger_job(&base_url, &job, &env_name, &sql_text).await;
    }
    "poll-queue" => {
      if args.len() != 1 { print_usage(); return; }
      let queue_url = &args[0];
      run_poll_queue(queue_url).await;
    }
    "stream-logs" => {
      if args.len() != 3 { print_usage(); return; }
      let base_url = &args[0];
      let job = &args[1];
      let build_number: u64 = args[2].parse().expect("build_number must be a number");
      run_stream_logs(base_url, job, build_number).await;
    }
    _ => { print_usage(); }
  }
}

fn print_usage() {
  eprintln!("Jenkins CLI\n\nCommands:\n  env-choices <base_url> <job>\n  trigger-job <base_url> <job> <env> [--sql <text>] [--sql-file <path>]\n  poll-queue <queue_url>\n  stream-logs <base_url> <job> <build_number>");
}

fn client() -> Client { Client::builder().build().unwrap() }

async fn run_env_choices(base_url: &str, job: &str) {
  match get_username_from_keychain() {
    Ok(username) => match load_credentials(username).await {
      Ok(creds) => match jenkins::fetch_env_choices(&client(), base_url, job, &creds).await {
        Ok(choices) => {
          for c in choices { println!("{}", c); }
        }
        Err(e) => eprintln!("Error: {}", e),
      },
      Err(e) => eprintln!("Credentials error: {}", e),
    },
    Err(e) => eprintln!("Credentials error: {}", e),
  }
}

async fn run_trigger_job(base_url: &str, job: &str, env_name: &str, sql_text: &str) {
  match get_username_from_keychain() {
    Ok(username) => match load_credentials(username).await {
      Ok(creds) => match jenkins::trigger_job(&client(), base_url, job, env_name, sql_text, &creds).await {
        Ok(queue_url) => println!("{}", queue_url),
        Err(e) => eprintln!("Error: {}", e),
      },
      Err(e) => eprintln!("Credentials error: {}", e),
    },
    Err(e) => eprintln!("Credentials error: {}", e),
  }
}

async fn run_poll_queue(queue_url: &str) {
  match get_username_from_keychain() {
    Ok(username) => match load_credentials(username).await {
      Ok(creds) => match jenkins::poll_queue_for_build(&client(), queue_url, &creds).await {
        Ok((num, url)) => println!("number={:?} url={:?}", num, url),
        Err(e) => eprintln!("Error: {}", e),
      },
      Err(e) => eprintln!("Credentials error: {}", e),
    },
    Err(e) => eprintln!("Credentials error: {}", e),
  }
}

async fn run_stream_logs(base_url: &str, job: &str, build_number: u64) {
  match get_username_from_keychain() {
    Ok(username) => match load_credentials(username).await {
      Ok(creds) => {
        let mut start: u64 = 0;
        loop {
          match jenkins::progressive_log_once(&client(), base_url, job, build_number, start, &creds).await {
            Ok((text, next, more)) => {
              print!("{}", text);
              if !more { break; }
              start = next;
            }
            Err(e) => { eprintln!("Error: {}", e); break; }
          }
          tokio::time::sleep(std::time::Duration::from_millis(800)).await;
        }
      }
      Err(e) => eprintln!("Credentials error: {}", e),
    },
    Err(e) => eprintln!("Credentials error: {}", e),
  }
}