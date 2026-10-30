use crate::{
    aria2_add_tasks, aria2_remove_task, map_task, rpc_call, tell_statuses, AddTasksRequest,
    Aria2RpcConfig, CreateTaskPayload, TaskAdvancedOptions,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Manager;

pub const API_PORT: u16 = 17890;

const DEFAULT_SPLIT_COUNT: u32 = 128;
const DEFAULT_MAX_CONNECTIONS: u32 = 64;

const MAX_HEAD_BYTES: usize = 16 * 1024;
const MAX_BODY_BYTES: usize = 1024 * 1024;
const SOCKET_TIMEOUT: Duration = Duration::from_secs(10);

pub struct ApiShared {
    token: String,
    config: Mutex<Aria2RpcConfig>,
    mirrors: Mutex<MirrorSnapshot>,
    enabled: AtomicBool,
    listening: AtomicBool,
}

// 前端把 GitHub 加速列表推过来，API 建任务时据此改写链接（API 不修改客户端设置）
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MirrorEntryDto {
    pub id: String,
    pub label: String,
    pub prefix: String,
}

#[derive(Debug, Clone, Default)]
pub struct MirrorSnapshot {
    pub active_id: String,
    pub list: Vec<MirrorEntryDto>,
}

// 与前端 src/utils/githubMirror.ts 保持一致：只改写这些域名
const MIRRORABLE_HOSTS: [&str; 6] = [
    "github.com",
    "www.github.com",
    "codeload.github.com",
    "raw.githubusercontent.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
];

fn url_host(url: &str) -> Option<String> {
    let rest = url.split("://").nth(1)?;
    let host = rest
        .split(['/', '?', '#'])
        .next()?
        .split('@')
        .last()?
        .split(':')
        .next()?;
    if host.is_empty() {
        None
    } else {
        Some(host.to_ascii_lowercase())
    }
}

fn apply_mirror(url: &str, prefix: &str) -> String {
    let trimmed = prefix.trim();
    if trimmed.is_empty() {
        return url.to_string();
    }
    match url_host(url) {
        Some(host) if MIRRORABLE_HOSTS.contains(&host.as_str()) => {
            let base = if trimmed.ends_with('/') {
                trimmed.to_string()
            } else {
                format!("{trimmed}/")
            };
            format!("{base}{url}")
        }
        _ => url.to_string(),
    }
}

pub fn start(app: tauri::AppHandle) {
    let token = load_or_create_token(&app);
    let enabled = load_enabled(&app);
    let shared = Arc::new(ApiShared {
        token,
        config: Mutex::new(Aria2RpcConfig {
            rpc_port: 16800,
            rpc_secret: String::new(),
            aria2_executable_path: String::new(),
        }),
        mirrors: Mutex::new(MirrorSnapshot::default()),
        enabled: AtomicBool::new(enabled),
        listening: AtomicBool::new(false),
    });

    if !app.manage(shared.clone()) {
        eprintln!("[api] ApiShared 已被管理，跳过重复注册");
    }

    if enabled {
        spawn_listener(shared);
    }
}

// accept 是阻塞的，关不掉；改成非阻塞轮询，关闭时循环立刻退出并释放端口
fn spawn_listener(shared: Arc<ApiShared>) {
    if shared.listening.swap(true, Ordering::SeqCst) {
        return;
    }
    thread::spawn(move || {
        let listener = match TcpListener::bind(("127.0.0.1", API_PORT)) {
            Ok(listener) => listener,
            Err(error) => {
                eprintln!("[api] 端口 {API_PORT} 绑定失败: {error}");
                shared.listening.store(false, Ordering::SeqCst);
                return;
            }
        };
        let _ = listener.set_nonblocking(true);
        while shared.enabled.load(Ordering::SeqCst) {
            match listener.accept() {
                Ok((stream, _)) => {
                    let shared = shared.clone();
                    thread::spawn(move || handle_stream(stream, shared));
                }
                Err(_) => thread::sleep(Duration::from_millis(200)),
            }
        }
        shared.listening.store(false, Ordering::SeqCst);
    });
}

fn enabled_flag_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join("api-enabled"))
}

fn load_enabled(app: &tauri::AppHandle) -> bool {
    enabled_flag_path(app)
        .and_then(|path| std::fs::read_to_string(path).ok())
        .map(|text| text.trim() == "1")
        .unwrap_or(false)
}

fn save_enabled(app: &tauri::AppHandle, enabled: bool) {
    if let Some(path) = enabled_flag_path(app) {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(path, if enabled { "1" } else { "0" });
    }
}

fn load_or_create_token(app: &tauri::AppHandle) -> String {
    let dir = match app.path().app_data_dir() {
        Ok(dir) => dir,
        Err(_) => return generate_token(),
    };
    let path = dir.join("api-token");
    if let Ok(text) = std::fs::read_to_string(&path) {
        let trimmed = text.trim().to_string();
        if trimmed.len() >= 16 {
            return trimmed;
        }
    }
    let token = generate_token();
    let _ = std::fs::create_dir_all(&dir);
    let _ = std::fs::write(&path, &token);
    token
}

fn generate_token() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or(0);
    let mut hasher = Sha256::new();
    hasher.update(nanos.to_le_bytes());
    hasher.update(std::process::id().to_le_bytes());
    hasher.update(format!("{:p}", &nanos).as_bytes());
    hasher
        .finalize()
        .iter()
        .take(16)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

struct Request {
    method: String,
    path: String,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

fn handle_stream(mut stream: TcpStream, shared: Arc<ApiShared>) {
    let _ = stream.set_read_timeout(Some(SOCKET_TIMEOUT));
    let _ = stream.set_write_timeout(Some(SOCKET_TIMEOUT));

    let request = match read_request(&mut stream) {
        Ok(request) => request,
        Err(message) => {
            write_json(&mut stream, 400, error_body("bad_request", &message));
            return;
        }
    };

    if request.method == "OPTIONS" {
        write_json(&mut stream, 204, json!({}));
        return;
    }

    let provided = request
        .headers
        .iter()
        .find(|(key, _)| key == "x-api-token")
        .map(|(_, value)| value.clone())
        .unwrap_or_default();
    if !token_matches(&provided, &shared.token) {
        write_json(&mut stream, 401, error_body("unauthorized", "缺少或错误的 X-Api-Token"));
        return;
    }

    let config = match shared.config.lock() {
        Ok(guard) => guard.clone(),
        Err(_) => {
            write_json(&mut stream, 500, error_body("state_error", "配置状态不可用"));
            return;
        }
    };

    let mirrors = match shared.mirrors.lock() {
        Ok(guard) => guard.clone(),
        Err(_) => {
            write_json(&mut stream, 500, error_body("state_error", "镜像配置状态不可用"));
            return;
        }
    };

    let segments: Vec<&str> = request
        .path
        .trim_matches('/')
        .split('/')
        .filter(|item| !item.is_empty())
        .collect();

    let response = match (request.method.as_str(), segments.as_slice()) {
        ("GET", ["api", "v1", "ping"]) => ping(&config),
        ("GET", ["api", "v1", "tasks"]) => list_tasks(&config),
        ("GET", ["api", "v1", "tasks", id]) => get_task(&config, id.trim()),
        ("POST", ["api", "v1", "tasks"]) => create_tasks(&config, &mirrors, &request.body),
        ("POST", ["api", "v1", "tasks", id, "pause"]) => task_action(&config, id.trim(), "aria2.pause"),
        ("POST", ["api", "v1", "tasks", id, "resume"]) => task_action(&config, id.trim(), "aria2.unpause"),
        ("POST", ["api", "v1", "tasks", id, "remove"]) => remove_task(&config, id.trim()),
        ("GET", ["api", "v1", "config"]) => get_config(&config, &mirrors),
        ("POST", ["api", "v1", "config", "speed"]) => set_global_speed_limit(&config, &request.body),
        ("POST", ["mcp"]) => mcp_handle(&config, &mirrors, &request.body),
        _ => (404, error_body("not_found", "接口不存在")),
    };

    write_json(&mut stream, response.0, response.1);
}

fn ping(config: &Aria2RpcConfig) -> (u16, Value) {
    let version = tauri::async_runtime::block_on(async {
        let client = reqwest::Client::new();
        rpc_call::<Value>(&client, config, "aria2.getVersion", vec![]).await
    });
    match version {
        Ok(value) => (
            200,
            json!({
                "ok": true,
                "service": "TinyAii Downloader",
                "apiVersion": "v1",
                "engine": { "online": true, "version": value.get("version").cloned().unwrap_or(Value::Null) }
            }),
        ),
        Err(message) => (
            200,
            json!({
                "ok": true,
                "service": "TinyAii Downloader",
                "apiVersion": "v1",
                "engine": { "online": false, "message": message }
            }),
        ),
    }
}

fn list_tasks(config: &Aria2RpcConfig) -> (u16, Value) {
    let result = tauri::async_runtime::block_on(async {
        let client = reqwest::Client::new();
        tell_statuses(&client, config).await
    });
    match result {
        Ok(statuses) => {
            let tasks: Vec<Value> = statuses
                .into_iter()
                .map(|status| serde_json::to_value(map_task(status)).unwrap_or(Value::Null))
                .collect();
            (200, json!({ "ok": true, "count": tasks.len(), "tasks": tasks }))
        }
        Err(message) => (502, error_body("engine_unavailable", &message)),
    }
}

fn get_task(config: &Aria2RpcConfig, gid: &str) -> (u16, Value) {
    let result = tauri::async_runtime::block_on(async {
        let client = reqwest::Client::new();
        tell_statuses(&client, config).await
    });
    match result {
        Ok(statuses) => {
            match statuses.into_iter().find(|status| status.gid == gid) {
                Some(status) => (200, json!({ "ok": true, "task": serde_json::to_value(map_task(status)).unwrap_or(Value::Null) })),
                None => (404, error_body("task_not_found", "任务不存在")),
            }
        }
        Err(message) => (502, error_body("engine_unavailable", &message)),
    }
}

// 兼容 "url":"一个链接" 和 "links":["多个链接"] 两种写法
fn one_or_many<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum OneOrMany {
        One(String),
        Many(Vec<String>),
    }
    match OneOrMany::deserialize(deserializer)? {
        OneOrMany::One(value) => Ok(vec![value]),
        OneOrMany::Many(values) => Ok(values),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ApiCreateTaskRequest {
    #[serde(
        default,
        alias = "url",
        alias = "urls",
        alias = "link",
        deserialize_with = "one_or_many"
    )]
    links: Vec<String>,
    #[serde(default, alias = "dir", alias = "path", alias = "dst", alias = "out")]
    save_path: String,
    #[serde(default, alias = "name", alias = "filename")]
    rename: String,
    #[serde(default, alias = "split")]
    split_count: Option<u32>,
    #[serde(default, alias = "maxConnectionPerServer")]
    max_connections_per_server: Option<u32>,
    #[serde(default)]
    checksum: String,
    #[serde(default, alias = "maxDownloadSpeed")]
    max_download_limit: Option<u64>,
    #[serde(default, alias = "maxUploadSpeed")]
    max_upload_limit: Option<u64>,
    // 本次任务使用哪个加速：id 取自 GET /config 的 mirrors.list，或直接给前缀
    // 都不传 = 跟随客户端当前设置；githubMirror 传空串 = 本次直连
    #[serde(default)]
    github_mirror_id: Option<String>,
    #[serde(default)]
    github_mirror: Option<String>,
    #[serde(default)]
    lowest_speed_limit: Option<u64>,
    #[serde(default)]
    user_agent: String,
    #[serde(default)]
    authorization: String,
    #[serde(default)]
    referer: String,
    #[serde(default)]
    cookie: String,
    #[serde(default)]
    proxy: String,
}

fn default_save_path() -> String {
    if let Ok(profile) = std::env::var("USERPROFILE") {
        return std::path::PathBuf::from(profile)
            .join("Downloads")
            .to_string_lossy()
            .to_string();
    }
    std::env::temp_dir().to_string_lossy().to_string()
}

fn create_tasks(config: &Aria2RpcConfig, mirrors: &MirrorSnapshot, body: &[u8]) -> (u16, Value) {
    let request: ApiCreateTaskRequest = match serde_json::from_slice(body) {
        Ok(value) => value,
        Err(error) => {
            let message = error.to_string();
            let code = if message.contains("unknown field") {
                "unknown_field"
            } else {
                "invalid_json"
            };
            return (400, error_body(code, &format!("请求体解析失败: {message}")));
        }
    };
    if request.links.is_empty() {
        return (400, error_body("invalid_request", "links 不能为空"));
    }

    let mirror_prefix = match (&request.github_mirror, &request.github_mirror_id) {
        (Some(prefix), _) => prefix.clone(),
        (None, Some(id)) => match mirrors.list.iter().find(|item| &item.id == id) {
            Some(entry) => entry.prefix.clone(),
            None => {
                let available: Vec<&str> = mirrors.list.iter().map(|item| item.id.as_str()).collect();
                return (
                    400,
                    error_body(
                        "mirror_not_found",
                        &format!(
                            "没有这个加速项：{id}；可用项：{}",
                            if available.is_empty() {
                                "（客户端未配置加速列表）".to_string()
                            } else {
                                available.join(", ")
                            }
                        ),
                    ),
                );
            }
        },
        (None, None) => mirrors
            .list
            .iter()
            .find(|item| item.id == mirrors.active_id)
            .map(|item| item.prefix.clone())
            .unwrap_or_default(),
    };
    let links: Vec<String> = request
        .links
        .iter()
        .map(|link| apply_mirror(link, &mirror_prefix))
        .collect();

    let payload = CreateTaskPayload {
        links,
        torrent_files: Vec::new(),
        rename: request.rename,
        split_count: request.split_count.unwrap_or(DEFAULT_SPLIT_COUNT),
        max_connection_per_server: request
            .max_connections_per_server
            .unwrap_or(DEFAULT_MAX_CONNECTIONS),
        save_path: if request.save_path.trim().is_empty() {
            default_save_path()
        } else {
            request.save_path
        },
        checksum: request.checksum,
        max_download_limit: request.max_download_limit.unwrap_or(0),
        max_upload_limit: request.max_upload_limit.unwrap_or(0),
        lowest_speed_limit: request.lowest_speed_limit.unwrap_or(0),
        advanced: TaskAdvancedOptions {
            user_agent: request.user_agent,
            authorization: request.authorization,
            referer: request.referer,
            cookie: request.cookie,
            proxy: request.proxy,
        },
        bt_options: None,
    };

    let result = tauri::async_runtime::block_on(aria2_add_tasks(AddTasksRequest {
        payload,
        config: config.clone(),
    }));
    match result {
        Ok(tasks) => {
            let values: Vec<Value> = tasks
                .into_iter()
                .map(|task| serde_json::to_value(task).unwrap_or(Value::Null))
                .collect();
            (
                200,
                json!({ "ok": true, "count": values.len(), "tasks": values }),
            )
        }
        Err(message) => (400, error_body("create_failed", &message)),
    }
}

fn task_action(config: &Aria2RpcConfig, gid: &str, method: &'static str) -> (u16, Value) {
    let config = config.clone();
    let task_id = gid.to_string();
    let result: Result<String, String> = tauri::async_runtime::block_on(async move {
        let client = reqwest::Client::new();
        rpc_call::<String>(&client, &config, method, vec![json!(task_id)]).await
    });
    match result {
        Ok(_) => (200, json!({ "ok": true })),
        Err(message) => (502, error_body("engine_error", &message)),
    }
}

fn remove_task(config: &Aria2RpcConfig, gid: &str) -> (u16, Value) {
    let config = config.clone();
    let task_id = gid.to_string();
    let result = tauri::async_runtime::block_on(async move {
        aria2_remove_task(task_id, None, None, config).await
    });
    match result {
        Ok(_) => (200, json!({ "ok": true })),
        Err(message) => (502, error_body("engine_error", &message)),
    }
}

const MCP_PROTOCOL_VERSION: &str = "2024-11-05";

fn mcp_tools() -> Value {
    json!([
        {
            "name": "get_server_status",
            "description": "查看下载器与 aria2 引擎的运行状态",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        },
        {
            "name": "list_downloads",
            "description": "列出下载任务，可按状态过滤",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "status": {
                        "type": "string",
                        "enum": ["all", "downloading", "seeding", "paused", "stopped", "completed", "failed"],
                        "description": "默认 all"
                    }
                }
            }
        },
        {
            "name": "get_download",
            "description": "按 gid 查询单个任务的详情",
            "inputSchema": {
                "type": "object",
                "properties": { "gid": { "type": "string" } },
                "required": ["gid"]
            }
        },
        {
            "name": "create_download",
            "description": "用直链创建下载任务；不接受网盘分享链接（需在客户端内解析）",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "links": { "type": "array", "items": { "type": "string" } },
                    "savePath": { "type": "string", "description": "缺省为 用户目录/Downloads" },
                    "rename": { "type": "string" },
                    "splitCount": { "type": "integer" },
                    "maxConnectionsPerServer": { "type": "integer" },
                    "maxDownloadLimit": { "type": "integer", "description": "字节/秒，0 为不限" },
                    "maxUploadLimit": { "type": "integer", "description": "字节/秒，0 为不限" },
                    "lowestSpeedLimit": { "type": "integer", "description": "低于该速度判定失败，字节/秒" },
                    "checksum": { "type": "string", "description": "形如 sha-256=<hex>" },
                    "githubMirror": { "type": "string", "description": "本次任务使用的加速前缀，空串表示直连；不传则跟随客户端设置" },
                    "githubMirrorId": { "type": "string", "description": "取自 GET /api/v1/config 的 mirrors.list[].id" }
                },
                "required": ["links"]
            }
        },
        {
            "name": "control_download",
            "description": "暂停、继续或删除任务",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "gid": { "type": "string" },
                    "action": { "type": "string", "enum": ["pause", "resume", "remove"] }
                },
                "required": ["gid", "action"]
            }
        }
    ])
}

fn mcp_handle(config: &Aria2RpcConfig, mirrors: &MirrorSnapshot, body: &[u8]) -> (u16, Value) {
    let message: Value = match serde_json::from_slice(body) {
        Ok(value) => value,
        Err(error) => {
            return (
                400,
                json!({ "jsonrpc": "2.0", "id": Value::Null, "error": { "code": -32700, "message": format!("解析失败: {error}") } }),
            )
        }
    };

    let id = message.get("id").cloned().unwrap_or(Value::Null);
    let method = message.get("method").and_then(Value::as_str).unwrap_or_default();

    // 通知类消息（如 notifications/initialized）没有 id，不需要返回内容
    if id.is_null() {
        return (202, json!({}));
    }

    let outcome = match method {
        "initialize" => Ok(json!({
            "protocolVersion": MCP_PROTOCOL_VERSION,
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "tinyaii-downloader", "version": env!("CARGO_PKG_VERSION") }
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": mcp_tools() })),
        "tools/call" => mcp_call_tool(
            config,
            mirrors,
            message.get("params").cloned().unwrap_or(Value::Null),
        ),
        other => Err((-32601, format!("不支持的方法: {other}"))),
    };

    match outcome {
        Ok(result) => (200, json!({ "jsonrpc": "2.0", "id": id, "result": result })),
        Err((code, message)) => (
            200,
            json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }),
        ),
    }
}

fn mcp_call_tool(
    config: &Aria2RpcConfig,
    mirrors: &MirrorSnapshot,
    params: Value,
) -> Result<Value, (i64, String)> {
    let name = params
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let arguments = params
        .get("arguments")
        .cloned()
        .unwrap_or_else(|| json!({}));

    let payload = match name.as_str() {
        "get_server_status" => ping(config).1,
        "list_downloads" => {
            let wanted = arguments
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("all");
            filter_tasks(list_tasks(config).1, wanted)
        }
        "get_download" => {
            let gid = arguments.get("gid").and_then(Value::as_str).unwrap_or_default();
            if gid.is_empty() {
                return Err((-32602, "缺少 gid".to_string()));
            }
            get_task(config, gid).1
        }
        "create_download" => {
            let bytes = serde_json::to_vec(&arguments)
                .map_err(|error| (-32602, format!("参数序列化失败: {error}")))?;
            create_tasks(config, mirrors, &bytes).1
        }
        "control_download" => {
            let gid = arguments.get("gid").and_then(Value::as_str).unwrap_or_default();
            if gid.is_empty() {
                return Err((-32602, "缺少 gid".to_string()));
            }
            match arguments
                .get("action")
                .and_then(Value::as_str)
                .unwrap_or_default()
            {
                "pause" => task_action(config, gid, "aria2.pause").1,
                "resume" => task_action(config, gid, "aria2.unpause").1,
                "remove" => remove_task(config, gid).1,
                other => return Err((-32602, format!("未知 action: {other}"))),
            }
        }
        other => return Err((-32602, format!("未知工具: {other}"))),
    };

    let is_error = payload.get("ok").and_then(Value::as_bool) == Some(false);
    Ok(json!({
        "content": [{ "type": "text", "text": payload.to_string() }],
        "isError": is_error
    }))
}

fn filter_tasks(body: Value, wanted: &str) -> Value {
    if wanted.is_empty() || wanted == "all" {
        return body;
    }
    let tasks = body
        .get("tasks")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let filtered: Vec<Value> = tasks
        .into_iter()
        .filter(|task| task.get("status").and_then(Value::as_str) == Some(wanted))
        .collect();
    json!({ "ok": true, "count": filtered.len(), "tasks": filtered })
}

fn get_config(config: &Aria2RpcConfig, mirrors: &MirrorSnapshot) -> (u16, Value) {
    let mirror_payload = json!({
        "activeId": mirrors.active_id,
        "list": mirrors.list,
    });
    let config = config.clone();
    let result: Result<Value, String> = tauri::async_runtime::block_on(async move {
        let client = reqwest::Client::new();
        rpc_call::<Value>(&client, &config, "aria2.getGlobalOption", vec![]).await
    });
    match result {
        Ok(value) => (
            200,
            json!({
                "ok": true,
                "config": {
                    "downloadDir": value.get("dir").cloned().unwrap_or(Value::Null),
                    "maxOverallDownloadLimit": value.get("max-overall-download-limit").cloned().unwrap_or(Value::Null),
                    "maxOverallUploadLimit": value.get("max-overall-upload-limit").cloned().unwrap_or(Value::Null),
                    "lowestSpeedLimit": value.get("lowest-speed-limit").cloned().unwrap_or(Value::Null),
                    "maxConcurrentDownloads": value.get("max-concurrent-downloads").cloned().unwrap_or(Value::Null)
                },
                "mirrors": mirror_payload.clone(),
                "note": "下载目录与并发数由客户端设置管理，这里只读"
            }),
        ),
        Err(message) => (502, error_body("engine_unavailable", &message)),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ApiSpeedLimitRequest {
    #[serde(default)]
    max_download_limit: Option<u64>,
    #[serde(default)]
    max_upload_limit: Option<u64>,
    #[serde(default)]
    lowest_speed_limit: Option<u64>,
}

fn set_global_speed_limit(config: &Aria2RpcConfig, body: &[u8]) -> (u16, Value) {
    let request: ApiSpeedLimitRequest = match serde_json::from_slice(body) {
        Ok(value) => value,
        Err(error) => {
            return (
                400,
                error_body("invalid_json", &format!("请求体解析失败: {error}")),
            )
        }
    };

    let mut options = serde_json::Map::new();
    if let Some(value) = request.max_download_limit {
        options.insert(
            "max-overall-download-limit".to_string(),
            json!(value.to_string()),
        );
    }
    if let Some(value) = request.max_upload_limit {
        options.insert(
            "max-overall-upload-limit".to_string(),
            json!(value.to_string()),
        );
    }
    if let Some(value) = request.lowest_speed_limit {
        options.insert("lowest-speed-limit".to_string(), json!(value.to_string()));
    }
    if options.is_empty() {
        return (
            400,
            error_body(
                "invalid_request",
                "至少要给一个限速字段（maxDownloadLimit / maxUploadLimit / lowestSpeedLimit），0 表示不限速",
            ),
        );
    }

    let applied = Value::Object(options.clone());
    let config = config.clone();
    let result: Result<String, String> = tauri::async_runtime::block_on(async move {
        let client = reqwest::Client::new();
        rpc_call::<String>(
            &client,
            &config,
            "aria2.changeGlobalOption",
            vec![Value::Object(options)],
        )
        .await
    });
    match result {
        Ok(_) => (200, json!({ "ok": true, "applied": applied })),
        Err(message) => (502, error_body("engine_error", &message)),
    }
}

fn error_body(code: &str, message: &str) -> Value {
    json!({ "ok": false, "error": { "code": code, "message": message } })
}

fn read_request(stream: &mut TcpStream) -> Result<Request, String> {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 2048];
    let head_end = loop {
        if let Some(position) = find_subsequence(&buffer, b"\r\n\r\n") {
            break position;
        }
        if buffer.len() > MAX_HEAD_BYTES {
            return Err("请求头过大".to_string());
        }
        let read = stream.read(&mut chunk).map_err(|error| error.to_string())?;
        if read == 0 {
            return Err("连接提前关闭".to_string());
        }
        buffer.extend_from_slice(&chunk[..read]);
    };

    let head = String::from_utf8_lossy(&buffer[..head_end]).to_string();
    let mut lines = head.split("\r\n");
    let mut request_line = lines.next().unwrap_or_default().split_whitespace();
    let method = request_line.next().unwrap_or_default().to_ascii_uppercase();
    let raw_path = request_line.next().unwrap_or("/").to_string();
    let path = raw_path.split('?').next().unwrap_or("/").to_string();

    let mut headers = Vec::new();
    for line in lines {
        if let Some(index) = line.find(':') {
            headers.push((
                line[..index].trim().to_ascii_lowercase(),
                line[index + 1..].trim().to_string(),
            ));
        }
    }

    let content_length = headers
        .iter()
        .find(|(key, _)| key == "content-length")
        .and_then(|(_, value)| value.parse::<usize>().ok())
        .unwrap_or(0);
    if content_length > MAX_BODY_BYTES {
        return Err("请求体过大".to_string());
    }

    let mut body = buffer[head_end + 4..].to_vec();
    while body.len() < content_length {
        let read = stream.read(&mut chunk).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..read]);
    }
    body.truncate(content_length);

    Ok(Request {
        method,
        path,
        headers,
        body,
    })
}

fn write_json(stream: &mut TcpStream, status: u16, body: Value) {
    let payload = body.to_string();
    let head = format!(
        "HTTP/1.1 {status} {}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: X-Api-Token, Content-Type\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        status_text(status),
        payload.as_bytes().len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(payload.as_bytes());
    let _ = stream.flush();
}

fn status_text(status: u16) -> &'static str {
    match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        502 => "Bad Gateway",
        _ => "Internal Server Error",
    }
}

fn token_matches(provided: &str, expected: &str) -> bool {
    if provided.len() != expected.len() || provided.is_empty() {
        return false;
    }
    let mut difference = 0u8;
    for (left, right) in provided.bytes().zip(expected.bytes()) {
        difference |= left ^ right;
    }
    difference == 0
}

fn find_subsequence(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

#[tauri::command]
pub fn api_get_info(shared: tauri::State<'_, Arc<ApiShared>>) -> Value {
    json!({
        "port": API_PORT,
        "enabled": shared.enabled.load(Ordering::SeqCst),
        "running": shared.listening.load(Ordering::SeqCst),
        "token": shared.token
    })
}

#[tauri::command]
pub fn api_set_enabled(
    app: tauri::AppHandle,
    enabled: bool,
    shared: tauri::State<'_, Arc<ApiShared>>,
) -> Value {
    save_enabled(&app, enabled);
    shared.enabled.store(enabled, Ordering::SeqCst);

    if enabled {
        spawn_listener(shared.inner().clone());
    } else {
        // 等监听循环退出，避免返回"已关闭"但端口还占用
        for _ in 0..10 {
            if !shared.listening.load(Ordering::SeqCst) {
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }
    }

    json!({
        "ok": true,
        "port": API_PORT,
        "enabled": enabled,
        "running": shared.listening.load(Ordering::SeqCst),
        "token": shared.token
    })
}

#[tauri::command]
pub fn api_update_mirrors(
    mirrors: Vec<MirrorEntryDto>,
    active_id: String,
    shared: tauri::State<'_, Arc<ApiShared>>,
) -> Result<(), String> {
    let mut guard = shared
        .mirrors
        .lock()
        .map_err(|_| "镜像配置状态不可用".to_string())?;
    *guard = MirrorSnapshot {
        active_id,
        list: mirrors,
    };
    Ok(())
}

#[tauri::command]
pub fn api_update_config(
    config: Aria2RpcConfig,
    shared: tauri::State<'_, Arc<ApiShared>>,
) -> Result<(), String> {
    let mut guard = shared
        .config
        .lock()
        .map_err(|_| "配置状态不可用".to_string())?;
    *guard = config;
    Ok(())
}
