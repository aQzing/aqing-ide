use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

// ─── 文件系统数据结构 ────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Option<Vec<FileNode>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchResult {
    pub file: String,
    pub line: u32,
    pub text: String,
    pub match_start: usize,
    pub match_end: usize,
}

// ─── AI 配置数据结构 ─────────────────────────────────────────────────────────

/// 支持的 AI 提供商
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AiProvider {
    Openai,
    Anthropic,
    Dashscope, // 通义千问
    Custom,
}

/// AI 请求消息
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

/// Chat 请求参数
#[derive(Debug, Serialize, Deserialize)]
pub struct AiChatRequest {
    pub provider: AiProvider,
    pub api_key: String,
    pub base_url: Option<String>,
    pub model: String,
    pub messages: Vec<ChatMessage>,
    pub stream: bool,
    pub max_tokens: Option<u32>,
    pub temperature: Option<f32>,
}

/// 代码补全请求参数
#[derive(Debug, Serialize, Deserialize)]
pub struct AiCompleteRequest {
    pub provider: AiProvider,
    pub api_key: String,
    pub base_url: Option<String>,
    pub model: String,
    pub prefix: String,   // 光标前文本
    pub suffix: String,   // 光标后文本（可选）
    pub language: String, // 编程语言
    pub max_tokens: Option<u32>,
}

/// 流式事件 payload
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AiStreamEvent {
    pub request_id: String,
    pub delta: String,
    pub done: bool,
    pub error: Option<String>,
}

/// 终端输出 payload
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TerminalOutput {
    pub terminal_id: String,
    pub data: String,
    pub is_stderr: bool,
    pub exit_code: Option<i32>,
}

// ─── Agent 数据结构 ──────────────────────────────────────────────────────────

/// Agent 工具调用
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgentToolCall {
    pub id: String,
    pub name: String,
    pub arguments: String, // JSON 字符串
}

/// Agent 单步响应
#[derive(Debug, Serialize, Deserialize)]
pub struct AgentStepResponse {
    pub content: Option<String>,
    pub tool_calls: Vec<AgentToolCall>,
    pub finish_reason: String, // "stop" | "tool_calls"
}

/// Agent 消息（支持 tool role）
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgentMessage {
    pub role: String,
    pub content: Option<String>,
    pub tool_calls: Option<Vec<serde_json::Value>>,
    pub tool_call_id: Option<String>,
    pub name: Option<String>,
}

// ─── 文件系统辅助函数 ────────────────────────────────────────────────────────

fn read_dir_recursive(path: &Path, depth: u32) -> Result<Vec<FileNode>, String> {
    if depth == 0 {
        return Ok(vec![]);
    }
    let entries = fs::read_dir(path).map_err(|e| format!("读取目录失败: {}", e))?;
    let mut nodes: Vec<FileNode> = entries
        .filter_map(|entry| entry.ok())
        .map(|entry| {
            let entry_path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            let path_str = entry_path.to_string_lossy().replace('\\', "/");
            let is_dir = entry_path.is_dir();
            let children = if is_dir && depth > 1 {
                read_dir_recursive(&entry_path, depth - 1).ok()
            } else if is_dir {
                Some(vec![])
            } else {
                None
            };
            FileNode { name, path: path_str, is_dir, children }
        })
        .collect();
    nodes.sort_by(|a, b| {
        if a.is_dir == b.is_dir {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        } else if a.is_dir {
            std::cmp::Ordering::Less
        } else {
            std::cmp::Ordering::Greater
        }
    });
    Ok(nodes)
}

fn should_skip_dir(name: &str) -> bool {
    matches!(
        name,
        "node_modules" | ".git" | "target" | "dist" | ".next" | "__pycache__" | ".cache"
    )
}

fn search_recursive(
    path: &Path,
    query: &str,
    results: &mut Vec<SearchResult>,
    depth: u32,
    case_sensitive: bool,
    use_regex: bool,
    regex_pattern: Option<&regex::Regex>,
) -> Result<(), String> {
    if depth > 8 || results.len() >= 500 {
        return Ok(());
    }
    let entries = match fs::read_dir(path) {
        Ok(e) => e,
        Err(_) => return Ok(()),
    };
    for entry in entries.filter_map(|e| e.ok()) {
        if results.len() >= 500 {
            break;
        }
        let entry_path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if entry_path.is_dir() {
            if !should_skip_dir(&name) {
                let _ = search_recursive(&entry_path, query, results, depth + 1, case_sensitive, use_regex, regex_pattern);
            }
        } else {
            let ext = entry_path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();
            let text_exts = [
                "ts", "tsx", "js", "jsx", "rs", "py", "json", "css", "scss", "html", "htm",
                "md", "toml", "yaml", "yml", "sh", "txt", "go", "java", "kt", "swift", "c",
                "cpp", "h", "cs", "php", "rb", "lua", "sql", "xml", "svg", "gitignore", "env",
                "lock",
            ];
            if !text_exts.contains(&ext.as_str()) && !ext.is_empty() {
                continue;
            }
            if let Ok(content) = fs::read_to_string(&entry_path) {
                let path_str = entry_path.to_string_lossy().replace('\\', "/");
                for (line_idx, line) in content.lines().enumerate() {
                    if results.len() >= 500 {
                        break;
                    }
                    if use_regex {
                        if let Some(re) = regex_pattern {
                            if let Some(m) = re.find(line) {
                                results.push(SearchResult {
                                    file: path_str.clone(),
                                    line: (line_idx + 1) as u32,
                                    text: line.to_string(),
                                    match_start: m.start(),
                                    match_end: m.end(),
                                });
                            }
                        }
                    } else {
                        let (line_cmp, query_cmp) = if case_sensitive {
                            (line.to_string(), query.to_string())
                        } else {
                            (line.to_lowercase(), query.to_lowercase())
                        };
                        if let Some(pos) = line_cmp.find(&query_cmp) {
                            results.push(SearchResult {
                                file: path_str.clone(),
                                line: (line_idx + 1) as u32,
                                text: line.to_string(),
                                match_start: pos,
                                match_end: pos + query.len(),
                            });
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

// ─── AI 调用辅助函数 ─────────────────────────────────────────────────────────

/// 构建统一的 HTTP 客户端（native-tls，跳过证书验证，适配各类代理服务）
fn build_http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .connect_timeout(std::time::Duration::from_secs(15))
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))
}

/// 获取 OpenAI 兼容协议的 base_url
fn get_openai_base_url(provider: &AiProvider, custom_base_url: &Option<String>) -> String {
    match provider {
        AiProvider::Openai => "https://api.openai.com".to_string(),
        AiProvider::Dashscope => {
            "https://dashscope.aliyuncs.com/compatible-mode".to_string()
        }
        AiProvider::Custom => {
            let url = custom_base_url
                .clone()
                .unwrap_or_else(|| "https://api.openai.com".to_string());
            // 去掉末尾斜杠和 /v1，避免拼接后出现 /v1/v1/
            let url = url.trim_end_matches('/').to_string();
            if url.ends_with("/v1") {
                url[..url.len() - 3].to_string()
            } else {
                url
            }
        }
        AiProvider::Anthropic => "https://api.anthropic.com".to_string(),
    }
}

/// 解析 SSE 行，提取 delta 文本（OpenAI 协议）
fn parse_openai_sse_delta(line: &str) -> Option<String> {
    let data = line.strip_prefix("data: ")?;
    if data.trim() == "[DONE]" {
        return None;
    }
    let v: serde_json::Value = serde_json::from_str(data).ok()?;
    let delta = v["choices"][0]["delta"]["content"].as_str()?;
    Some(delta.to_string())
}

/// 解析 SSE 行，提取 delta 文本（Anthropic 协议）
fn parse_anthropic_sse_delta(line: &str) -> Option<String> {
    if !line.starts_with("data: ") {
        return None;
    }
    let data = line.strip_prefix("data: ")?;
    let v: serde_json::Value = serde_json::from_str(data).ok()?;
    if v["type"].as_str() == Some("content_block_delta") {
        let text = v["delta"]["text"].as_str()?;
        return Some(text.to_string());
    }
    None
}

// ─── Tauri Commands ──────────────────────────────────────────────────────────

mod commands {
    use super::*;
    use futures_util::StreamExt;
    use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
    use tauri::AppHandle;

    // ── 文件系统命令 ──────────────────────────────────────────────────────────

    #[tauri::command]
    pub fn read_directory(path: String) -> Result<Vec<FileNode>, String> {
        let dir_path = Path::new(&path);
        if !dir_path.exists() {
            return Err(format!("路径不存在: {}", path));
        }
        if !dir_path.is_dir() {
            return Err(format!("路径不是目录: {}", path));
        }
        read_dir_recursive(dir_path, 3)
    }

    #[tauri::command]
    pub fn read_file_content(path: String) -> Result<String, String> {
        let file_path = Path::new(&path);
        if !file_path.exists() {
            return Err(format!("文件不存在: {}", path));
        }
        if file_path.is_dir() {
            return Err(format!("路径是目录，不是文件: {}", path));
        }
        fs::read_to_string(file_path).map_err(|e| format!("读取文件失败: {}", e))
    }

    #[tauri::command]
    pub fn write_file_content(app: AppHandle, path: String, content: String) -> Result<(), String> {
        use tauri::Emitter;
        let file_path = Path::new(&path);
        if let Some(parent) = file_path.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("创建目录失败: {}", e))?;
            }
        }
        fs::write(file_path, &content).map_err(|e| format!("写入文件失败: {}", e))?;
        // 写入成功后通知前端文件系统已变更，触发资源管理器刷新
        let _ = app.emit("file-system-changed", path);
        Ok(())
    }

    #[tauri::command]
    pub fn search_in_files(
        root_path: String,
        query: String,
        case_sensitive: bool,
        use_regex: bool,
    ) -> Result<Vec<SearchResult>, String> {
        if query.is_empty() {
            return Ok(vec![]);
        }

        // 预编译正则（如果启用）
        let regex_pattern = if use_regex {
            let pattern = if case_sensitive {
                query.clone()
            } else {
                format!("(?i){}", query)
            };
            Some(regex::Regex::new(&pattern).map_err(|e| format!("正则表达式错误: {}", e))?)
        } else {
            None
        };

        let mut results = Vec::new();
        search_recursive(
            Path::new(&root_path),
            &query,
            &mut results,
            0,
            case_sensitive,
            use_regex,
            regex_pattern.as_ref(),
        )?;
        results.truncate(500);
        Ok(results)
    }

    // ── AI Chat 流式命令 ──────────────────────────────────────────────────────

    /// 发起 AI Chat 请求，通过 Tauri Event 流式推送结果
    /// 前端监听 "ai-stream-{request_id}" 事件
    #[tauri::command]
    pub async fn ai_chat_stream(
        app: AppHandle,
        request: AiChatRequest,
        request_id: String,
    ) -> Result<(), String> {
        use tauri::Emitter;
        let app_clone = app.clone();
        let rid = request_id.clone();
        let emit_event = format!("ai-stream-{}", request_id);

        tokio::spawn(async move {
            let result = do_ai_chat_stream(app_clone.clone(), request, rid.clone()).await;
            if let Err(e) = result {
                let _ = app_clone.emit(
                    &emit_event,
                    AiStreamEvent {
                        request_id: rid,
                        delta: String::new(),
                        done: true,
                        error: Some(e),
                    },
                );
            }
        });

        Ok(())
    }

    async fn do_ai_chat_stream(
        app: AppHandle,
        req: AiChatRequest,
        request_id: String,
    ) -> Result<(), String> {
        use tauri::Emitter;

        let emit_event = format!("ai-stream-{}", request_id);

        // 辅助：发送错误事件
        fn emit_err(app: &AppHandle, event: &str, rid: &str, msg: String) {
            let _ = app.emit(
                event,
                AiStreamEvent {
                    request_id: rid.to_string(),
                    delta: String::new(),
                    done: true,
                    error: Some(msg),
                },
            );
        }

        if req.provider == AiProvider::Anthropic {
            // ── Anthropic 协议 ────────────────────────────────────────────────
            let base_url = "https://api.anthropic.com";
            let url = format!("{}/v1/messages", base_url);

            // 分离 system 消息
            let system_msg = req
                .messages
                .iter()
                .find(|m| m.role == "system")
                .map(|m| m.content.clone());
            let user_messages: Vec<serde_json::Value> = req
                .messages
                .iter()
                .filter(|m| m.role != "system")
                .map(|m| {
                    serde_json::json!({
                        "role": m.role,
                        "content": m.content
                    })
                })
                .collect();

            let mut body = serde_json::json!({
                "model": req.model,
                "messages": user_messages,
                "max_tokens": req.max_tokens.unwrap_or(4096),
                "stream": true
            });
            if let Some(sys) = system_msg {
                body["system"] = serde_json::Value::String(sys);
            }

            let mut headers = HeaderMap::new();
            headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
            headers.insert(
                "x-api-key",
                HeaderValue::from_str(&req.api_key)
                    .map_err(|e| format!("API Key 格式错误: {}", e))?,
            );
            headers.insert(
                "anthropic-version",
                HeaderValue::from_static("2023-06-01"),
            );

            let client = build_http_client()?;
            let response = client
                .post(&url)
                .headers(headers)
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("请求失败: {}", e))?;

            if !response.status().is_success() {
                let status = response.status();
                let text = response.text().await.unwrap_or_default();
                emit_err(&app, &emit_event, &request_id, format!("API 错误 {}: {}", status, text));
                return Ok(());
            }

            let mut stream = response.bytes_stream();
            let mut buffer = String::new();

            while let Some(chunk) = stream.next().await {
                let chunk = match chunk {
                    Ok(c) => c,
                    Err(e) => {
                        emit_err(&app, &emit_event, &request_id, format!("流读取失败: {}", e));
                        return Ok(());
                    }
                };
                buffer.push_str(&String::from_utf8_lossy(&chunk));

                // 按行处理 SSE
                while let Some(pos) = buffer.find('\n') {
                    let line = buffer[..pos].trim().to_string();
                    buffer = buffer[pos + 1..].to_string();

                    if let Some(delta) = parse_anthropic_sse_delta(&line) {
                        let _ = app.emit(
                            &emit_event,
                            AiStreamEvent {
                                request_id: request_id.clone(),
                                delta,
                                done: false,
                                error: None,
                            },
                        );
                    }
                }
            }
        } else {
            // ── OpenAI 兼容协议（OpenAI / DashScope / Custom）────────────────
            let base_url = get_openai_base_url(&req.provider, &req.base_url);
            let url = format!("{}/v1/chat/completions", base_url);

            let messages: Vec<serde_json::Value> = req
                .messages
                .iter()
                .map(|m| {
                    serde_json::json!({
                        "role": m.role,
                        "content": m.content
                    })
                })
                .collect();

            let body = serde_json::json!({
                "model": req.model,
                "messages": messages,
                "stream": true,
                "max_tokens": req.max_tokens.unwrap_or(4096),
                "temperature": req.temperature.unwrap_or(0.7)
            });

            let mut headers = HeaderMap::new();
            headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
            headers.insert(
                AUTHORIZATION,
                HeaderValue::from_str(&format!("Bearer {}", req.api_key))
                    .map_err(|e| format!("API Key 格式错误: {}", e))?,
            );

            let client = build_http_client()?;
            let response = client
                .post(&url)
                .headers(headers)
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("请求失败: {}", e))?;

            if !response.status().is_success() {
                let status = response.status();
                let text = response.text().await.unwrap_or_default();
                emit_err(&app, &emit_event, &request_id, format!("API 错误 {}: {}", status, text));
                return Ok(());
            }

            let mut stream = response.bytes_stream();
            let mut buffer = String::new();

            while let Some(chunk) = stream.next().await {
                let chunk = match chunk {
                    Ok(c) => c,
                    Err(e) => {
                        emit_err(&app, &emit_event, &request_id, format!("流读取失败: {}", e));
                        return Ok(());
                    }
                };
                buffer.push_str(&String::from_utf8_lossy(&chunk));

                while let Some(pos) = buffer.find('\n') {
                    let line = buffer[..pos].trim().to_string();
                    buffer = buffer[pos + 1..].to_string();

                    if let Some(delta) = parse_openai_sse_delta(&line) {
                        let _ = app.emit(
                            &emit_event,
                            AiStreamEvent {
                                request_id: request_id.clone(),
                                delta,
                                done: false,
                                error: None,
                            },
                        );
                    }
                }
            }
        }

        // 发送完成事件
        let _ = app.emit(
            &emit_event,
            AiStreamEvent {
                request_id: request_id.clone(),
                delta: String::new(),
                done: true,
                error: None,
            },
        );

        Ok(())
    }

    // ── AI 代码补全命令（非流式，返回补全文本）────────────────────────────────

    #[tauri::command]
    pub async fn ai_complete(request: AiCompleteRequest) -> Result<String, String> {
        let system_prompt = format!(
            "你是一个代码补全助手。根据给定的代码上下文，提供简洁、准确的代码补全。\n\
             编程语言: {}\n\
             只输出补全的代码片段，不要解释，不要 markdown 代码块，不要重复已有代码。",
            request.language
        );

        let user_prompt = format!(
            "请补全以下代码（光标位置用 <CURSOR> 标记）：\n\n{}<CURSOR>{}",
            request.prefix, request.suffix
        );

        let (url, body, headers) = if request.provider == AiProvider::Anthropic {
            let url = "https://api.anthropic.com/v1/messages".to_string();
            let body = serde_json::json!({
                "model": request.model,
                "system": system_prompt,
                "messages": [{"role": "user", "content": user_prompt}],
                "max_tokens": request.max_tokens.unwrap_or(256),
                "stream": false
            });
            let mut h = HeaderMap::new();
            h.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
            h.insert(
                "x-api-key",
                HeaderValue::from_str(&request.api_key)
                    .map_err(|e| format!("API Key 格式错误: {}", e))?,
            );
            h.insert("anthropic-version", HeaderValue::from_static("2023-06-01"));
            (url, body, h)
        } else {
            let base_url = get_openai_base_url(&request.provider, &request.base_url);
            let url = format!("{}/v1/chat/completions", base_url);
            let body = serde_json::json!({
                "model": request.model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                "max_tokens": request.max_tokens.unwrap_or(256),
                "temperature": 0.2,
                "stream": false
            });
            let mut h = HeaderMap::new();
            h.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
            h.insert(
                AUTHORIZATION,
                HeaderValue::from_str(&format!("Bearer {}", request.api_key))
                    .map_err(|e| format!("API Key 格式错误: {}", e))?,
            );
            (url, body, h)
        };

        let client = build_http_client().map_err(|e| e)?;
        let response = client
            .post(&url)
            .headers(headers)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("请求失败: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(format!("API 错误 {}: {}", status, text));
        }

        let json: serde_json::Value = response
            .json()
            .await
            .map_err(|e| format!("解析响应失败: {}", e))?;

        // 提取补全文本
        let text = if request.provider == AiProvider::Anthropic {
            json["content"][0]["text"]
                .as_str()
                .unwrap_or("")
                .to_string()
        } else {
            json["choices"][0]["message"]["content"]
                .as_str()
                .unwrap_or("")
                .to_string()
        };

        Ok(text.trim().to_string())
    }

    #[tauri::command]
    pub fn create_file(path: String) -> Result<(), String> {
        let p = Path::new(&path);
        if p.exists() { return Err(format!("已存在: {}", path)); }
        if let Some(parent) = p.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
            }
        }
        fs::File::create(p).map_err(|e| format!("创建文件失败: {}", e))?;
        Ok(())
    }

    #[tauri::command]
    pub fn create_directory(path: String) -> Result<(), String> {
        fs::create_dir_all(Path::new(&path)).map_err(|e| format!("创建目录失败: {}", e))
    }

    #[tauri::command]
    pub fn rename_path(old_path: String, new_path: String) -> Result<(), String> {
        fs::rename(Path::new(&old_path), Path::new(&new_path))
            .map_err(|e| format!("重命名失败: {}", e))
    }

    #[tauri::command]
    pub fn delete_path(path: String) -> Result<(), String> {
        let p = Path::new(&path);
        if p.is_dir() {
            fs::remove_dir_all(p).map_err(|e| format!("删除目录失败: {}", e))
        } else {
            fs::remove_file(p).map_err(|e| format!("删除文件失败: {}", e))
        }
    }

    #[tauri::command]
    pub fn copy_path(src_path: String, dest_path: String) -> Result<(), String> {
        let src = Path::new(&src_path);
        let dest = Path::new(&dest_path);
        if src.is_dir() {
            copy_dir_recursive(src, dest).map_err(|e| format!("复制目录失败: {}", e))
        } else {
            copy_file_shared(src, dest).map_err(|e| format!("复制文件失败: {}", e))
        }
    }

    /// 复制文件/目录到目标目录，自动处理同名冲突（追加 " (copy)" 或 " (copy N)"）
    /// 返回实际写入的目标路径
    #[tauri::command]
    pub fn copy_path_safe(src_path: String, dest_dir: String) -> Result<String, String> {
        let src = Path::new(&src_path);
        if !src.exists() {
            return Err(format!("源路径不存在: {}", src_path));
        }
        let dest_dir_path = Path::new(&dest_dir);
        if !dest_dir_path.is_dir() {
            return Err(format!("目标不是目录: {}", dest_dir));
        }

        // 计算不冲突的目标路径
        let dest = resolve_no_conflict(src, dest_dir_path);
        let dest_str = dest.to_string_lossy().replace('\\', "/");

        if src.is_dir() {
            copy_dir_recursive(src, &dest).map_err(|e| format!("复制目录失败: {}", e))?;
        } else {
            copy_file_shared(src, &dest).map_err(|e| format!("复制文件失败: {}", e))?;
        }
        Ok(dest_str)
    }

    /// 移动文件/目录到目标目录，自动处理同名冲突
    /// 返回实际写入的目标路径
    #[tauri::command]
    pub fn move_path_safe(src_path: String, dest_dir: String) -> Result<String, String> {
        let src = Path::new(&src_path);
        if !src.exists() {
            return Err(format!("源路径不存在: {}", src_path));
        }
        let dest_dir_path = Path::new(&dest_dir);
        if !dest_dir_path.is_dir() {
            return Err(format!("目标不是目录: {}", dest_dir));
        }

        // 如果源和目标在同一目录，直接返回（不做任何操作）
        if let Some(src_parent) = src.parent() {
            if src_parent == dest_dir_path {
                return Ok(src_path.replace('\\', "/"));
            }
        }

        let dest = resolve_no_conflict(src, dest_dir_path);
        let dest_str = dest.to_string_lossy().replace('\\', "/");
        fs::rename(src, &dest).map_err(|e| format!("移动失败: {}", e))?;
        Ok(dest_str)
    }

    /// 计算不与目标目录中已有文件冲突的路径
    /// 规则：foo.ts → foo (copy).ts → foo (copy 2).ts → ...
    fn resolve_no_conflict(src: &Path, dest_dir: &Path) -> std::path::PathBuf {
        let file_name = src.file_name().unwrap_or_default().to_string_lossy();
        let is_dir = src.is_dir();

        // 分离 stem 和 extension
        let (stem, ext) = if is_dir {
            (file_name.to_string(), String::new())
        } else {
            let p = std::path::Path::new(file_name.as_ref());
            let s = p.file_stem().unwrap_or_default().to_string_lossy().to_string();
            let e = p.extension().map(|x| format!(".{}", x.to_string_lossy())).unwrap_or_default();
            (s, e)
        };

        // 先尝试原名
        let candidate = dest_dir.join(format!("{}{}", stem, ext));
        if !candidate.exists() {
            return candidate;
        }

        // 追加 " (copy)"
        let candidate = dest_dir.join(format!("{} (copy){}", stem, ext));
        if !candidate.exists() {
            return candidate;
        }

        // 追加 " (copy N)"
        let mut n = 2u32;
        loop {
            let candidate = dest_dir.join(format!("{} (copy {}){}", stem, n, ext));
            if !candidate.exists() {
                return candidate;
            }
            n += 1;
        }
    }

    /// Windows 下以宽松共享模式复制文件，避免 os error 32（共享冲突）
    fn copy_file_shared(src: &Path, dest: &Path) -> std::io::Result<()> {
        #[cfg(windows)]
        {
            use std::io::{Read, Write};
            use std::os::windows::fs::OpenOptionsExt;
            // FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE = 0x7
            // 允许其他进程在文件被 Monaco / 杀毒软件打开时仍可复制
            const SHARE_ALL: u32 = 0x0000_0007;
            let mut src_file = std::fs::OpenOptions::new()
                .read(true)
                .share_mode(SHARE_ALL)
                .open(src)?;
            let mut dest_file = std::fs::OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .open(dest)?;
            let mut buf = Vec::new();
            src_file.read_to_end(&mut buf)?;
            dest_file.write_all(&buf)?;
            Ok(())
        }
        #[cfg(not(windows))]
        {
            fs::copy(src, dest)?;
            Ok(())
        }
    }

    fn copy_dir_recursive(src: &Path, dest: &Path) -> std::io::Result<()> {
        fs::create_dir_all(dest)?;
        for entry in fs::read_dir(src)? {
            let entry = entry?;
            let dest_child = dest.join(entry.file_name());
            if entry.path().is_dir() {
                copy_dir_recursive(&entry.path(), &dest_child)?;
            } else {
                copy_file_shared(&entry.path(), &dest_child)?;
            }
        }
        Ok(())
    }

    // ── 终端命令执行 ──────────────────────────────────────────────────────────

    /// 在指定工作目录执行命令，通过 Tauri Event 流式推送 stdout/stderr
    /// 前端监听 "terminal-output-{terminal_id}" 事件
    #[tauri::command]
    pub async fn terminal_execute(
        app: AppHandle,
        terminal_id: String,
        command: String,
        cwd: Option<String>,
    ) -> Result<(), String> {
        use tauri::Emitter;

        let emit_event = format!("terminal-output-{}", terminal_id);
        let cwd = cwd.unwrap_or_else(|| ".".to_string());

        tokio::spawn(async move {
            // Windows 用 cmd /C，先切换代码页到 UTF-8（65001）再执行命令，避免中文乱码
            #[cfg(target_os = "windows")]
            let result = std::process::Command::new("cmd")
                .args(["/C", &format!("chcp 65001 >nul 2>&1 & {}", command)])
                .current_dir(&cwd)
                .output();

            #[cfg(not(target_os = "windows"))]
            let result = std::process::Command::new("sh")
                .args(["-c", &command])
                .current_dir(&cwd)
                .output();

            match result {
                Ok(output) => {
                    // 推送 stdout
                    if !output.stdout.is_empty() {
                        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                        let _ = app.emit(
                            &emit_event,
                            TerminalOutput {
                                terminal_id: terminal_id.clone(),
                                data: stdout,
                                is_stderr: false,
                                exit_code: None,
                            },
                        );
                    }
                    // 推送 stderr
                    if !output.stderr.is_empty() {
                        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                        let _ = app.emit(
                            &emit_event,
                            TerminalOutput {
                                terminal_id: terminal_id.clone(),
                                data: stderr,
                                is_stderr: true,
                                exit_code: None,
                            },
                        );
                    }
                    // 推送退出码（标志命令结束）
                    let _ = app.emit(
                        &emit_event,
                        TerminalOutput {
                            terminal_id: terminal_id.clone(),
                            data: String::new(),
                            is_stderr: false,
                            exit_code: Some(output.status.code().unwrap_or(-1)),
                        },
                    );
                }
                Err(e) => {
                    let _ = app.emit(
                        &emit_event,
                        TerminalOutput {
                            terminal_id: terminal_id.clone(),
                            data: format!("执行失败: {}\r\n", e),
                            is_stderr: true,
                            exit_code: Some(-1),
                        },
                    );
                }
            }
        });

        Ok(())
    }

    #[tauri::command]
    pub fn reveal_in_explorer(path: String) -> Result<(), String> {
        #[cfg(target_os = "windows")]
        {
            // /select,<path> 必须是一个整体参数，路径用反斜杠
            let win_path = path.replace('/', "\\");
            std::process::Command::new("explorer")
                .arg(format!("/select,{}", win_path))
                .spawn()
                .map_err(|e| format!("打开文件管理器失败: {}", e))?;
        }
        #[cfg(target_os = "macos")]
        {
            std::process::Command::new("open")
                .args(["-R", &path])
                .spawn()
                .map_err(|e| format!("打开 Finder 失败: {}", e))?;
        }
        #[cfg(target_os = "linux")]
        {
            let parent = Path::new(&path).parent().unwrap_or(Path::new("/"));
            std::process::Command::new("xdg-open")
                .arg(parent)
                .spawn()
                .map_err(|e| format!("打开文件管理器失败: {}", e))?;
        }
        Ok(())
    }

    // ── Agent 命令 ────────────────────────────────────────────────────────────

    /// Agent 单步请求（非流式，支持 tool_calls 解析）
    /// 只支持 OpenAI 兼容协议（openai / dashscope / custom）
    #[tauri::command]
    pub async fn ai_agent_step(
        provider: AiProvider,
        api_key: String,
        base_url: Option<String>,
        model: String,
        messages: Vec<AgentMessage>,
        tools: Vec<serde_json::Value>,
    ) -> Result<AgentStepResponse, String> {
        let base = get_openai_base_url(&provider, &base_url);
        let url = format!("{}/v1/chat/completions", base);

        // 构建消息数组，保留所有字段
        let msgs: Vec<serde_json::Value> = messages
            .iter()
            .map(|m| {
                let mut obj = serde_json::json!({ "role": m.role });
                match &m.content {
                    Some(c) => obj["content"] = serde_json::Value::String(c.clone()),
                    None => obj["content"] = serde_json::Value::Null,
                }
                if let Some(tc) = &m.tool_calls {
                    obj["tool_calls"] = serde_json::Value::Array(tc.clone());
                }
                if let Some(id) = &m.tool_call_id {
                    obj["tool_call_id"] = serde_json::Value::String(id.clone());
                }
                if let Some(n) = &m.name {
                    obj["name"] = serde_json::Value::String(n.clone());
                }
                obj
            })
            .collect();

        let body = serde_json::json!({
            "model": model,
            "messages": msgs,
            "tools": tools,
            "tool_choice": "auto",
            "max_tokens": 4096,
            "temperature": 0.3,
            "stream": false
        });

        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {}", api_key))
                .map_err(|e| format!("API Key 格式错误: {}", e))?,
        );

        let client = build_http_client()?;
        let response = client
            .post(&url)
            .headers(headers)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("请求失败: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(format!("API 错误 {}: {}", status, text));
        }

        let json: serde_json::Value = response
            .json()
            .await
            .map_err(|e| format!("解析响应失败: {}", e))?;

        let choice = &json["choices"][0];
        let finish_reason = choice["finish_reason"]
            .as_str()
            .unwrap_or("stop")
            .to_string();
        let message = &choice["message"];

        let content = message["content"].as_str().map(|s| s.to_string());

        let tool_calls: Vec<AgentToolCall> = message["tool_calls"]
            .as_array()
            .unwrap_or(&vec![])
            .iter()
            .filter_map(|tc| {
                let id = tc["id"].as_str()?.to_string();
                let name = tc["function"]["name"].as_str()?.to_string();
                let arguments = tc["function"]["arguments"]
                    .as_str()
                    .unwrap_or("{}")
                    .to_string();
                Some(AgentToolCall { id, name, arguments })
            })
            .collect();

        Ok(AgentStepResponse {
            content,
            tool_calls,
            finish_reason,
        })
    }
}

// ─── 应用入口 ────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            commands::read_directory,
            commands::read_file_content,
            commands::write_file_content,
            commands::search_in_files,
            commands::ai_chat_stream,
            commands::ai_complete,
            commands::create_file,
            commands::create_directory,
            commands::rename_path,
            commands::delete_path,
            commands::copy_path,
            commands::copy_path_safe,
            commands::move_path_safe,
            commands::reveal_in_explorer,
            commands::terminal_execute,
            commands::ai_agent_step,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
