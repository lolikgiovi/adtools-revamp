use reqwest::{Client, StatusCode};
use serde::Deserialize;
use chrono::{Datelike, Local};

pub struct Credentials {
  pub username: String,
  pub token: String,
}

#[derive(Deserialize)]
struct JobInfo { property: Option<Vec<JobProperty>> }

#[derive(Deserialize)]
struct JobProperty { #[serde(rename = "parameterDefinitions", default)] parameter_definitions: Vec<JobParamDefinition> }

#[derive(Deserialize)]
#[serde(tag = "_class")]
enum JobParamDefinition {
  #[serde(rename = "hudson.model.ChoiceParameterDefinition")]
  Choice { name: String, #[serde(default)] choices: Vec<String> },
  #[serde(other)] Other,
}

pub async fn fetch_env_choices(client: &Client, base_url: &str, job: &str, creds: &Credentials) -> Result<Vec<String>, String> {
  let url = format!("{}/job/{}/api/json", base_url.trim_end_matches('/'), job);
  let res = client
    .get(&url)
    .basic_auth(&creds.username, Some(&creds.token))
    .send()
    .await
    .map_err(|e| e.to_string())?;
  if !res.status().is_success() { return Err(format!("HTTP {}", res.status())); }
  let info: JobInfo = res.json().await.map_err(|e| e.to_string())?;
  let mut env_choices = vec![];
  if let Some(props) = info.property {
    for p in props {
      for def in p.parameter_definitions {
        if let JobParamDefinition::Choice { name, choices } = def {
          if name == "ENV" { env_choices = choices; }
        }
      }
    }
  }
  Ok(env_choices)
}

pub async fn trigger_job(client: &Client, base_url: &str, job: &str, env: &str, sql_text: &str, creds: &Credentials) -> Result<String, String> {
  let lowered = sql_text.to_lowercase();
  for kw in ["insert","update","delete","alter","drop","truncate"] {
    if lowered.contains(kw) { return Err("SQL contains forbidden statements".into()); }
  }

  // Build dynamic filename: username_adtools_yyyy_mm_dd.sql
  let username_raw = std::env::var("USER").or_else(|_| std::env::var("USERNAME")).unwrap_or_else(|_| "user".to_string());
  let username: String = username_raw
    .chars()
    .map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c.to_ascii_lowercase() } else { '_' })
    .collect();
  let today = Local::now().date_naive();
  let filename = format!("{}_adtools_{:04}_{:02}_{:02}.sql", username, today.year(), today.month(), today.day());

  let file_part = reqwest::multipart::Part::bytes(sql_text.as_bytes().to_vec())
    .file_name(filename)
    .mime_str("application/sql")
    .unwrap();
  let form = reqwest::multipart::Form::new().text("ENV", env.to_string()).part("INPUT_FILE", file_part);

  let base = base_url.trim_end_matches('/');
  let url = format!("{}/job/{}/buildWithParameters", base, job);
  let mut req = client
    .post(&url)
    .basic_auth(&creds.username, Some(&creds.token))
    .multipart(form);

  // Try crumb issuer; ignore failures
  let crumb_url = format!("{}/crumbIssuer/api/json", base);
  if let Ok(r) = client
    .get(&crumb_url)
    .basic_auth(&creds.username, Some(&creds.token))
    .send()
    .await
  {
    if r.status().is_success() {
      if let Ok(v) = r.json::<serde_json::Value>().await {
        if let (Some(field), Some(crumb)) = (
          v.get("crumbRequestField").and_then(|x| x.as_str()),
          v.get("crumb").and_then(|x| x.as_str()),
        ) {
          req = req.header(field, crumb);
        }
      }
    }
  }

  let res = req.send().await.map_err(|e| e.to_string())?;
  if res.status() != StatusCode::CREATED { return Err(format!("Trigger failed: HTTP {}", res.status())); }
  let loc = res
    .headers()
    .get(reqwest::header::LOCATION)
    .and_then(|v| v.to_str().ok())
    .ok_or_else(|| "Missing Location header".to_string())?;
  let q = format!("{}/api/json", loc.trim_end_matches('/'));
  Ok(q)
}

pub async fn poll_queue_for_build(client: &Client, queue_url: &str, creds: &Credentials) -> Result<(Option<u64>, Option<String>), String> {
  let res = client
    .get(queue_url)
    .basic_auth(&creds.username, Some(&creds.token))
    .send()
    .await
    .map_err(|e| e.to_string())?;
  if !res.status().is_success() { return Err(format!("HTTP {}", res.status())); }
  let v: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
  let build_number = v.get("executable").and_then(|e| e.get("number")).and_then(|n| n.as_u64());
  let executable_url = v.get("executable").and_then(|e| e.get("url")).and_then(|u| u.as_str()).map(|s| s.to_string());
  Ok((build_number, executable_url))
}

pub async fn progressive_log_once(client: &Client, base_url: &str, job: &str, build_number: u64, start: u64, creds: &Credentials) -> Result<(String, u64, bool), String> {
  let base = base_url.trim_end_matches('/');
  let url = format!("{}/job/{}/{}/logText/progressiveText?start={}", base, job, build_number, start);
  let req = client
    .get(&url)
    .basic_auth(&creds.username, Some(&creds.token));
  let res = req.send().await.map_err(|e| e.to_string())?;
  if !res.status().is_success() { return Err(format!("HTTP {}", res.status())); }
  let headers = res.headers().clone();
  let text = res.text().await.map_err(|e| e.to_string())?;
  let next = headers
    .get("X-Text-Size")
    .and_then(|v| v.to_str().ok())
    .and_then(|s| s.parse::<u64>().ok())
    .unwrap_or(start);
  let more = headers
    .get("X-More-Data")
    .and_then(|v| v.to_str().ok())
    .map(|s| s == "true")
    .unwrap_or(false);
  Ok((text, next, more))
}

#[cfg(test)]
mod tests {
  use super::*;
  use httpmock::prelude::*;

  fn client() -> Client { Client::builder().build().unwrap() }

  #[tokio::test]
  async fn parses_env_choices() {
    let server = MockServer::start();
    let body = serde_json::json!({
      "property": [{
        "parameterDefinitions": [
          {"_class":"hudson.model.ChoiceParameterDefinition","name":"ENV","choices":["DEV","QA","PROD"]},
          {"_class":"hudson.model.StringParameterDefinition","name":"OTHER","default":"x"}
        ]
      }]
    });
    let _m = server.mock(|when, then| {
      when.method(GET).path("/job/TEST/api/json");
      then.status(200).json_body(body);
    });
    let creds = Credentials { username: "u".into(), token: "t".into() };
    let choices = fetch_env_choices(&client(), &server.base_url(), "TEST", &creds).await.unwrap();
    assert_eq!(choices, vec!["DEV","QA","PROD"]);
  }

  #[tokio::test]
  async fn trigger_job_returns_queue_url() {
    let server = MockServer::start();
    let _m = server.mock(|when, then| {
      when.method(POST).path("/job/JOB/buildWithParameters");
      then.status(201).header("Location", format!("{}/queue/item/123/", server.base_url()));
    });
    let creds = Credentials { username: "u".into(), token: "t".into() };
    let q = trigger_job(&client(), &server.base_url(), "JOB", "DEV", "SELECT 1", &creds).await.unwrap();
    assert!(q.ends_with("/queue/item/123/api/json"));
  }

  #[tokio::test]
  async fn poll_queue_parses_values() {
    let server = MockServer::start();
    let body = serde_json::json!({
      "executable": {"number": 42, "url": format!("{}/job/JOB/42/", server.base_url())}
    });
    let _m = server.mock(|when, then| {
      when.method(GET).path("/queue/item/123/api/json");
      then.status(200).json_body(body);
    });
    let creds = Credentials { username: "u".into(), token: "t".into() };
    let (num, url) = poll_queue_for_build(&client(), &format!("{}/queue/item/123/api/json", server.base_url()), &creds).await.unwrap();
    assert_eq!(num, Some(42));
    assert!(url.unwrap().ends_with("/job/JOB/42/"));
  }

  #[tokio::test]
  async fn progressive_log_once_parses_headers() {
    let server = MockServer::start();
    let _m = server.mock(|when, then| {
      when.method(GET).path("/job/JOB/42/logText/progressiveText").query_param("start", "0");
      then.status(200).header("X-Text-Size", "10").header("X-More-Data", "true").body("hello");
    });
    let creds = Credentials { username: "u".into(), token: "t".into() };
    let (text, next, more) = progressive_log_once(&client(), &server.base_url(), "JOB", 42, 0, &creds).await.unwrap();
    assert_eq!(text, "hello");
    assert_eq!(next, 10);
    assert!(more);
  }
}