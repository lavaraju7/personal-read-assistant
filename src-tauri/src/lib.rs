use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::Manager;

struct GemmaRuntimeState {
  child: Mutex<Option<Child>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LibraryDocument {
  id: String,
  title: String,
  format: String,
  file_path: String,
  added_at: String,
  last_opened_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BundledGemmaConfig {
  provider: String,
  endpoint: String,
  model: String,
  model_file_name: String,
  runtime_file_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CloudModelConfig {
  provider: String,
  api_base_url: String,
  model: String,
  api_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalModelConfig {
  provider: String,
  endpoint: String,
  model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HybridModelConfig {
  mode: String,
  #[serde(default = "default_gemma_config")]
  gemma: BundledGemmaConfig,
  cloud: CloudModelConfig,
  local: LocalModelConfig,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderStatus {
  mode: String,
  configured: bool,
  message: String,
}

#[derive(Serialize)]
struct LlamaCompletionRequest {
  prompt: String,
  temperature: f32,
  n_predict: u32,
  stream: bool,
  stop: Vec<String>,
}

#[derive(Deserialize)]
struct LlamaCompletionResponse {
  content: Option<String>,
}

fn default_model_config() -> HybridModelConfig {
  HybridModelConfig {
    mode: "bundled-gemma".to_string(),
    gemma: default_gemma_config(),
    cloud: CloudModelConfig {
      provider: "openai-compatible".to_string(),
      api_base_url: "https://api.openai.com/v1".to_string(),
      model: "gpt-4.1-mini".to_string(),
      api_key: "".to_string(),
    },
    local: LocalModelConfig {
      provider: "ollama-compatible".to_string(),
      endpoint: "http://127.0.0.1:11434".to_string(),
      model: "llama3.1:8b".to_string(),
    },
  }
}

fn default_gemma_config() -> BundledGemmaConfig {
  BundledGemmaConfig {
    provider: "bundled-gemma".to_string(),
    endpoint: "http://127.0.0.1:17641".to_string(),
    model: "gemma-3-1b-it-q4".to_string(),
    model_file_name: "gemma-3-1b-it-q4.gguf".to_string(),
    runtime_file_name: "gemma-server.exe".to_string(),
  }
}

fn model_config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  let app_data_dir = app
    .path()
    .app_data_dir()
    .map_err(|err| format!("failed to resolve app data dir: {err}"))?;
  fs::create_dir_all(&app_data_dir)
    .map_err(|err| format!("failed to create app data dir: {err}"))?;
  Ok(app_data_dir.join("model-config.json"))
}

fn read_model_config(app: &tauri::AppHandle) -> Result<HybridModelConfig, String> {
  let config_path = model_config_path(app)?;
  if !config_path.exists() {
    return Ok(default_model_config());
  }

  let raw = fs::read_to_string(&config_path)
    .map_err(|err| format!("failed to read model config: {err}"))?;
  serde_json::from_str::<HybridModelConfig>(&raw)
    .map_err(|err| format!("invalid model config JSON: {err}"))
}

fn validate_model_config(config: &HybridModelConfig) -> Result<(), String> {
  if config.mode != "bundled-gemma" && config.mode != "cloud" && config.mode != "local" {
    return Err("mode must be 'bundled-gemma', 'cloud', or 'local'".to_string());
  }

  if config.gemma.endpoint.trim().is_empty() {
    return Err("Gemma endpoint cannot be empty".to_string());
  }
  if config.gemma.model.trim().is_empty() {
    return Err("Gemma model cannot be empty".to_string());
  }
  if config.gemma.model_file_name.trim().is_empty() {
    return Err("Gemma modelFileName cannot be empty".to_string());
  }
  if config.gemma.runtime_file_name.trim().is_empty() {
    return Err("Gemma runtimeFileName cannot be empty".to_string());
  }

  if config.cloud.model.trim().is_empty() {
    return Err("cloud model cannot be empty".to_string());
  }
  if config.cloud.api_base_url.trim().is_empty() {
    return Err("cloud apiBaseUrl cannot be empty".to_string());
  }
  if config.local.endpoint.trim().is_empty() {
    return Err("local endpoint cannot be empty".to_string());
  }
  if config.local.model.trim().is_empty() {
    return Err("local model cannot be empty".to_string());
  }
  Ok(())
}

fn bundled_gemma_dirs(app: &tauri::AppHandle) -> Vec<PathBuf> {
  let mut dirs = Vec::new();

  if let Ok(resource_dir) = app.path().resource_dir() {
    dirs.push(resource_dir.join("gemma"));
    dirs.push(resource_dir.join("resources").join("gemma"));
  }

  dirs.push(
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
      .join("resources")
      .join("gemma"),
  );

  dirs
}

fn resolve_bundled_gemma_file(app: &tauri::AppHandle, file_name: &str) -> Option<PathBuf> {
  bundled_gemma_dirs(app)
    .into_iter()
    .map(|dir| dir.join(file_name))
    .find(|path| path.exists())
}

fn parse_gemma_endpoint(config: &BundledGemmaConfig) -> Result<(String, String, String), String> {
  let url = reqwest::Url::parse(&config.endpoint)
    .map_err(|err| format!("invalid Gemma endpoint '{}': {err}", config.endpoint))?;
  let host = url
    .host_str()
    .ok_or_else(|| "Gemma endpoint must include a host".to_string())?
    .to_string();
  let port = url
    .port_or_known_default()
    .ok_or_else(|| "Gemma endpoint must include a port".to_string())?
    .to_string();
  Ok((url.as_str().trim_end_matches('/').to_string(), host, port))
}

fn is_gemma_server_reachable(endpoint_base: &str) -> bool {
  let health_urls = [
    format!("{endpoint_base}/health"),
    format!("{endpoint_base}/props"),
  ];

  health_urls.iter().any(|url| {
    reqwest::blocking::Client::builder()
      .timeout(Duration::from_millis(700))
      .build()
      .ok()
      .and_then(|client| client.get(url).send().ok())
      .is_some_and(|response| response.status().is_success())
  })
}

fn start_bundled_gemma_server(
  app: &tauri::AppHandle,
  config: &BundledGemmaConfig,
  state: &GemmaRuntimeState,
) -> Result<String, String> {
  let (endpoint_base, host, port) = parse_gemma_endpoint(config)?;
  if is_gemma_server_reachable(&endpoint_base) {
    return Ok(endpoint_base);
  }

  let runtime_path = resolve_bundled_gemma_file(app, &config.runtime_file_name)
    .ok_or_else(|| format!("missing Gemma runtime {}", config.runtime_file_name))?;
  let model_path = resolve_bundled_gemma_file(app, &config.model_file_name)
    .ok_or_else(|| format!("missing Gemma model {}", config.model_file_name))?;

  let mut child_guard = state
    .child
    .lock()
    .map_err(|_| "failed to lock Gemma runtime state".to_string())?;

  let needs_spawn = match child_guard.as_mut() {
    Some(child) => child
      .try_wait()
      .map_err(|err| format!("failed to inspect Gemma runtime: {err}"))?
      .is_some(),
    None => true,
  };

  if needs_spawn {
    let child = Command::new(&runtime_path)
      .arg("--model")
      .arg(&model_path)
      .arg("--host")
      .arg(&host)
      .arg("--port")
      .arg(&port)
      .arg("--ctx-size")
      .arg("4096")
      .stdin(Stdio::null())
      .stdout(Stdio::null())
      .stderr(Stdio::null())
      .spawn()
      .map_err(|err| {
        format!(
          "failed to start Gemma runtime '{}': {err}",
          runtime_path.display()
        )
      })?;
    *child_guard = Some(child);
  }

  drop(child_guard);

  for _ in 0..30 {
    if is_gemma_server_reachable(&endpoint_base) {
      return Ok(endpoint_base);
    }
    thread::sleep(Duration::from_millis(500));
  }

  Err(format!(
    "Gemma runtime started but did not become ready at {endpoint_base}"
  ))
}

fn build_grounded_prompt(query: &str, context_snippets: &[String]) -> String {
  // Cap each snippet to 300 chars so the tiny 1B model doesn't overflow its context window
  let context = context_snippets
    .iter()
    .take(5)
    .enumerate()
    .map(|(index, snippet)| {
      let trimmed = snippet.trim();
      let capped = if trimmed.len() > 300 { &trimmed[..300] } else { trimmed };
      format!("[{}] {}", index + 1, capped)
    })
    .collect::<Vec<String>>()
    .join("\n");

  format!(
    "<start_of_turn>user\nYou are a reading assistant. Using ONLY the numbered passages below, answer the question. Rules:\n1. Only state facts DIRECTLY AND EXPLICITLY written in the passages.\n2. Do NOT infer, guess, or assume anything not literally in the text.\n3. These passages are a small sample of the full document. For questions about the whole story (e.g. how many characters, total count), always note that your answer is limited to the retrieved passages, not the complete text.\n4. If the answer is not in the passages at all, write: Not found in the provided passages.\n\nPassages:\n{context}\n\nQuestion: {query}<end_of_turn>\n<start_of_turn>model\nBased on these passages, "
  )
}

fn call_gemma_completion(
  endpoint_base: &str,
  query: &str,
  context_snippets: &[String],
) -> Result<String, String> {
  let prompt = build_grounded_prompt(query, context_snippets);
  let request = LlamaCompletionRequest {
    prompt,
    temperature: 0.05,
    n_predict: 256,
    stream: false,
    // Stop at end-of-turn or if the model starts echoing the next user turn
    stop: vec![
      "<end_of_turn>".to_string(),
      "<start_of_turn>".to_string(),
      "\nQuestion:".to_string(),
      "\nPassages:".to_string(),
    ],
  };

  let response = reqwest::blocking::Client::builder()
    .timeout(Duration::from_secs(120))
    .build()
    .map_err(|err| format!("failed to create Gemma HTTP client: {err}"))?
    .post(format!("{endpoint_base}/completion"))
    .json(&request)
    .send()
    .map_err(|err| format!("failed to call Gemma completion endpoint: {err}"))?;

  if !response.status().is_success() {
    let status = response.status();
    let body = response.text().unwrap_or_else(|_| "".to_string());
    return Err(format!("Gemma completion failed ({status}): {body}"));
  }

  let payload = response
    .json::<LlamaCompletionResponse>()
    .map_err(|err| format!("failed to parse Gemma completion response: {err}"))?;

  let raw = payload
    .content
    .unwrap_or_else(|| "Gemma returned no text.".to_string());

  // The completion was seeded with "Based on these passages, " — prepend it back
  // for a coherent full-sentence output.
  let trimmed = raw.trim();
  let not_found = trimmed.is_empty()
    || trimmed.starts_with("Not found in the provided passages")
    || trimmed.starts_with("Not found");
  let answer = if not_found {
    if trimmed.is_empty() {
      "Not found in the provided passages.".to_string()
    } else {
      trimmed.to_string()
    }
  } else {
    format!("Based on these passages, {trimmed}")
  };

  Ok(answer)
}

fn provider_status(app: &tauri::AppHandle, config: &HybridModelConfig) -> ProviderStatus {
  if config.mode == "bundled-gemma" {
    let runtime_path = resolve_bundled_gemma_file(app, &config.gemma.runtime_file_name);
    let model_path = resolve_bundled_gemma_file(app, &config.gemma.model_file_name);
    let runtime_exists = runtime_path.is_some();
    let model_exists = model_path.is_some();

    return ProviderStatus {
      mode: "bundled-gemma".to_string(),
      configured: runtime_exists && model_exists,
      message: if runtime_exists && model_exists {
        format!("Bundled Gemma ready ({})", config.gemma.model)
      } else {
        let mut missing_files = Vec::new();
        if !runtime_exists {
          missing_files.push(config.gemma.runtime_file_name.as_str());
        }
        if !model_exists {
          missing_files.push(config.gemma.model_file_name.as_str());
        }
        format!(
          "Bundled Gemma missing: {} in resources/gemma",
          missing_files.join(", ")
        )
      },
    };
  }

  let cloud_configured = !config.cloud.api_key.trim().is_empty()
    && !config.cloud.model.trim().is_empty()
    && !config.cloud.api_base_url.trim().is_empty();
  let local_configured =
    !config.local.endpoint.trim().is_empty() && !config.local.model.trim().is_empty();

  if config.mode == "local" {
    return ProviderStatus {
      mode: "local".to_string(),
      configured: local_configured,
      message: if local_configured {
        format!("Local provider ready ({})", config.local.model)
      } else {
        "Local provider is missing endpoint or model".to_string()
      },
    };
  }

  ProviderStatus {
    mode: "cloud".to_string(),
    configured: cloud_configured,
    message: if cloud_configured {
      format!("Cloud provider ready ({})", config.cloud.model)
    } else {
      "Cloud provider is missing API key, model, or base URL".to_string()
    },
  }
}

#[tauri::command]
fn health_check() -> String {
  "ok".to_string()
}

#[tauri::command]
fn get_library_docs() -> Vec<LibraryDocument> {
  Vec::new()
}

#[tauri::command]
fn get_model_config(app: tauri::AppHandle) -> Result<HybridModelConfig, String> {
  read_model_config(&app)
}

#[tauri::command]
fn save_model_config(
  app: tauri::AppHandle,
  config: HybridModelConfig,
) -> Result<HybridModelConfig, String> {
  validate_model_config(&config)?;
  let path = model_config_path(&app)?;
  let json = serde_json::to_string_pretty(&config)
    .map_err(|err| format!("failed to serialize model config: {err}"))?;
  fs::write(path, json).map_err(|err| format!("failed to write model config: {err}"))?;
  Ok(config)
}

#[tauri::command]
fn get_model_provider_status(app: tauri::AppHandle) -> Result<ProviderStatus, String> {
  let config = read_model_config(&app)?;
  Ok(provider_status(&app, &config))
}

#[tauri::command]
fn generate_grounded_response(
  app: tauri::AppHandle,
  state: tauri::State<GemmaRuntimeState>,
  query: String,
  context_snippets: Vec<String>,
) -> Result<String, String> {
  let config = read_model_config(&app)?;
  let status = provider_status(&app, &config);
  if !status.configured {
    return Err(status.message);
  }

  if context_snippets.is_empty() {
    return Ok("No in-library context was retrieved for this query.".to_string());
  }

  if config.mode == "bundled-gemma" {
    let endpoint_base = start_bundled_gemma_server(&app, &config.gemma, &state)?;
    return call_gemma_completion(&endpoint_base, &query, &context_snippets);
  }

  let top_context = context_snippets
    .iter()
    .take(3)
    .map(|snippet| format!("- {snippet}"))
    .collect::<Vec<String>>()
    .join("\n");

  let provider_label = if config.mode == "bundled-gemma" {
    format!("bundled Gemma model '{}'", config.gemma.model)
  } else if config.mode == "local" {
    format!(
      "local model '{}' at {}",
      config.local.model, config.local.endpoint
    )
  } else {
    format!(
      "cloud model '{}' at {}",
      config.cloud.model, config.cloud.api_base_url
    )
  };

  Ok(format!(
    "Using {provider_label}, grounded strictly on retrieved library passages for query \"{query}\":\n{top_context}\n\n(Next step: replace this deterministic responder with live LLM completion call while preserving strict grounding.)"
  ))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(GemmaRuntimeState {
      child: Mutex::new(None),
    })
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      health_check,
      get_library_docs,
      get_model_config,
      save_model_config,
      get_model_provider_status,
      generate_grounded_response
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
