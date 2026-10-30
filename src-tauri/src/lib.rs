mod api_server;
mod local_plugin_crypto;

use flate2::read::GzDecoder;
use local_plugin_crypto::{
    is_encrypted_local_plugin_path, read_encrypted_local_plugin, ENCRYPTED_LOCAL_PLUGIN_EXTENSION,
};
use reqwest::header::{HeaderMap, HeaderValue, COOKIE, REFERER, USER_AGENT};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::fs::File;
use std::hash::{Hash, Hasher};
use std::io::Read;
use std::io::Write;
use std::net::{TcpListener, UdpSocket};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, UNIX_EPOCH};
use tauri::Manager;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Aria2RpcConfig {
    rpc_port: u16,
    rpc_secret: String,
    aria2_executable_path: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskAdvancedOptions {
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskBtOptions {
    auto_download_torrent: bool,
    force_encrypt: bool,
    keep_seeding: bool,
    seed_ratio: f64,
    seed_time_minutes: u64,
    #[serde(default)]
    tracker_list: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TorrentFilePayload {
    name: String,
    content_base64: String,
    #[serde(default)]
    size_bytes: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateTaskPayload {
    #[serde(default, alias = "url", alias = "urls", alias = "link")]
    links: Vec<String>,
    #[serde(default)]
    torrent_files: Vec<TorrentFilePayload>,
    #[serde(default, alias = "name", alias = "filename")]
    rename: String,
    #[serde(default, alias = "split")]
    split_count: u32,
    #[serde(default, alias = "maxConnectionsPerServer")]
    max_connection_per_server: u32,
    #[serde(default, alias = "dir", alias = "path", alias = "dst", alias = "out")]
    save_path: String,
    #[serde(default)]
    advanced: TaskAdvancedOptions,
    #[serde(default)]
    checksum: String,
    #[serde(default)]
    max_download_limit: u64,
    #[serde(default)]
    max_upload_limit: u64,
    #[serde(default)]
    lowest_speed_limit: u64,
    #[serde(default)]
    bt_options: Option<TaskBtOptions>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddTasksRequest {
    payload: CreateTaskPayload,
    config: Aria2RpcConfig,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartTaskRequest {
    task_id: String,
    split_count: u32,
    max_connection_per_server: u32,
    config: Aria2RpcConfig,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskDetailRequest {
    task_id: String,
    #[serde(default)]
    probe_trackers: bool,
    config: Aria2RpcConfig,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GlobalSpeedLimitRequest {
    upload_limit_bytes: u64,
    download_limit_bytes: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GlobalBtOptionsRequest {
    auto_download_torrent: bool,
    force_encrypt: bool,
    keep_seeding: bool,
    seed_ratio: f64,
    seed_time_minutes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskFileDto {
    index: u32,
    path: String,
    length: u64,
    completed_length: u64,
    selected: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadTaskDto {
    id: String,
    source_type: String,
    url: String,
    name: String,
    status: String,
    split_count: u32,
    save_path: String,
    total_bytes: u64,
    downloaded_bytes: u64,
    speed_bytes: u64,
    upload_speed_bytes: u64,
    created_at: u64,
    completed_at: Option<u64>,
    bitfield: String,
    piece_length: u64,
    connections: u32,
    error_code: String,
    error_message: String,
    files: Vec<TaskFileDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TorrentPeerDto {
    address: String,
    client: String,
    progress: f64,
    download_speed_bytes: u64,
    upload_speed_bytes: u64,
    flag: String,
    is_seeder: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TorrentTrackerDto {
    index: u32,
    url: String,
    protocol: String,
    status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TorrentTaskDetailDto {
    info_hash: String,
    comment: String,
    created_at: Option<u64>,
    mode: String,
    piece_count: u32,
    piece_length: u64,
    upload_speed_bytes: u64,
    uploaded_bytes: u64,
    seeders: u32,
    connections: u32,
    peers: Vec<TorrentPeerDto>,
    trackers: Vec<TorrentTrackerDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadTaskDetailDto {
    torrent: Option<TorrentTaskDetailDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginInstalledDto {
    id: String,
    name: String,
    description: String,
    version: String,
    author: String,
    #[serde(default)]
    homepage: Option<String>,
    #[serde(default)]
    repository: Option<String>,
    #[serde(default)]
    license: Option<String>,
    #[serde(default = "default_plugin_source_type")]
    source_type: String,
    #[serde(default)]
    package_path: Option<String>,
    #[serde(default)]
    manifest_path: Option<String>,
    #[serde(default)]
    package_size_bytes: Option<u64>,
    #[serde(default = "default_plugin_menu_enabled")]
    menu_enabled: bool,
    #[serde(default)]
    menu_title: Option<String>,
    #[serde(default)]
    menu_route_path: Option<String>,
    #[serde(default)]
    menu_icon: Option<String>,
    #[serde(default)]
    menu_group: Option<String>,
    enabled: bool,
    installed_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginDiscoverDto {
    id: String,
    name: String,
    description: String,
    version: String,
    author: String,
    downloads: String,
    rating: f32,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginState {
    installed: Vec<PluginInstalledDto>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalPluginManifestMenuDto {
    #[serde(default)]
    enabled: bool,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    route_path: Option<String>,
    #[serde(default)]
    icon: Option<String>,
    #[serde(default)]
    group: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalPluginManifestDto {
    #[serde(default)]
    id: Option<String>,
    name: String,
    #[serde(default)]
    description: Option<String>,
    version: String,
    author: String,
    #[serde(default)]
    homepage: Option<String>,
    #[serde(default)]
    repository: Option<String>,
    #[serde(default)]
    license: Option<String>,
    #[serde(default)]
    menu: Option<LocalPluginManifestMenuDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PluginImportPrecheckDto {
    file_path: String,
    file_extension: String,
    package_size_bytes: u64,
    manifest_path: String,
    plugin_id: String,
    plugin_name: String,
    plugin_version: String,
    plugin_author: String,
    menu_enabled: bool,
    menu_title: Option<String>,
    menu_route_path: Option<String>,
    menu_icon: Option<String>,
    menu_group: Option<String>,
    route_conflict_with: Option<String>,
    title_conflict_with: Option<String>,
    suggested_menu_title: Option<String>,
    suggested_menu_route_path: Option<String>,
    upgrade_from_version: Option<String>,
    is_upgrade: bool,
    warnings: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginImportOptionsDto {
    #[serde(default)]
    version_policy: Option<String>,
    #[serde(default)]
    menu_title_override: Option<String>,
    #[serde(default)]
    menu_route_path_override: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Aria2RpcError {
    code: i64,
    message: String,
}

#[derive(Debug, Deserialize)]
struct Aria2RpcResponse<T> {
    result: Option<T>,
    error: Option<Aria2RpcError>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Aria2Status {
    gid: String,
    status: String,
    total_length: String,
    completed_length: String,
    download_speed: String,
    upload_length: Option<String>,
    upload_speed: Option<String>,
    dir: Option<String>,
    files: Vec<Aria2File>,
    bittorrent: Option<Aria2BitTorrent>,
    info_hash: Option<String>,
    num_seeders: Option<String>,
    error_code: Option<String>,
    error_message: Option<String>,
    num_pieces: Option<String>,
    bitfield: Option<String>,
    piece_length: Option<String>,
    connections: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Aria2File {
    index: Option<String>,
    path: Option<String>,
    length: Option<String>,
    completed_length: Option<String>,
    selected: Option<String>,
    uris: Option<Vec<Aria2Uri>>,
}

#[derive(Debug, Deserialize)]
struct Aria2Uri {
    uri: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Aria2BitTorrent {
    announce_list: Option<Vec<Vec<String>>>,
    comment: Option<String>,
    creation_date: Option<u64>,
    mode: Option<String>,
    info: Option<Aria2TorrentInfo>,
}

#[derive(Debug, Deserialize)]
struct Aria2TorrentInfo {
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Aria2Peer {
    peer_id: Option<String>,
    ip: Option<String>,
    port: Option<String>,
    bitfield: Option<String>,
    am_choking: Option<String>,
    peer_choking: Option<String>,
    download_speed: Option<String>,
    upload_speed: Option<String>,
    seeder: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Aria2VersionResult {
    version: String,
    enabled_features: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Aria2VersionDto {
    version: String,
    enabled_features: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskOptionConstraintsDto {
    min_split_count: u32,
    max_split_count: u32,
    max_connection_per_server: u32,
    default_split_count: u32,
    default_max_connections_per_server: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListenPortProbeRequest {
    bt_port: u16,
    dht_port: u16,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ListenPortProbeItemDto {
    port: u16,
    tcp_available: bool,
    udp_available: bool,
    available: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ListenPortProbeDto {
    bt: ListenPortProbeItemDto,
    dht: ListenPortProbeItemDto,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppFileMetaDto {
    size_bytes: u64,
    modified_at: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HttpJsonRequestDto {
    url: String,
    #[serde(default)]
    headers: HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HttpRequestJsonDto {
    method: Option<String>,
    url: String,
    #[serde(default)]
    headers: HashMap<String, String>,
    body: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WebviewCookieDto {
    name: String,
    value: String,
    domain: Option<String>,
    path: Option<String>,
}

#[derive(Debug, Deserialize)]
struct BilibiliApiResponse<T> {
    code: i64,
    message: String,
    data: Option<T>,
}

#[derive(Debug, Deserialize)]
struct BilibiliViewData {
    pages: Vec<BilibiliViewPage>,
}

#[derive(Debug, Deserialize)]
struct BilibiliViewPage {
    cid: u64,
}

#[derive(Debug, Deserialize)]
struct BilibiliPlayData {
    dash: Option<BilibiliDashData>,
    durl: Option<Vec<BilibiliDurlItem>>,
}

#[derive(Debug, Deserialize)]
struct BilibiliDashData {
    video: Vec<BilibiliDashStreamItem>,
    audio: Vec<BilibiliDashStreamItem>,
}

#[derive(Debug, Deserialize)]
struct BilibiliDashStreamItem {
    id: i64,
    #[serde(rename = "baseUrl", alias = "base_url")]
    base_url: String,
}

#[derive(Debug, Deserialize)]
struct BilibiliDurlItem {
    url: String,
}

const MIN_SPLIT_COUNT: u32 = 1;
const MAX_SPLIT_COUNT: u32 = 512;
const MAX_CONNECTION_PER_SERVER: u32 = 512;
const DEFAULT_SPLIT_COUNT: u32 = 128;
const DEFAULT_MAX_CONNECTIONS_PER_SERVER: u32 = 64;
#[cfg(target_os = "windows")]
const MOD_ARIA2_REPO_API: &str = "https://api.github.com/repos/DoTheBetter/aria2_build/releases/latest";
#[cfg(target_os = "windows")]
const MOD_ARIA2_ASSET_KEYWORD: &str = "x86_64-w64-mingw32_static";
const LOCAL_PLUGIN_ALLOWED_EXTENSIONS: [&str; 9] =
    ["zip", "tar", "tgz", "gz", "7z", "js", "mjs", "cjs", ENCRYPTED_LOCAL_PLUGIN_EXTENSION];
const LOCAL_PLUGIN_SCRIPT_EXTENSIONS: [&str; 3] = ["js", "mjs", "cjs"];
const PLUGIN_MENU_ICON_WHITELIST: [&str; 8] = ["puzzle", "globe", "cloud", "database", "film", "music", "shield", "link"];

fn default_plugin_source_type() -> String {
    "market".to_string()
}

fn default_plugin_menu_enabled() -> bool {
    false
}

fn rpc_endpoint(config: &Aria2RpcConfig) -> String {
    format!("http://127.0.0.1:{}/jsonrpc", config.rpc_port)
}

fn is_auth_error(message: &str) -> bool {
    let text = message.to_lowercase();
    text.contains("401") || text.contains("unauthorized") || text.contains("token") || text.contains("secret")
}

fn normalize_task_transfer_options(split_count: u32, max_connection_per_server: u32) -> (u32, u32) {
    let normalized_split = split_count.clamp(MIN_SPLIT_COUNT, MAX_SPLIT_COUNT);
    let normalized_max_connection = max_connection_per_server.clamp(MIN_SPLIT_COUNT, MAX_CONNECTION_PER_SERVER);
    (normalized_split, normalized_max_connection)
}

fn sanitize_link_input(source: &str) -> String {
    let mut cleaned = source.trim();
    loop {
        let trimmed = cleaned.trim();
        let has_wrapping_pair =
            (trimmed.starts_with('`') && trimmed.ends_with('`'))
                || (trimmed.starts_with('"') && trimmed.ends_with('"'))
                || (trimmed.starts_with('\'') && trimmed.ends_with('\''));
        if has_wrapping_pair && trimmed.len() >= 2 {
            cleaned = &trimmed[1..trimmed.len() - 1];
        } else {
            cleaned = trimmed;
            break;
        }
    }
    cleaned.trim().to_string()
}

struct ValidatedTaskParameters {
    links: Vec<String>,
    torrent_files: Vec<TorrentFilePayload>,
    save_path: String,
    rename: String,
    split_count: u32,
    max_connection_per_server: u32,
}

fn validate_task_parameters(payload: &CreateTaskPayload) -> Result<ValidatedTaskParameters, String> {
    let (split_count, max_connection_per_server) =
        normalize_task_transfer_options(payload.split_count, payload.max_connection_per_server);
    let save_path = payload.save_path.trim().to_string();
    if save_path.is_empty() {
        return Err("存储路径不能为空".to_string());
    }
    let rename = payload.rename.trim().to_string();
    let links = payload
        .links
        .iter()
        .map(|item| sanitize_link_input(item))
        .filter(|item| !item.is_empty() && !item.starts_with("torrent://"))
        .collect::<Vec<_>>();
    let torrent_files = payload
        .torrent_files
        .iter()
        .filter_map(|item| {
            let name = item.name.trim().to_string();
            let content_base64 = item.content_base64.trim().to_string();
            if name.is_empty() || content_base64.is_empty() {
                return None;
            }
            Some(TorrentFilePayload {
                name,
                content_base64,
                size_bytes: item.size_bytes,
            })
        })
        .collect::<Vec<_>>();
    if links.is_empty() && torrent_files.is_empty() {
        return Err("请至少提供一个下载链接或种子文件".to_string());
    }
    Ok(ValidatedTaskParameters {
        links,
        torrent_files,
        save_path,
        rename,
        split_count,
        max_connection_per_server,
    })
}

// 自己拉起的 aria2 子进程句柄与它使用的 RPC 配置，退出时必须回收，否则会残留占着 RPC 端口
static ARIA2_CHILD: std::sync::Mutex<Option<std::process::Child>> = std::sync::Mutex::new(None);
static ARIA2_RPC: std::sync::Mutex<Option<Aria2RpcConfig>> = std::sync::Mutex::new(None);

fn remember_engine_child(child: std::process::Child) {
    if let Ok(mut slot) = ARIA2_CHILD.lock() {
        if let Some(mut previous) = slot.take() {
            let _ = previous.kill();
            let _ = previous.wait();
        }
        *slot = Some(child);
    }
}

// 退出前先让 aria2 自己收尾（落盘 .aria2 控制文件），比直接 kill 更不容易丢进度
fn request_engine_shutdown(config: &Aria2RpcConfig) {
    let address = match format!("127.0.0.1:{}", config.rpc_port).parse() {
        Ok(address) => address,
        Err(_) => return,
    };
    let mut stream =
        match std::net::TcpStream::connect_timeout(&address, Duration::from_millis(600)) {
            Ok(stream) => stream,
            Err(_) => return,
        };
    let params = if config.rpc_secret.trim().is_empty() {
        Vec::new()
    } else {
        vec![format!("token:{}", config.rpc_secret.trim())]
    };
    let payload = json!({
        "jsonrpc": "2.0",
        "id": "shutdown",
        "method": "aria2.forceShutdown",
        "params": params
    })
    .to_string();
    let request = format!(
        "POST /jsonrpc HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        payload.len(),
        payload
    );
    let _ = stream.set_write_timeout(Some(Duration::from_millis(600)));
    let _ = stream.write_all(request.as_bytes());
    let _ = stream.flush();
}

fn terminate_engine() {
    let config = ARIA2_RPC.lock().ok().and_then(|guard| guard.clone());
    if let Some(config) = config {
        request_engine_shutdown(&config);
    }
    if let Ok(mut slot) = ARIA2_CHILD.lock() {
        if let Some(mut child) = slot.take() {
            for _ in 0..15 {
                match child.try_wait() {
                    Ok(Some(_)) => return,
                    Ok(None) => std::thread::sleep(Duration::from_millis(100)),
                    Err(_) => break,
                }
            }
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn spawn_aria2_with_path(executable: &PathBuf, config: &Aria2RpcConfig) -> Result<(), String> {
    let mut command = Command::new(executable);
    command
        .arg("--enable-rpc=true")
        .arg("--rpc-listen-all=false")
        .arg(format!("--rpc-listen-port={}", config.rpc_port))
        .arg("--allow-overwrite=true")
        .arg("--continue=true")
        .arg("--auto-file-renaming=false")
        .arg("--no-conf=true")
        .arg("--max-overall-download-limit=0")
        .arg("--max-overall-upload-limit=0")
        .arg("--lowest-speed-limit=0")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .stdin(Stdio::null());
    if !config.rpc_secret.trim().is_empty() {
        command.arg(format!("--rpc-secret={}", config.rpc_secret.trim()));
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let child = command.spawn().map_err(|error| error.to_string())?;
    remember_engine_child(child);
    Ok(())
}

fn collect_aria2_candidates(config: &Aria2RpcConfig) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if !config.aria2_executable_path.trim().is_empty() {
        candidates.push(PathBuf::from(config.aria2_executable_path.trim()));
    }
    #[cfg(target_os = "windows")]
    {
        if let Ok(managed_executable) = managed_aria2_executable_path() {
            candidates.push(managed_executable);
        }
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                candidates.push(exe_dir.join("aria2c.exe"));
                candidates.push(exe_dir.join("resources").join("aria2c.exe"));
                candidates.push(exe_dir.join("resources").join("aria2").join("aria2c.exe"));
            }
        }
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            candidates.push(PathBuf::from(local_app_data).join("Programs").join("aria2").join("aria2c.exe"));
        }
        if let Ok(program_files) = std::env::var("ProgramFiles") {
            candidates.push(PathBuf::from(program_files).join("aria2").join("aria2c.exe"));
        }
        if let Ok(program_files_x86) = std::env::var("ProgramFiles(x86)") {
            candidates.push(PathBuf::from(program_files_x86).join("aria2").join("aria2c.exe"));
        }
    }
    candidates.push(PathBuf::from("aria2c"));
    candidates
}

#[cfg(target_os = "windows")]
fn managed_aria2_executable_path() -> Result<PathBuf, String> {
    let local_app_data =
        std::env::var("LOCALAPPDATA").map_err(|error| format!("读取 LOCALAPPDATA 失败: {error}"))?;
    Ok(PathBuf::from(local_app_data)
        .join("tauri-app")
        .join("aria2-mod")
        .join("aria2c.exe"))
}

#[cfg(target_os = "windows")]
fn powershell_single_quote_escape(value: &str) -> String {
    value.replace('\'', "''")
}

#[cfg(target_os = "windows")]
fn install_or_update_mod_aria2_with_repo() -> Result<PathBuf, String> {
    let executable_path = managed_aria2_executable_path()?;
    let base_dir = executable_path
        .parent()
        .ok_or_else(|| "魔改 aria2 目录无效".to_string())?
        .to_path_buf();
    fs::create_dir_all(&base_dir).map_err(|error| format!("创建魔改 aria2 目录失败: {error}"))?;

    let base_dir_text = powershell_single_quote_escape(&base_dir.to_string_lossy());
    let executable_path_text = powershell_single_quote_escape(&executable_path.to_string_lossy());
    let script = format!(
        "$ErrorActionPreference='Stop';\
        $repoApi='{repo_api}';\
        $assetKeyword='{asset_keyword}';\
        $baseDir='{base_dir}';\
        $exePath='{exe_path}';\
        $zipPath=Join-Path $baseDir 'aria2-mod.zip';\
        $extractDir=Join-Path $baseDir 'extract';\
        if (Test-Path $zipPath) {{ Remove-Item $zipPath -Force -ErrorAction SilentlyContinue }};\
        if (Test-Path $extractDir) {{ Remove-Item $extractDir -Recurse -Force }};\
        New-Item -ItemType Directory -Path $baseDir -Force | Out-Null;\
        $release=Invoke-RestMethod -Uri $repoApi -UseBasicParsing -Headers @{{ 'User-Agent'='tauri-app-updater' }};\
        $asset=$release.assets | Where-Object {{ $_.name -like ('*' + $assetKeyword + '*') -and $_.name -like '*.zip' }} | Select-Object -First 1;\
        if (-not $asset) {{ throw '未找到可用的魔改 aria2 资源包' }};\
        Invoke-WebRequest -Uri $asset.browser_download_url -UseBasicParsing -OutFile $zipPath -Headers @{{ 'User-Agent'='tauri-app-updater' }};\
        Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force;\
        $exe=Get-ChildItem -Path $extractDir -Filter 'aria2c.exe' -Recurse | Select-Object -First 1;\
        if (-not $exe) {{ throw '压缩包中未找到 aria2c.exe' }};\
        Copy-Item -Path $exe.FullName -Destination $exePath -Force",
        repo_api = MOD_ARIA2_REPO_API,
        asset_keyword = MOD_ARIA2_ASSET_KEYWORD,
        base_dir = base_dir_text,
        exe_path = executable_path_text
    );

    let mut command = Command::new("powershell");
    command
        .arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-Command")
        .arg(script)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .stdin(Stdio::null());
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let status = command.status().map_err(|error| error.to_string())?;
    if !status.success() {
        return Err(format!("拉取魔改 aria2 失败，退出码 {:?}", status.code()));
    }
    if !executable_path.exists() {
        return Err("拉取魔改 aria2 后未找到可执行文件".to_string());
    }
    Ok(executable_path)
}

#[cfg(target_os = "windows")]
fn has_explicit_or_bundled_aria2(config: &Aria2RpcConfig) -> bool {
    if !config.aria2_executable_path.trim().is_empty() {
        return true;
    }
    if let Ok(managed_executable) = managed_aria2_executable_path() {
        if managed_executable.exists() {
            return true;
        }
    }
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let bundled_candidates = [
                exe_dir.join("aria2c.exe"),
                exe_dir.join("resources").join("aria2c.exe"),
                exe_dir.join("resources").join("aria2").join("aria2c.exe"),
            ];
            if bundled_candidates.iter().any(|candidate| candidate.exists()) {
                return true;
            }
        }
    }
    false
}

#[cfg(target_os = "windows")]
fn install_aria2_with_winget() -> Result<(), String> {
    let mut command = Command::new("winget");
    command
        .arg("install")
        .arg("--id")
        .arg("aria2.aria2")
        .arg("-e")
        .arg("--silent")
        .arg("--accept-package-agreements")
        .arg("--accept-source-agreements")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .stdin(Stdio::null());
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let status = command.status().map_err(|error| error.to_string())?;
    if status.success() {
        return Ok(());
    }
    Err(format!("winget 安装失败，退出码 {:?}", status.code()))
}

#[cfg(target_os = "windows")]
fn upgrade_aria2_with_winget() -> Result<(), String> {
    let mut command = Command::new("winget");
    command
        .arg("upgrade")
        .arg("--id")
        .arg("aria2.aria2")
        .arg("-e")
        .arg("--silent")
        .arg("--accept-package-agreements")
        .arg("--accept-source-agreements")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .stdin(Stdio::null());
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let status = command.status().map_err(|error| error.to_string())?;
    if status.success() {
        return Ok(());
    }
    Err(format!("winget 升级失败，退出码 {:?}", status.code()))
}

#[cfg(target_os = "windows")]
fn update_or_install_aria2_with_winget() -> Result<(), String> {
    if upgrade_aria2_with_winget().is_ok() {
        return Ok(());
    }
    install_aria2_with_winget()
}

fn start_aria2_process(config: &Aria2RpcConfig) -> Result<(), String> {
    if let Ok(mut slot) = ARIA2_RPC.lock() {
        *slot = Some(config.clone());
    }
    let candidates = collect_aria2_candidates(config);
    let mut failures = Vec::new();
    for candidate in &candidates {
        let is_named_command = candidate.components().count() == 1;
        if !is_named_command && !candidate.exists() {
            continue;
        }
        match spawn_aria2_with_path(candidate, config) {
            Ok(()) => return Ok(()),
            Err(error) => failures.push(format!("{} => {}", candidate.display(), error)),
        }
    }
    #[cfg(target_os = "windows")]
    {
        if install_or_update_mod_aria2_with_repo().is_ok() {
            for candidate in collect_aria2_candidates(config) {
                let is_named_command = candidate.components().count() == 1;
                if !is_named_command && !candidate.exists() {
                    continue;
                }
                if spawn_aria2_with_path(&candidate, config).is_ok() {
                    return Ok(());
                }
            }
        }
        if install_aria2_with_winget().is_ok() {
            for candidate in collect_aria2_candidates(config) {
                let is_named_command = candidate.components().count() == 1;
                if !is_named_command && !candidate.exists() {
                    continue;
                }
                if spawn_aria2_with_path(&candidate, config).is_ok() {
                    return Ok(());
                }
            }
        }
    }
    let details = if failures.is_empty() {
        "无可用可执行路径".to_string()
    } else {
        failures.join(" | ")
    };
    Err(format!(
        "启动 aria2c 失败。请先安装 aria2c，或在进阶设置中填写可执行文件路径。详情: {}",
        details
    ))
}

async fn wait_aria2_online(client: &Client, config: &Aria2RpcConfig) -> bool {
    for _ in 0..30 {
        std::thread::sleep(Duration::from_millis(500));
        if rpc_call::<Aria2VersionResult>(client, config, "aria2.getVersion", vec![])
            .await
            .is_ok()
        {
            return true;
        }
    }
    false
}

fn parse_u64(value: &str) -> u64 {
    value.parse::<u64>().unwrap_or(0)
}

fn parse_u32(value: &str) -> u32 {
    value.parse::<u32>().unwrap_or(0)
}

fn first_non_empty(values: &[Option<String>]) -> Option<String> {
    values
        .iter()
        .find_map(|value| value.as_ref().filter(|item| !item.trim().is_empty()).cloned())
}

fn build_headers(advanced: &TaskAdvancedOptions) -> Vec<String> {
    let mut headers = Vec::new();
    if !advanced.authorization.trim().is_empty() {
        headers.push(format!("Authorization: {}", advanced.authorization.trim()));
    }
    if !advanced.cookie.trim().is_empty() {
        headers.push(format!("Cookie: {}", advanced.cookie.trim()));
    }
    headers
}

fn source_type_from_status(status: &Aria2Status) -> String {
    let has_info_hash = status
        .info_hash
        .as_ref()
        .is_some_and(|item| !item.trim().is_empty());
    if has_info_hash || status.bittorrent.is_some() {
        "torrent".to_string()
    } else {
        "link".to_string()
    }
}

fn filename_from_path(path: &str) -> Option<String> {
    std::path::Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.to_string())
}

fn count_completed_bits(hex: &str, max_bits: u32) -> u32 {
    if max_bits == 0 {
        return 0;
    }
    let mut completed = 0u32;
    for ch in hex.chars() {
        if let Some(value) = ch.to_digit(16) {
            for offset in (0..4).rev() {
                if completed >= max_bits {
                    return completed;
                }
                if (value >> offset) & 1 == 1 {
                    completed += 1;
                }
            }
        }
    }
    completed.min(max_bits)
}

fn normalize_tracker_protocol(url: &str) -> String {
    let lower = url.trim().to_ascii_lowercase();
    if lower.starts_with("https://") {
        "https".to_string()
    } else if lower.starts_with("http://") {
        "http".to_string()
    } else if lower.starts_with("udp://") {
        "udp".to_string()
    } else {
        "unknown".to_string()
    }
}

fn normalize_bt_tracker_value(raw: &str) -> String {
    let mut seen = HashSet::new();
    raw.replace('\r', "\n")
        .split(|ch| ch == '\n' || ch == ',')
        .map(|item| item.trim())
        .filter(|item| !item.is_empty())
        .filter_map(|item| {
            let owned = item.to_string();
            if seen.insert(owned.clone()) {
                Some(owned)
            } else {
                None
            }
        })
        .collect::<Vec<_>>()
        .join(",")
}

fn build_peer_flags(peer: &Aria2Peer) -> String {
    let mut flags = String::new();
    if peer.am_choking.as_deref() == Some("false") {
        flags.push('U');
    }
    if peer.peer_choking.as_deref() == Some("false") {
        flags.push('D');
    }
    if flags.is_empty() {
        "—".to_string()
    } else {
        flags
    }
}

async fn probe_tracker_status(url: &str) -> String {
    let protocol = normalize_tracker_protocol(url);
    if protocol != "http" && protocol != "https" {
        return "unknown".to_string();
    }
    let client = match Client::builder()
        .timeout(Duration::from_secs(4))
        .redirect(reqwest::redirect::Policy::limited(3))
        .build()
    {
        Ok(client) => client,
        Err(_) => return "unknown".to_string(),
    };
    if client.head(url).send().await.is_ok() {
        return "online".to_string();
    }
    if client.get(url).send().await.is_ok() {
        return "online".to_string();
    }
    "offline".to_string()
}

async fn build_tracker_rows(status: &Aria2Status, probe_trackers: bool) -> Vec<TorrentTrackerDto> {
    let mut trackers = Vec::new();
    let mut seen = HashSet::new();
    if let Some(announce_list) = status
        .bittorrent
        .as_ref()
        .and_then(|item| item.announce_list.as_ref())
    {
        for urls in announce_list {
            for url in urls {
                let trimmed = url.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let owned = trimmed.to_string();
                if !seen.insert(owned.clone()) {
                    continue;
                }
                let protocol = normalize_tracker_protocol(&owned);
                let tracker_status = if probe_trackers {
                    probe_tracker_status(&owned).await
                } else {
                    "unknown".to_string()
                };
                trackers.push(TorrentTrackerDto {
                    index: trackers.len() as u32 + 1,
                    url: owned,
                    protocol,
                    status: tracker_status,
                });
            }
        }
    }
    trackers
}

async fn build_peer_rows(client: &Client, config: &Aria2RpcConfig, status: &Aria2Status) -> Vec<TorrentPeerDto> {
    let peers: Vec<Aria2Peer> = rpc_call(client, config, "aria2.getPeers", vec![json!(status.gid.clone())])
        .await
        .unwrap_or_default();
    let piece_count = status.num_pieces.as_deref().map(parse_u32).unwrap_or(0);
    peers
        .into_iter()
        .map(|peer| {
            let ip = peer.ip.clone().unwrap_or_default();
            let port = peer.port.clone().unwrap_or_default();
            let address = match (ip.trim().is_empty(), port.trim().is_empty()) {
                (true, _) => "未知".to_string(),
                (false, true) => ip,
                (false, false) => format!("{}:{}", ip, port),
            };
            let completed_pieces = peer
                .bitfield
                .as_deref()
                .map(|item| count_completed_bits(item, piece_count))
                .unwrap_or(0);
            let progress = if piece_count == 0 {
                0.0
            } else {
                (completed_pieces as f64 / piece_count as f64) * 100.0
            };
            let client_name = peer
                .peer_id
                .as_deref()
                .filter(|item| !item.trim().is_empty())
                .map(|_| "unknown".to_string())
                .unwrap_or_else(|| "unknown".to_string());
            TorrentPeerDto {
                address,
                client: client_name,
                progress,
                download_speed_bytes: peer.download_speed.as_deref().map(parse_u64).unwrap_or(0),
                upload_speed_bytes: peer.upload_speed.as_deref().map(parse_u64).unwrap_or(0),
                flag: build_peer_flags(&peer),
                is_seeder: peer.seeder.as_deref() == Some("true"),
            }
        })
        .collect()
}

async fn map_task_detail(
    client: &Client,
    config: &Aria2RpcConfig,
    request: &TaskDetailRequest,
) -> Result<DownloadTaskDetailDto, String> {
    let keys = json!([
        "gid",
        "status",
        "totalLength",
        "completedLength",
        "downloadSpeed",
        "uploadLength",
        "uploadSpeed",
        "dir",
        "files",
        "bittorrent",
        "infoHash",
        "numSeeders",
        "errorCode",
        "errorMessage",
        "numPieces",
        "bitfield",
        "pieceLength",
        "connections"
    ]);
    let status: Aria2Status = rpc_call(
        client,
        config,
        "aria2.tellStatus",
        vec![json!(request.task_id.clone()), keys],
    )
    .await?;
    if source_type_from_status(&status) != "torrent" {
        return Ok(DownloadTaskDetailDto { torrent: None });
    }
    let trackers = build_tracker_rows(&status, request.probe_trackers).await;
    let peers = build_peer_rows(client, config, &status).await;
    let bittorrent = status.bittorrent.as_ref();
    let created_at = bittorrent
        .and_then(|item| item.creation_date)
        .map(|value| value.saturating_mul(1000));
    Ok(DownloadTaskDetailDto {
        torrent: Some(TorrentTaskDetailDto {
            info_hash: status.info_hash.unwrap_or_default(),
            comment: bittorrent.and_then(|item| item.comment.clone()).unwrap_or_default(),
            created_at,
            mode: bittorrent.and_then(|item| item.mode.clone()).unwrap_or_default(),
            piece_count: status.num_pieces.as_deref().map(parse_u32).unwrap_or(0),
            piece_length: status.piece_length.as_deref().map(parse_u64).unwrap_or(0),
            upload_speed_bytes: status.upload_speed.as_deref().map(parse_u64).unwrap_or(0),
            uploaded_bytes: status.upload_length.as_deref().map(parse_u64).unwrap_or(0),
            seeders: status.num_seeders.as_deref().map(parse_u32).unwrap_or(0),
            connections: status.connections.as_deref().map(parse_u32).unwrap_or(0),
            peers,
            trackers,
        }),
    })
}

fn map_status(status: &Aria2Status) -> String {
    let total = parse_u64(&status.total_length);
    let completed = parse_u64(&status.completed_length);
    let is_completed = total > 0 && completed >= total && status.error_code.as_deref() != Some("1");
    let is_torrent = status.bittorrent.is_some() || status.info_hash.as_ref().map(|item| !item.trim().is_empty()).unwrap_or(false);
    match status.status.as_str() {
        "active" => {
            if is_torrent && is_completed {
                "seeding".to_string()
            } else {
                "downloading".to_string()
            }
        }
        "waiting" | "paused" => "paused".to_string(),
        "complete" => "completed".to_string(),
        "error" => "failed".to_string(),
        "removed" => "stopped".to_string(),
        "stopped" => {
            if is_completed {
                "completed".to_string()
            } else if status.error_code.as_deref().unwrap_or("0") != "0" {
                "failed".to_string()
            } else {
                "stopped".to_string()
            }
        }
        _ => "stopped".to_string(),
    }
}

#[derive(Debug, Clone)]
struct TaskTimes {
    created_at: u64,
    completed_at: Option<u64>,
}

// aria2 不提供创建/完成时间，只能按"首次观察到"记录；编造时间比留空更糟
static TASK_TIMES: std::sync::OnceLock<std::sync::Mutex<HashMap<String, TaskTimes>>> =
    std::sync::OnceLock::new();

fn record_task_times(gid: &str, status_text: &str) -> TaskTimes {
    let now = now_millis();
    let mut map = match TASK_TIMES
        .get_or_init(|| std::sync::Mutex::new(HashMap::new()))
        .lock()
    {
        Ok(guard) => guard,
        Err(_) => {
            return TaskTimes {
                created_at: now,
                completed_at: None,
            }
        }
    };
    if map.len() > 4000 {
        map.clear();
    }
    let entry = map.entry(gid.to_string()).or_insert(TaskTimes {
        created_at: now,
        completed_at: None,
    });
    if entry.created_at == 0 {
        entry.created_at = now;
    }
    if status_text == "completed" {
        if entry.completed_at.is_none() {
            entry.completed_at = Some(now);
        }
    } else {
        entry.completed_at = None;
    }
    entry.clone()
}

fn map_task(status: Aria2Status) -> DownloadTaskDto {
    let source_type = source_type_from_status(&status);
    let file_path = status
        .files
        .first()
        .and_then(|file| file.path.clone())
        .unwrap_or_default();
    let url = status
        .files
        .first()
        .and_then(|file| file.uris.as_ref())
        .and_then(|uris| uris.first())
        .and_then(|uri| uri.uri.clone())
        .unwrap_or_default();
    let name = first_non_empty(&[
        status
            .bittorrent
            .as_ref()
            .and_then(|item| item.info.as_ref())
            .and_then(|item| item.name.clone()),
        filename_from_path(&file_path),
        Some(status.gid.clone()),
    ])
    .unwrap_or_else(|| status.gid.clone());
    let status_text = map_status(&status);
    let total_bytes = parse_u64(&status.total_length);
    let downloaded_bytes = parse_u64(&status.completed_length);
    let speed_bytes = parse_u64(&status.download_speed);
    let split_count = status
        .num_pieces
        .as_ref()
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(1);
    let times = record_task_times(&status.gid, &status_text);
    let bitfield = status.bitfield.unwrap_or_default();
    let piece_length = status.piece_length.as_deref().map(parse_u64).unwrap_or(0);
    let connections = status.connections.as_deref().and_then(|c| c.parse::<u32>().ok()).unwrap_or(0);
    let error_code = status.error_code.unwrap_or_default();
    let error_message = status.error_message.unwrap_or_default();

    let files = status
        .files
        .into_iter()
        .map(|f| TaskFileDto {
            index: f.index.as_deref().and_then(|i| i.parse::<u32>().ok()).unwrap_or(0),
            path: f.path.unwrap_or_default(),
            length: f.length.as_deref().map(parse_u64).unwrap_or(0),
            completed_length: f.completed_length.as_deref().map(parse_u64).unwrap_or(0),
            selected: f.selected.as_deref() == Some("true"),
        })
        .collect();

    DownloadTaskDto {
        id: status.gid,
        source_type,
        url,
        name,
        status: status_text,
        split_count,
        save_path: status.dir.unwrap_or_default(),
        total_bytes,
        downloaded_bytes,
        speed_bytes,
        upload_speed_bytes: status.upload_speed.as_deref().map(parse_u64).unwrap_or(0),
        created_at: times.created_at,
        completed_at: times.completed_at,
        bitfield,
        piece_length,
        connections,
        error_code,
        error_message,
        files,
    }
}

fn build_params(config: &Aria2RpcConfig, params: Vec<Value>) -> Vec<Value> {
    if config.rpc_secret.trim().is_empty() {
        return params;
    }
    let mut merged = Vec::with_capacity(params.len() + 1);
    merged.push(Value::String(format!("token:{}", config.rpc_secret.trim())));
    merged.extend(params);
    merged
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|item| item.as_millis() as u64)
        .unwrap_or(0)
}

fn default_discover_plugins() -> Vec<PluginDiscoverDto> {
    Vec::new()
}

fn plugins_packages_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("获取应用数据目录失败: {error}"))?;
    let packages_dir = app_data_dir.join("plugins").join("packages");
    fs::create_dir_all(&packages_dir).map_err(|error| format!("创建插件目录失败: {error}"))?;
    Ok(packages_dir)
}

fn normalize_local_plugin_key(source: &str) -> String {
    let mut normalized = String::new();
    let mut last_dash = false;
    for ch in source.trim().chars() {
        if ch.is_ascii_alphanumeric() {
            normalized.push(ch.to_ascii_lowercase());
            last_dash = false;
        } else if !last_dash {
            normalized.push('-');
            last_dash = true;
        }
    }
    let trimmed = normalized.trim_matches('-');
    if trimmed.is_empty() {
        return "plugin".to_string();
    }
    trimmed.chars().take(48).collect::<String>()
}

fn build_local_plugin_id(file_path: &Path, file_size: u64) -> String {
    let stem = file_path
        .file_stem()
        .and_then(|item| item.to_str())
        .unwrap_or("plugin");
    let normalized = normalize_local_plugin_key(stem);
    let mut hasher = DefaultHasher::new();
    file_path.to_string_lossy().hash(&mut hasher);
    file_size.hash(&mut hasher);
    let hash = hasher.finish();
    format!("local-{}-{:08x}", normalized, (hash & 0xffff_ffff) as u32)
}

fn normalize_plugin_id(source: &str) -> String {
    let normalized = normalize_local_plugin_key(source);
    if normalized.is_empty() {
        return "local-plugin".to_string();
    }
    normalized
}

fn normalize_menu_route_path(plugin_id: &str, source: Option<&str>) -> String {
    let normalized = source
        .map(normalize_local_plugin_key)
        .filter(|item| !item.is_empty())
        .unwrap_or_else(|| format!("plugin-{}", normalize_plugin_id(plugin_id)));
    let route = format!("/plugins/runtime/{normalized}");
    route
}

fn parse_version_parts(version: &str) -> Vec<u64> {
    version
        .split('.')
        .map(|item| item.trim().parse::<u64>().unwrap_or(0))
        .collect::<Vec<u64>>()
}

fn is_newer_semver(incoming: &str, existing: &str) -> bool {
    let incoming_parts = parse_version_parts(incoming);
    let existing_parts = parse_version_parts(existing);
    let max_len = incoming_parts.len().max(existing_parts.len());
    for idx in 0..max_len {
        let a = *incoming_parts.get(idx).unwrap_or(&0);
        let b = *existing_parts.get(idx).unwrap_or(&0);
        if a > b {
            return true;
        }
        if a < b {
            return false;
        }
    }
    false
}

fn normalize_menu_icon(source: Option<&str>) -> Option<String> {
    let value = source.map(|item| item.trim().to_lowercase()).filter(|item| !item.is_empty())?;
    if PLUGIN_MENU_ICON_WHITELIST.iter().any(|item| *item == value) {
        return Some(value);
    }
    None
}

fn normalize_menu_group(source: Option<&str>) -> Option<String> {
    source
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

fn normalize_override_value(source: Option<&str>) -> Option<String> {
    source
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

fn resolve_version_policy(source: Option<&PluginImportOptionsDto>) -> String {
    source
        .and_then(|item| item.version_policy.as_deref())
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .unwrap_or_else(|| "allowOverwrite".to_string())
}

fn resolve_menu_conflicts(
    state: &PluginState,
    current_plugin_id: &str,
    menu_enabled: bool,
    menu_title: Option<String>,
    menu_route_path: Option<String>,
) -> (Option<String>, Option<String>, Option<String>, Option<String>) {
    if !menu_enabled {
        return (None, None, None, None);
    }
    let mut resolved_title = menu_title.unwrap_or_else(|| "插件入口".to_string());
    let mut resolved_route_path = menu_route_path.unwrap_or_else(|| normalize_menu_route_path(current_plugin_id, None));
    let title_conflict_with = state
        .installed
        .iter()
        .find(|item| item.id != current_plugin_id && item.menu_enabled && item.menu_title.as_deref() == Some(resolved_title.as_str()))
        .map(|item| item.name.clone());
    let route_conflict_with = state
        .installed
        .iter()
        .find(|item| item.id != current_plugin_id && item.menu_enabled && item.menu_route_path.as_deref() == Some(resolved_route_path.as_str()))
        .map(|item| item.name.clone());
    if title_conflict_with.is_some() {
        let base_title = resolved_title.clone();
        let mut suffix = 2;
        while state.installed.iter().any(|item| {
            item.id != current_plugin_id
                && item.menu_enabled
                && item.menu_title.as_deref() == Some(format!("{base_title} ({suffix})").as_str())
        }) {
            suffix += 1;
        }
        resolved_title = format!("{base_title} ({suffix})");
    }
    if route_conflict_with.is_some() {
        let base = resolved_route_path.trim_end_matches('/').to_string();
        let mut suffix = 2;
        while state.installed.iter().any(|item| {
            item.id != current_plugin_id
                && item.menu_enabled
                && item.menu_route_path.as_deref() == Some(format!("{base}-{suffix}").as_str())
        }) {
            suffix += 1;
        }
        resolved_route_path = format!("{base}-{suffix}");
    }
    (
        title_conflict_with,
        route_conflict_with,
        Some(resolved_title),
        Some(resolved_route_path),
    )
}

fn choose_local_manifest_path(source_path: &Path) -> Option<PathBuf> {
    let parent = source_path.parent()?;
    let stem = source_path.file_stem().and_then(|item| item.to_str()).unwrap_or("");
    let mut candidates = Vec::new();
    if !stem.trim().is_empty() {
        candidates.push(parent.join(format!("{stem}.plugin.json")));
    }
    candidates.push(parent.join("plugin.json"));
    candidates.into_iter().find(|path| path.exists() && path.is_file())
}

fn parse_local_plugin_manifest_text(manifest_text: &str) -> Result<LocalPluginManifestDto, String> {
    let manifest = serde_json::from_str::<LocalPluginManifestDto>(manifest_text)
        .map_err(|error| format!("解析插件清单失败: {error}"))?;
    if manifest.name.trim().is_empty() {
        return Err("插件清单缺少 name".to_string());
    }
    if manifest.version.trim().is_empty() {
        return Err("插件清单缺少 version".to_string());
    }
    if manifest.author.trim().is_empty() {
        return Err("插件清单缺少 author".to_string());
    }
    Ok(manifest)
}

fn parse_local_plugin_manifest(source_path: &Path) -> Result<(LocalPluginManifestDto, PathBuf), String> {
    if is_encrypted_local_plugin_path(source_path) {
        let encrypted = read_encrypted_local_plugin(source_path)?;
        let manifest = parse_local_plugin_manifest_text(&encrypted.manifest_text)?;
        return Ok((manifest, source_path.to_path_buf()));
    }
    let manifest_path = choose_local_manifest_path(source_path).ok_or_else(|| {
        "未找到插件清单文件。请在插件包同目录提供 plugin.json 或 同名 .plugin.json".to_string()
    })?;
    let manifest_text =
        fs::read_to_string(&manifest_path).map_err(|error| format!("读取插件清单失败: {error}"))?;
    let manifest = parse_local_plugin_manifest_text(&manifest_text)?;
    Ok((manifest, manifest_path))
}

fn is_runtime_script_extension(extension: &str) -> bool {
    LOCAL_PLUGIN_SCRIPT_EXTENSIONS.iter().any(|item| *item == extension)
}

fn is_runtime_script_path(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|item| item.to_str())
        .map(|item| item.trim().to_ascii_lowercase())
        .map(|item| is_runtime_script_extension(item.as_str()))
        .unwrap_or(false)
}

fn normalize_archive_entry_path(path: &str) -> String {
    path.replace('\\', "/").trim_matches('/').to_string()
}

fn runtime_script_priority(path: &str) -> (u8, usize, usize) {
    let normalized = normalize_archive_entry_path(path);
    let lower = normalized.to_ascii_lowercase();
    let file_name = lower.rsplit('/').next().unwrap_or(lower.as_str());
    let preferred_rank = match file_name {
        "index.js" | "index.mjs" | "index.cjs" => 0,
        "main.js" | "main.mjs" | "main.cjs" => 1,
        "plugin.js" | "plugin.mjs" | "plugin.cjs" => 2,
        _ => 3,
    };
    let depth = normalized.matches('/').count();
    (preferred_rank, depth, normalized.len())
}

fn decode_runtime_script_bytes(bytes: Vec<u8>, display_path: &str) -> Result<String, String> {
    String::from_utf8(bytes).map_err(|_| {
        format!(
            "插件运行失败：{} 不是有效的 UTF-8 脚本文件，请确认压缩包内的入口脚本为 UTF-8 编码",
            display_path
        )
    })
}

fn select_runtime_script_candidate(candidates: Vec<(String, Vec<u8>)>, source_path: &Path) -> Result<String, String> {
    let mut matched = candidates
        .into_iter()
        .filter(|(path, _)| is_runtime_script_path(path))
        .collect::<Vec<_>>();
    if matched.is_empty() {
        return Err(format!(
            "插件运行失败：{} 内未找到可执行脚本，请在压缩包内放置 .js / .mjs / .cjs 入口文件",
            source_path.to_string_lossy()
        ));
    }
    matched.sort_by_key(|(path, _)| runtime_script_priority(path));
    let (script_path, bytes) = matched.remove(0);
    decode_runtime_script_bytes(bytes, &script_path)
}

fn read_runtime_script_from_zip(source_path: &Path) -> Result<String, String> {
    let file = File::open(source_path).map_err(|error| format!("读取插件压缩包失败: {error}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|error| format!("解析插件压缩包失败: {error}"))?;
    let mut candidates = Vec::new();
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|error| format!("读取插件压缩包条目失败: {error}"))?;
        if !entry.is_file() {
            continue;
        }
        let entry_name = entry
            .enclosed_name()
            .map(|item| item.to_string_lossy().to_string())
            .unwrap_or_else(|| entry.name().to_string());
        if !is_runtime_script_path(&entry_name) {
            continue;
        }
        let mut bytes = Vec::new();
        entry
            .read_to_end(&mut bytes)
            .map_err(|error| format!("读取插件脚本失败: {error}"))?;
        candidates.push((entry_name, bytes));
    }
    select_runtime_script_candidate(candidates, source_path)
}

fn read_runtime_script_from_tar_reader<R: Read>(reader: R, source_path: &Path) -> Result<String, String> {
    let mut archive = tar::Archive::new(reader);
    let entries = archive.entries().map_err(|error| format!("解析插件压缩包失败: {error}"))?;
    let mut candidates = Vec::new();
    for entry_result in entries {
        let mut entry = entry_result.map_err(|error| format!("读取插件压缩包条目失败: {error}"))?;
        if !entry.header().entry_type().is_file() {
            continue;
        }
        let entry_path = entry
            .path()
            .map_err(|error| format!("读取插件压缩包条目路径失败: {error}"))?
            .to_string_lossy()
            .to_string();
        if !is_runtime_script_path(&entry_path) {
            continue;
        }
        let mut bytes = Vec::new();
        entry
            .read_to_end(&mut bytes)
            .map_err(|error| format!("读取插件脚本失败: {error}"))?;
        candidates.push((entry_path, bytes));
    }
    select_runtime_script_candidate(candidates, source_path)
}

fn read_runtime_script_from_plain_gzip(source_path: &Path) -> Result<String, String> {
    let file = File::open(source_path).map_err(|error| format!("读取插件压缩包失败: {error}"))?;
    let mut decoder = GzDecoder::new(file);
    let mut bytes = Vec::new();
    decoder
        .read_to_end(&mut bytes)
        .map_err(|error| format!("解压插件文件失败: {error}"))?;
    let file_name = source_path
        .file_stem()
        .and_then(|item| item.to_str())
        .unwrap_or("plugin.js")
        .to_string();
    let entry_name = if is_runtime_script_path(&file_name) {
        file_name
    } else {
        "plugin.js".to_string()
    };
    decode_runtime_script_bytes(bytes, &entry_name)
}

fn read_runtime_script_from_gzip(source_path: &Path) -> Result<String, String> {
    let tar_attempt = File::open(source_path)
        .map_err(|error| format!("读取插件压缩包失败: {error}"))
        .and_then(|file| read_runtime_script_from_tar_reader(GzDecoder::new(file), source_path));
    match tar_attempt {
        Ok(script) => Ok(script),
        Err(_) => read_runtime_script_from_plain_gzip(source_path),
    }
}

fn read_plugin_runtime_script(source_path: &Path) -> Result<String, String> {
    let extension = source_path
        .extension()
        .and_then(|item| item.to_str())
        .map(|item| item.trim().to_ascii_lowercase())
        .ok_or_else(|| "插件文件缺少扩展名".to_string())?;
    match extension.as_str() {
        "js" | "mjs" | "cjs" => fs::read_to_string(source_path).map_err(|error| format!("读取插件脚本失败: {error}")),
        "zip" => read_runtime_script_from_zip(source_path),
        "tar" => {
            let file = File::open(source_path).map_err(|error| format!("读取插件压缩包失败: {error}"))?;
            read_runtime_script_from_tar_reader(file, source_path)
        }
        "tgz" | "gz" => read_runtime_script_from_gzip(source_path),
        "7z" => Err("插件运行失败：当前版本暂不支持直接运行 .7z 插件包，请先解压后导入 .js / .mjs / .cjs 文件".to_string()),
        ENCRYPTED_LOCAL_PLUGIN_EXTENSION => read_encrypted_local_plugin(source_path).and_then(|payload| {
            if !is_runtime_script_path(&payload.script_file_name) {
                return Err(format!(
                    "插件运行失败：加密插件入口脚本 {} 不是受支持的 .js / .mjs / .cjs 文件",
                    payload.script_file_name
                ));
            }
            if payload.script_text.trim().is_empty() {
                return Err("插件运行失败：加密插件入口脚本内容为空".to_string());
            }
            Ok(payload.script_text)
        }),
        _ => Err(format!("插件运行失败：不支持的插件格式 .{}", extension)),
    }
}

fn plugins_state_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("获取应用数据目录失败: {error}"))?;
    fs::create_dir_all(&app_data_dir).map_err(|error| format!("创建应用数据目录失败: {error}"))?;
    Ok(app_data_dir.join("plugins-state.json"))
}

fn read_plugin_state(app: &tauri::AppHandle) -> Result<PluginState, String> {
    let path = plugins_state_path(app)?;
    if !path.exists() {
        return Ok(PluginState::default());
    }
    let text = fs::read_to_string(&path).map_err(|error| format!("读取插件状态失败: {error}"))?;
    serde_json::from_str::<PluginState>(&text).map_err(|error| format!("解析插件状态失败: {error}"))
}

fn write_plugin_state(app: &tauri::AppHandle, state: &PluginState) -> Result<(), String> {
    let path = plugins_state_path(app)?;
    let text = serde_json::to_string_pretty(state).map_err(|error| format!("序列化插件状态失败: {error}"))?;
    fs::write(path, text).map_err(|error| format!("写入插件状态失败: {error}"))
}

async fn rpc_call<T: for<'de> Deserialize<'de>>(
    client: &Client,
    config: &Aria2RpcConfig,
    method: &str,
    params: Vec<Value>,
) -> Result<T, String> {
    let body = json!({
        "jsonrpc": "2.0",
        "id": "tinyaii",
        "method": method,
        "params": build_params(config, params),
    });
    let response = client
        .post(rpc_endpoint(config))
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("请求 aria2 RPC 失败: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        let body_text = response.text().await.unwrap_or_default();
        let body_preview = body_text.trim();
        if body_preview.is_empty() {
            return Err(format!("aria2 RPC HTTP 错误 {}", status.as_u16()));
        }
        let compact = body_preview.chars().take(200).collect::<String>();
        return Err(format!("aria2 RPC HTTP 错误 {}: {}", status.as_u16(), compact));
    }
    let payload: Aria2RpcResponse<T> = response
        .json()
        .await
        .map_err(|error| format!("解析 aria2 RPC 响应失败: {error}"))?;
    if let Some(error) = payload.error {
        return Err(format!("aria2 RPC 错误 {}: {}", error.code, error.message));
    }
    payload
        .result
        .ok_or_else(|| "aria2 RPC 未返回 result".to_string())
}

async fn ensure_task_transfer_options_applied(
    client: &Client,
    config: &Aria2RpcConfig,
    task_id: &str,
    expected_split_count: u32,
    expected_max_connection_per_server: u32,
) -> Result<(), String> {
    let option_map: HashMap<String, String> =
        rpc_call(client, config, "aria2.getOption", vec![json!(task_id)]).await?;
    let applied_split_count = option_map
        .get("split")
        .map(|value| parse_u32(value))
        .unwrap_or(0);
    let applied_max_connection_per_server = option_map
        .get("max-connection-per-server")
        .map(|value| parse_u32(value))
        .unwrap_or(0);
    if applied_split_count < expected_split_count || applied_max_connection_per_server < expected_max_connection_per_server {
        return Err(format!(
            "并发参数未完全生效：请求 split={} / max-connection-per-server={}，实际 split={} / max-connection-per-server={}。当前 aria2 引擎或源站策略可能将连接上限压到 16，请更换支持更高上限的 aria2 内核后重试。",
            expected_split_count,
            expected_max_connection_per_server,
            applied_split_count,
            applied_max_connection_per_server
        ));
    }
    Ok(())
}

async fn ensure_engine_online(client: &Client, config: &Aria2RpcConfig) -> Result<(), String> {
    match rpc_call::<Aria2VersionResult>(client, config, "aria2.getVersion", vec![]).await {
        Ok(_) => Ok(()),
        Err(error) => {
            if is_auth_error(&error) {
                return Err(error);
            }
            start_aria2_process(config)?;
            if wait_aria2_online(client, config).await {
                return Ok(());
            }
            Err("aria2 引擎未就绪，请检查可执行路径、端口和密钥配置".to_string())
        }
    }
}

async fn tell_statuses(client: &Client, config: &Aria2RpcConfig) -> Result<Vec<Aria2Status>, String> {
    let keys = json!([
        "gid",
        "status",
        "totalLength",
        "completedLength",
        "downloadSpeed",
        "dir",
        "files",
        "bittorrent",
        "errorCode",
        "errorMessage",
        "numPieces",
        "bitfield",
        "pieceLength",
        "connections"
    ]);
    let active: Vec<Aria2Status> = rpc_call(client, config, "aria2.tellActive", vec![keys.clone()]).await?;
    let waiting: Vec<Aria2Status> =
        rpc_call(client, config, "aria2.tellWaiting", vec![json!(0), json!(1000), keys.clone()]).await?;
    let stopped: Vec<Aria2Status> =
        rpc_call(client, config, "aria2.tellStopped", vec![json!(0), json!(1000), keys]).await?;
    Ok(active
        .into_iter()
        .chain(waiting.into_iter())
        .chain(stopped.into_iter())
        .collect())
}

#[tauri::command]
async fn aria2_add_tasks(request: AddTasksRequest) -> Result<Vec<DownloadTaskDto>, String> {
    let client = Client::new();
    ensure_engine_online(&client, &request.config).await?;
    let validated = validate_task_parameters(&request.payload)?;
    fs::create_dir_all(&validated.save_path).map_err(|error| format!("创建存储目录失败: {error}"))?;

    let mut created_ids = Vec::new();
    for (index, link) in validated.links.iter().enumerate() {
        let mut options = serde_json::Map::new();
        options.insert("dir".to_string(), json!(validated.save_path));
        options.insert(
            "split".to_string(),
            json!(validated.split_count.to_string()),
        );
        options.insert(
            "max-connection-per-server".to_string(),
            json!(validated.max_connection_per_server.to_string()),
        );
        options.insert("min-split-size".to_string(), json!("1K"));
        options.insert(
            "max-download-limit".to_string(),
            json!(request.payload.max_download_limit.to_string()),
        );
        options.insert(
            "max-upload-limit".to_string(),
            json!(request.payload.max_upload_limit.to_string()),
        );
        options.insert(
            "lowest-speed-limit".to_string(),
            json!(request.payload.lowest_speed_limit.to_string()),
        );
        options.insert("max-tries".to_string(), json!("10"));
        options.insert("retry-wait".to_string(), json!("1"));
        options.insert("retry-on-400".to_string(), json!("true"));
        options.insert("retry-on-403".to_string(), json!("true"));
        options.insert("retry-on-406".to_string(), json!("true"));
        options.insert("timeout".to_string(), json!("30"));
        options.insert("connect-timeout".to_string(), json!("30"));
        if !validated.rename.is_empty() {
            let out_name = if validated.links.len() > 1 {
                format!("{}-{}", validated.rename, index + 1)
            } else {
                validated.rename.clone()
            };
            options.insert("out".to_string(), json!(out_name));
        }
        if !request.payload.advanced.user_agent.trim().is_empty() {
            options.insert(
                "user-agent".to_string(),
                json!(request.payload.advanced.user_agent.trim().to_string()),
            );
        }
        if !request.payload.advanced.referer.trim().is_empty() {
            options.insert(
                "referer".to_string(),
                json!(request.payload.advanced.referer.trim().to_string()),
            );
        }
        if !request.payload.advanced.proxy.trim().is_empty() {
            options.insert(
                "all-proxy".to_string(),
                json!(request.payload.advanced.proxy.trim().to_string()),
            );
        }
        let headers = build_headers(&request.payload.advanced);
        if !headers.is_empty() {
            options.insert("header".to_string(), json!(headers));
        }
        if !request.payload.checksum.trim().is_empty() {
            options.insert(
                "checksum".to_string(),
                json!(request.payload.checksum.trim().to_string()),
            );
        }
        if let Some(bt_options) = &request.payload.bt_options {
            let seed_ratio = if bt_options.keep_seeding {
                "0".to_string()
            } else {
                bt_options.seed_ratio.max(0.0).to_string()
            };
            let seed_time = if bt_options.keep_seeding {
                "0".to_string()
            } else {
                bt_options.seed_time_minutes.to_string()
            };
            options.insert(
                "follow-torrent".to_string(),
                json!(if bt_options.auto_download_torrent { "true" } else { "false" }),
            );
            options.insert(
                "bt-force-encryption".to_string(),
                json!(if bt_options.force_encrypt { "true" } else { "false" }),
            );
            options.insert(
                "seed-ratio".to_string(),
                json!(seed_ratio),
            );
            options.insert(
                "seed-time".to_string(),
                json!(seed_time),
            );
            let tracker_list = normalize_bt_tracker_value(&bt_options.tracker_list);
            if !tracker_list.is_empty() {
                options.insert("bt-tracker".to_string(), json!(tracker_list));
            }
        }
        let gid: String = rpc_call(
            &client,
            &request.config,
            "aria2.addUri",
            vec![json!([link]), Value::Object(options)],
        )
        .await?;
        ensure_task_transfer_options_applied(
            &client,
            &request.config,
            &gid,
            validated.split_count,
            validated.max_connection_per_server,
        )
        .await?;
        created_ids.push(gid);
    }
    for torrent_file in &validated.torrent_files {
        let mut options = serde_json::Map::new();
        options.insert("dir".to_string(), json!(validated.save_path));
        options.insert("max-download-limit".to_string(), json!("0"));
        options.insert("lowest-speed-limit".to_string(), json!("0"));
        options.insert("max-tries".to_string(), json!("10"));
        options.insert("retry-wait".to_string(), json!("1"));
        options.insert("timeout".to_string(), json!("30"));
        options.insert("connect-timeout".to_string(), json!("30"));
        if !request.payload.advanced.user_agent.trim().is_empty() {
            options.insert(
                "user-agent".to_string(),
                json!(request.payload.advanced.user_agent.trim().to_string()),
            );
        }
        if !request.payload.advanced.referer.trim().is_empty() {
            options.insert(
                "referer".to_string(),
                json!(request.payload.advanced.referer.trim().to_string()),
            );
        }
        if !request.payload.advanced.proxy.trim().is_empty() {
            options.insert(
                "all-proxy".to_string(),
                json!(request.payload.advanced.proxy.trim().to_string()),
            );
        }
        let headers = build_headers(&request.payload.advanced);
        if !headers.is_empty() {
            options.insert("header".to_string(), json!(headers));
        }
        if let Some(bt_options) = &request.payload.bt_options {
            let seed_ratio = if bt_options.keep_seeding {
                "0".to_string()
            } else {
                bt_options.seed_ratio.max(0.0).to_string()
            };
            let seed_time = if bt_options.keep_seeding {
                "0".to_string()
            } else {
                bt_options.seed_time_minutes.to_string()
            };
            options.insert(
                "follow-torrent".to_string(),
                json!(if bt_options.auto_download_torrent { "true" } else { "false" }),
            );
            options.insert(
                "bt-force-encryption".to_string(),
                json!(if bt_options.force_encrypt { "true" } else { "false" }),
            );
            options.insert(
                "seed-ratio".to_string(),
                json!(seed_ratio),
            );
            options.insert(
                "seed-time".to_string(),
                json!(seed_time),
            );
            let tracker_list = normalize_bt_tracker_value(&bt_options.tracker_list);
            if !tracker_list.is_empty() {
                options.insert("bt-tracker".to_string(), json!(tracker_list));
            }
        }
        let gid: String = rpc_call(
            &client,
            &request.config,
            "aria2.addTorrent",
            vec![
                json!(torrent_file.content_base64),
                json!([]),
                Value::Object(options),
            ],
        )
        .await?;
        created_ids.push(gid);
    }
    let tasks = tell_statuses(&client, &request.config).await?;
    let created = tasks
        .into_iter()
        .filter(|status| created_ids.iter().any(|gid| gid == &status.gid))
        .map(map_task)
        .collect::<Vec<_>>();
    Ok(created)
}

#[tauri::command]
fn aria2_get_task_option_constraints() -> TaskOptionConstraintsDto {
    TaskOptionConstraintsDto {
        min_split_count: MIN_SPLIT_COUNT,
        max_split_count: MAX_SPLIT_COUNT,
        max_connection_per_server: MAX_CONNECTION_PER_SERVER,
        default_split_count: DEFAULT_SPLIT_COUNT,
        default_max_connections_per_server: DEFAULT_MAX_CONNECTIONS_PER_SERVER,
    }
}

#[tauri::command]
fn app_get_install_dir() -> Result<String, String> {
    let exe_path = std::env::current_exe().map_err(|error| format!("获取安装目录失败: {error}"))?;
    let parent = exe_path
        .parent()
        .ok_or_else(|| "获取安装目录失败: 无法解析可执行文件父目录".to_string())?;
    Ok(parent.to_string_lossy().to_string())
}

#[tauri::command]
fn app_read_text_file(file_path: String) -> Result<String, String> {
    let trimmed = file_path.trim();
    if trimmed.is_empty() {
        return Err("读取文件失败: 路径不能为空".to_string());
    }
    let path = PathBuf::from(trimmed);
    if !path.exists() {
        return Err(format!("读取文件失败: 文件不存在 {}", path.to_string_lossy()));
    }
    if !path.is_file() {
        return Err(format!("读取文件失败: 不是文件 {}", path.to_string_lossy()));
    }
    fs::read_to_string(&path).map_err(|error| format!("读取文件失败: {error}"))
}

#[tauri::command]
fn app_write_text_file(file_path: String, content: String) -> Result<(), String> {
    let trimmed = file_path.trim();
    if trimmed.is_empty() {
        return Err("写入文件失败: 路径不能为空".to_string());
    }
    let path = PathBuf::from(trimmed);
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|error| format!("写入文件失败: 创建目录失败 {error}"))?;
        }
    }
    fs::write(&path, content).map_err(|error| format!("写入文件失败: {error}"))
}

#[tauri::command]
fn plugin_read_runtime_script(file_path: String) -> Result<String, String> {
    let trimmed = file_path.trim();
    if trimmed.is_empty() {
        return Err("插件运行失败：路径不能为空".to_string());
    }
    let path = PathBuf::from(trimmed);
    if !path.exists() {
        return Err(format!("插件运行失败：文件不存在 {}", path.to_string_lossy()));
    }
    if !path.is_file() {
        return Err(format!("插件运行失败：不是文件 {}", path.to_string_lossy()));
    }
    read_plugin_runtime_script(&path)
}

#[tauri::command]
fn app_get_file_meta(file_path: String) -> Result<AppFileMetaDto, String> {
    let trimmed = file_path.trim();
    if trimmed.is_empty() {
        return Err("读取文件元信息失败: 路径不能为空".to_string());
    }
    let path = PathBuf::from(trimmed);
    if !path.exists() {
        return Err(format!("读取文件元信息失败: 文件不存在 {}", path.to_string_lossy()));
    }
    if !path.is_file() {
        return Err(format!("读取文件元信息失败: 不是文件 {}", path.to_string_lossy()));
    }
    let metadata = fs::metadata(&path).map_err(|error| format!("读取文件元信息失败: {error}"))?;
    let modified_at = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64);
    Ok(AppFileMetaDto {
        size_bytes: metadata.len(),
        modified_at,
    })
}

#[tauri::command]
fn app_truncate_text_file(file_path: String) -> Result<(), String> {
    let trimmed = file_path.trim();
    if trimmed.is_empty() {
        return Err("清空文件失败: 路径不能为空".to_string());
    }
    let path = PathBuf::from(trimmed);
    if !path.exists() {
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                fs::create_dir_all(parent).map_err(|error| format!("清空文件失败: 创建目录失败 {error}"))?;
            }
        }
        fs::write(&path, "").map_err(|error| format!("清空文件失败: 创建文件失败 {error}"))?;
        return Ok(());
    }
    if !path.is_file() {
        return Err(format!("清空文件失败: 不是文件 {}", path.to_string_lossy()));
    }
    fs::write(&path, "").map_err(|error| format!("清空文件失败: {error}"))
}

fn is_tcp_port_available(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

fn is_udp_port_available(port: u16) -> bool {
    UdpSocket::bind(("0.0.0.0", port)).is_ok()
}

fn probe_single_port(port: u16) -> ListenPortProbeItemDto {
    let tcp_available = is_tcp_port_available(port);
    let udp_available = is_udp_port_available(port);
    ListenPortProbeItemDto {
        port,
        tcp_available,
        udp_available,
        available: tcp_available && udp_available,
    }
}

#[tauri::command]
fn app_probe_listen_ports(request: ListenPortProbeRequest) -> ListenPortProbeDto {
    ListenPortProbeDto {
        bt: probe_single_port(request.bt_port),
        dht: probe_single_port(request.dht_port),
    }
}

#[tauri::command]
fn app_is_autostart_launch() -> bool {
    std::env::args().any(|arg| {
        let lowered = arg.to_ascii_lowercase();
        lowered == "--autostart" || lowered == "/autostart" || lowered == "--startup"
    })
}

#[tauri::command]
fn app_exit(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
async fn app_open_plugin_webview(
    window_label: String,
    url: String,
    title: Option<String>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let label = window_label.trim();
    if label.is_empty() {
        return Err("打开插件窗口失败：windowLabel 不能为空".to_string());
    }
    let target_url = url.trim();
    if target_url.is_empty() {
        return Err("打开插件窗口失败：url 不能为空".to_string());
    }
    if app.get_webview_window(label).is_some() {
        if let Some(window) = app.get_webview_window(label) {
            let _ = window.show();
            let _ = window.set_focus();
        }
        return Ok(());
    }
    let parsed_url = reqwest::Url::parse(target_url).map_err(|error| format!("打开插件窗口失败：URL 无效 {error}"))?;
    let window = tauri::WebviewWindowBuilder::new(
        &app,
        label,
        tauri::WebviewUrl::External(parsed_url),
    )
    .title(title.unwrap_or_else(|| "插件登录".to_string()))
    .inner_size(1120.0, 760.0)
    .resizable(true)
    .center()
    .build()
    .map_err(|error| format!("打开插件窗口失败：{error}"))?;
    let _ = window.show();
    let _ = window.set_focus();
    Ok(())
}

#[tauri::command]
async fn app_collect_webview_cookies(
    window_label: String,
    domain_keyword: Option<String>,
    app: tauri::AppHandle,
) -> Result<Vec<WebviewCookieDto>, String> {
    let label = window_label.trim();
    if label.is_empty() {
        return Err("读取 Cookie 失败：windowLabel 不能为空".to_string());
    }
    let window = app
        .get_webview_window(label)
        .ok_or_else(|| "读取 Cookie 失败：插件窗口不存在，请先打开登录窗口".to_string())?;
    let cookies = window
        .cookies()
        .map_err(|error| format!("读取 Cookie 失败：{error}"))?;
    let keyword = domain_keyword
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    let mut result = Vec::new();
    for cookie in cookies {
        let name = cookie.name().to_string();
        let value = cookie.value().to_string();
        if name.trim().is_empty() {
            continue;
        }
        let domain = cookie.domain().map(|item| item.to_string());
        let path = cookie.path().map(|item| item.to_string());
        if !keyword.is_empty() {
            let matches = domain
                .as_deref()
                .map(|item| item.to_ascii_lowercase().contains(&keyword))
                .unwrap_or(false);
            if !matches {
                continue;
            }
        }
        result.push(WebviewCookieDto {
            name,
            value,
            domain,
            path,
        });
    }
    Ok(result)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UrlProbeRequest {
    url: String,
}

// 探测加速地址可用性：取 1 字节，返回状态码与耗时
#[tauri::command]
async fn app_probe_url(request: UrlProbeRequest) -> Result<Value, String> {
    let target = request.url.trim().to_string();
    if target.is_empty() {
        return Err("url 不能为空".to_string());
    }
    let client = Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|error| format!("请求失败：{error}"))?;
    let started = std::time::Instant::now();
    let response = client
        .get(&target)
        .header(reqwest::header::RANGE, "bytes=0-0")
        .send()
        .await
        .map_err(|error| format!("请求失败：{error}"))?;
    let status = response.status().as_u16();
    let elapsed_ms = started.elapsed().as_millis() as u64;
    Ok(json!({ "status": status, "elapsedMs": elapsed_ms, "ok": status < 400 }))
}

#[tauri::command]
async fn app_http_get_json(request: HttpJsonRequestDto) -> Result<Value, String> {
    let target_url = request.url.trim().to_string();
    if target_url.is_empty() {
        return Err("请求失败：url 不能为空".to_string());
    }
    let mut headers = HeaderMap::new();
    for (key, value) in request.headers {
        let header_name = reqwest::header::HeaderName::from_bytes(key.trim().as_bytes())
            .map_err(|error| format!("请求失败：Header 名称非法 {error}"))?;
        let header_value = HeaderValue::from_str(value.trim())
            .map_err(|error| format!("请求失败：Header 值非法 {error}"))?;
        headers.insert(header_name, header_value);
    }
    let client = Client::new();
    let response = client
        .get(target_url)
        .headers(headers)
        .send()
        .await
        .map_err(|error| format!("请求失败：{error}"))?;
    response
        .json::<Value>()
        .await
        .map_err(|error| format!("请求失败：解析 JSON 失败 {error}"))
}

#[tauri::command]
async fn app_http_get_text(request: HttpJsonRequestDto) -> Result<String, String> {
    let target_url = request.url.trim().to_string();
    if target_url.is_empty() {
        return Err("请求失败：url 不能为空".to_string());
    }
    let mut headers = HeaderMap::new();
    for (key, value) in request.headers {
        let header_name = reqwest::header::HeaderName::from_bytes(key.trim().as_bytes())
            .map_err(|error| format!("请求失败：Header 名称非法 {error}"))?;
        let header_value = HeaderValue::from_str(value.trim())
            .map_err(|error| format!("请求失败：Header 值非法 {error}"))?;
        headers.insert(header_name, header_value);
    }
    let client = Client::new();
    let response = client
        .get(target_url)
        .headers(headers)
        .send()
        .await
        .map_err(|error| format!("请求失败：{error}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("请求失败：读取响应失败 {error}"))?;
    if !status.is_success() {
        return Err(format!("请求失败：HTTP {} {text}", status.as_u16()));
    }
    Ok(text)
}

#[tauri::command]
async fn app_http_request_json(request: HttpRequestJsonDto) -> Result<Value, String> {
    let target_url = request.url.trim().to_string();
    if target_url.is_empty() {
        return Err("请求失败：url 不能为空".to_string());
    }
    let method = request
        .method
        .unwrap_or_else(|| "GET".to_string())
        .trim()
        .to_ascii_uppercase();
    if method.is_empty() {
        return Err("请求失败：method 不能为空".to_string());
    }
    let mut headers = HeaderMap::new();
    for (key, value) in request.headers {
        let header_name = reqwest::header::HeaderName::from_bytes(key.trim().as_bytes())
            .map_err(|error| format!("请求失败：Header 名称非法 {error}"))?;
        let header_value = HeaderValue::from_str(value.trim())
            .map_err(|error| format!("请求失败：Header 值非法 {error}"))?;
        headers.insert(header_name, header_value);
    }
    let client = Client::new();
    let mut builder = match method.as_str() {
        "GET" => client.get(&target_url),
        "POST" => client.post(&target_url),
        "PUT" => client.put(&target_url),
        "PATCH" => client.patch(&target_url),
        "DELETE" => client.delete(&target_url),
        _ => return Err(format!("请求失败：不支持的 method {method}")),
    };
    builder = builder.headers(headers);
    if method != "GET" {
        if let Some(body) = request.body {
            builder = builder.json(&body);
        }
    }
    let response = builder
        .send()
        .await
        .map_err(|error| format!("请求失败：{error}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("请求失败：读取响应失败 {error}"))?;
    if !status.is_success() {
        return Err(format!("请求失败：HTTP {} {text}", status.as_u16()));
    }
    serde_json::from_str::<Value>(&text).map_err(|error| format!("请求失败：解析 JSON 失败 {error}"))
}

fn normalize_bilibili_user_agent(user_agent: Option<String>) -> String {
    let normalized = user_agent.unwrap_or_default().trim().to_string();
    if normalized.is_empty() {
        return "Mozilla/5.0 TinyAiiResolver".to_string();
    }
    normalized
}

fn build_bilibili_headers(cookie: Option<String>, user_agent: Option<String>) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    let ua_value = HeaderValue::from_str(&normalize_bilibili_user_agent(user_agent))
        .map_err(|error| format!("哔哩解析失败：User-Agent 非法 {error}"))?;
    headers.insert(USER_AGENT, ua_value);
    headers.insert(REFERER, HeaderValue::from_static("https://www.bilibili.com"));
    let cookie_value = cookie.unwrap_or_default().trim().to_string();
    if !cookie_value.is_empty() {
        let cookie_header = HeaderValue::from_str(&cookie_value).map_err(|error| format!("哔哩解析失败：Cookie 非法 {error}"))?;
        headers.insert(COOKIE, cookie_header);
    }
    Ok(headers)
}

fn parse_bilibili_identifiers(path: &str) -> (Option<String>, Option<u64>) {
    for segment in path.split('/') {
        let normalized = segment.trim();
        if normalized.len() >= 12 && normalized.to_ascii_uppercase().starts_with("BV") {
            return (Some(normalized.to_ascii_uppercase()), None);
        }
        let lowered = normalized.to_ascii_lowercase();
        if let Some(number_part) = lowered.strip_prefix("av") {
            if let Ok(avid) = number_part.parse::<u64>() {
                return (None, Some(avid));
            }
        }
    }
    (None, None)
}

fn parse_bilibili_parts(url: &reqwest::Url, total_pages: usize) -> Vec<usize> {
    if total_pages == 0 {
        return Vec::new();
    }
    let query_part = url
        .query_pairs()
        .find(|(key, _)| key.eq_ignore_ascii_case("p"))
        .map(|(_, value)| value.to_string())
        .unwrap_or_default();
    if query_part.trim().is_empty() {
        return (0..total_pages).collect();
    }
    let normalized = query_part.trim();
    let mut selected: Vec<usize> = Vec::new();
    if normalized.contains('-') {
        let mut segments = normalized.splitn(2, '-');
        let left = segments.next().unwrap_or_default().trim();
        let right = segments.next().unwrap_or_default().trim();
        let start = left.parse::<usize>().ok().filter(|value| *value > 0).unwrap_or(1);
        let end = right
            .parse::<usize>()
            .ok()
            .filter(|value| *value > 0)
            .unwrap_or(total_pages);
        let (range_start, range_end) = if start <= end { (start, end) } else { (end, start) };
        for index in range_start..=range_end {
            if index == 0 || index > total_pages {
                continue;
            }
            selected.push(index - 1);
        }
    } else if let Ok(single) = normalized.parse::<usize>() {
        if single > 0 && single <= total_pages {
            selected.push(single - 1);
        }
    }
    if selected.is_empty() {
        return (0..total_pages).collect();
    }
    selected
}

fn pick_best_stream_url(streams: &[BilibiliDashStreamItem]) -> Option<String> {
    streams
        .iter()
        .filter(|item| !item.base_url.trim().is_empty())
        .max_by_key(|item| item.id)
        .map(|item| item.base_url.trim().to_string())
}

async fn fetch_bilibili_view_data(
    client: &Client,
    headers: &HeaderMap,
    bvid: Option<&str>,
    avid: Option<u64>,
) -> Result<BilibiliViewData, String> {
    let mut query: Vec<(&str, String)> = Vec::new();
    if let Some(value) = bvid {
        query.push(("bvid", value.to_string()));
    }
    if let Some(value) = avid {
        query.push(("aid", value.to_string()));
    }
    let response = client
        .get("https://api.bilibili.com/x/web-interface/view")
        .headers(headers.clone())
        .query(&query)
        .send()
        .await
        .map_err(|error| format!("哔哩解析失败：获取视频信息失败 {error}"))?;
    let payload = response
        .json::<BilibiliApiResponse<BilibiliViewData>>()
        .await
        .map_err(|error| format!("哔哩解析失败：解析视频信息失败 {error}"))?;
    if payload.code != 0 {
        return Err(format!("哔哩解析失败：{} (code={})", payload.message, payload.code));
    }
    payload.data.ok_or_else(|| "哔哩解析失败：视频信息为空".to_string())
}

async fn fetch_bilibili_play_data(
    client: &Client,
    headers: &HeaderMap,
    bvid: Option<&str>,
    avid: Option<u64>,
    cid: u64,
) -> Result<BilibiliPlayData, String> {
    let mut query: Vec<(&str, String)> = vec![
        ("cid", cid.to_string()),
        ("qn", "80".to_string()),
        ("fnval", "16".to_string()),
        ("fnver", "0".to_string()),
        ("fourk", "1".to_string()),
    ];
    if let Some(value) = bvid {
        query.push(("bvid", value.to_string()));
    }
    if let Some(value) = avid {
        query.push(("avid", value.to_string()));
    }
    let response = client
        .get("https://api.bilibili.com/x/player/playurl")
        .headers(headers.clone())
        .query(&query)
        .send()
        .await
        .map_err(|error| format!("哔哩解析失败：获取播放信息失败 {error}"))?;
    let payload = response
        .json::<BilibiliApiResponse<BilibiliPlayData>>()
        .await
        .map_err(|error| format!("哔哩解析失败：解析播放信息失败 {error}"))?;
    if payload.code != 0 {
        return Err(format!("哔哩解析失败：{} (code={})", payload.message, payload.code));
    }
    payload.data.ok_or_else(|| "哔哩解析失败：播放信息为空".to_string())
}

#[tauri::command]
async fn app_resolve_bilibili_links(
    url: String,
    cookie: Option<String>,
    user_agent: Option<String>,
) -> Result<Vec<String>, String> {
    let source = url.trim().to_string();
    if source.is_empty() {
        return Err("哔哩解析失败：链接不能为空".to_string());
    }
    let client = Client::new();
    let headers = build_bilibili_headers(cookie, user_agent)?;
    let mut parsed = reqwest::Url::parse(&source).map_err(|error| format!("哔哩解析失败：链接格式无效 {error}"))?;
    let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
    if host == "b23.tv" || host == "www.b23.tv" {
        let response = client
            .get(parsed.clone())
            .headers(headers.clone())
            .send()
            .await
            .map_err(|error| format!("哔哩解析失败：短链展开失败 {error}"))?;
        parsed = response.url().clone();
    }
    let resolved_host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
    if !resolved_host.ends_with("bilibili.com") {
        return Err("哔哩解析失败：暂不支持该域名".to_string());
    }
    let (bvid, avid) = parse_bilibili_identifiers(parsed.path());
    if bvid.is_none() && avid.is_none() {
        return Err("哔哩解析失败：未识别到 BV/av 视频编号".to_string());
    }
    let view = fetch_bilibili_view_data(&client, &headers, bvid.as_deref(), avid).await?;
    if view.pages.is_empty() {
        return Err("哔哩解析失败：未读取到分 P 信息".to_string());
    }
    let selected_parts = parse_bilibili_parts(&parsed, view.pages.len());
    if selected_parts.is_empty() {
        return Err("哔哩解析失败：分 P 参数无效".to_string());
    }
    let mut links: Vec<String> = Vec::new();
    for part_index in selected_parts {
        let page = view
            .pages
            .get(part_index)
            .ok_or_else(|| "哔哩解析失败：分 P 下标越界".to_string())?;
        let play = fetch_bilibili_play_data(&client, &headers, bvid.as_deref(), avid, page.cid).await?;
        if let Some(dash) = play.dash {
            if let Some(video_url) = pick_best_stream_url(&dash.video) {
                links.push(video_url);
            }
            if let Some(audio_url) = pick_best_stream_url(&dash.audio) {
                links.push(audio_url);
            }
            continue;
        }
        if let Some(items) = play.durl {
            links.extend(
                items
                    .into_iter()
                    .map(|item| item.url.trim().to_string())
                    .filter(|item| !item.is_empty()),
            );
        }
    }
    let mut deduplicated: Vec<String> = Vec::new();
    let mut seen = HashSet::new();
    for link in links {
        if seen.insert(link.clone()) {
            deduplicated.push(link);
        }
    }
    if deduplicated.is_empty() {
        return Err("哔哩解析失败：未获取到可下载直链".to_string());
    }
    Ok(deduplicated)
}

#[tauri::command]
async fn aria2_get_tasks(config: Aria2RpcConfig) -> Result<Vec<DownloadTaskDto>, String> {
    let client = Client::new();
    let tasks = tell_statuses(&client, &config).await?;
    Ok(tasks.into_iter().map(map_task).collect())
}

#[tauri::command]
async fn aria2_get_task_detail(request: TaskDetailRequest) -> Result<DownloadTaskDetailDto, String> {
    let client = Client::new();
    map_task_detail(&client, &request.config, &request).await
}

#[tauri::command]
async fn aria2_start_task(request: StartTaskRequest) -> Result<(), String> {
    let client = Client::new();
    let (split_count, max_connection_per_server) =
        normalize_task_transfer_options(request.split_count, request.max_connection_per_server);
    let task_options = json!({
        "split": split_count.to_string(),
        "max-connection-per-server": max_connection_per_server.to_string(),
        "min-split-size": "1K",
        "max-download-limit": "0",
        "lowest-speed-limit": "0",
        "max-tries": "10",
        "retry-wait": "1",
        "retry-on-400": "true",
        "retry-on-403": "true",
        "retry-on-406": "true",
        "timeout": "30",
        "connect-timeout": "30"
    });
    let _: String = rpc_call(
        &client,
        &request.config,
        "aria2.changeOption",
        vec![json!(request.task_id.clone()), task_options],
    )
    .await?;
    ensure_task_transfer_options_applied(
        &client,
        &request.config,
        &request.task_id,
        split_count,
        max_connection_per_server,
    )
    .await?;
    let _: String = rpc_call(&client, &request.config, "aria2.unpause", vec![json!(request.task_id)]).await?;
    Ok(())
}

#[tauri::command]
async fn aria2_pause_task(task_id: String, config: Aria2RpcConfig) -> Result<(), String> {
    let client = Client::new();
    let _: String = rpc_call(&client, &config, "aria2.pause", vec![json!(task_id)]).await?;
    Ok(())
}

/// 替换任务的 URI（用于网盘直链 token 过期后刷新链接）
/// 调用 aria2.changeUri(gid, fileIndex, delUris, addUris)
/// 返回未被移除的 URI 数量
#[tauri::command]
async fn aria2_change_uri(
    task_id: String,
    file_index: usize,
    del_uris: Vec<String>,
    add_uris: Vec<String>,
    config: Aria2RpcConfig,
) -> Result<i64, String> {
    let client = Client::new();
    let result: i64 = rpc_call(
        &client,
        &config,
        "aria2.changeUri",
        vec![json!(task_id), json!(file_index), json!(del_uris), json!(add_uris)],
    )
    .await?;
    Ok(result)
}

#[tauri::command]
async fn aria2_stop_task(task_id: String, config: Aria2RpcConfig) -> Result<(), String> {
    let client = Client::new();
    let _: String = rpc_call(&client, &config, "aria2.forceRemove", vec![json!(task_id)]).await?;
    Ok(())
}

#[tauri::command]
async fn aria2_remove_task(
    task_id: String,
    delete_downloaded_files: Option<bool>,
    downloaded_file_paths: Option<Vec<String>>,
    config: Aria2RpcConfig,
) -> Result<(), String> {
    let client = Client::new();
    let forced_remove: Result<String, String> =
        rpc_call(&client, &config, "aria2.forceRemove", vec![json!(task_id.clone())]).await;
    // forceRemove 只停掉活跃任务，条目仍留在 stopped 列表里；
    // 必须再调 removeDownloadResult，否则客户端要删两遍才看不到（竞态）
    let removed_result: Result<String, String> = rpc_call(
        &client,
        &config,
        "aria2.removeDownloadResult",
        vec![json!(task_id.clone())],
    )
    .await;
    if forced_remove.is_err() && removed_result.is_err() {
        let _: String = rpc_call(&client, &config, "aria2.remove", vec![json!(task_id)]).await?;
    }
    let delete_targets = if delete_downloaded_files.unwrap_or(false) {
        downloaded_file_paths.unwrap_or_default()
    } else {
        Vec::new()
    };
    if !delete_targets.is_empty() {
        let targets: HashSet<String> = delete_targets
            .into_iter()
            .map(|target| target.trim().to_string())
            .filter(|target| !target.is_empty())
            .collect();
        let mut failed_targets = Vec::new();
        for target in targets {
            let path_buf = PathBuf::from(&target);
            if path_buf.exists() {
                if let Err(error) = fs::remove_file(&path_buf) {
                    failed_targets.push(format!("{target}: {error}"));
                }
            }
            if delete_downloaded_files.unwrap_or(false) {
                let control_path = PathBuf::from(format!("{target}.aria2"));
                if control_path.exists() {
                    if let Err(error) = fs::remove_file(&control_path) {
                        failed_targets.push(format!("{}: {}", control_path.display(), error));
                    }
                }
            }
        }
        if !failed_targets.is_empty() {
            return Err(format!("删除文件失败: {}", failed_targets.join("; ")));
        }
    }
    Ok(())
}

#[tauri::command]
async fn aria2_start_all_tasks(config: Aria2RpcConfig) -> Result<(), String> {
    let client = Client::new();
    let _: String = rpc_call(&client, &config, "aria2.unpauseAll", vec![]).await?;
    Ok(())
}

#[tauri::command]
async fn aria2_pause_all_tasks(config: Aria2RpcConfig) -> Result<(), String> {
    let client = Client::new();
    let _: String = rpc_call(&client, &config, "aria2.pauseAll", vec![]).await?;
    Ok(())
}

#[tauri::command]
async fn aria2_stop_all_tasks(config: Aria2RpcConfig) -> Result<(), String> {
    let client = Client::new();
    let tasks = tell_statuses(&client, &config).await?;
    let active_ids = tasks
        .iter()
        .filter(|task| task.status == "active" || task.status == "waiting" || task.status == "paused")
        .map(|task| task.gid.clone())
        .collect::<Vec<_>>();
    for gid in active_ids {
        let _: String = rpc_call(&client, &config, "aria2.forceRemove", vec![json!(gid)]).await?;
    }
    Ok(())
}

#[tauri::command]
async fn aria2_clear_completed_tasks(config: Aria2RpcConfig) -> Result<(), String> {
    let client = Client::new();
    let tasks = tell_statuses(&client, &config).await?;
    let completed_ids = tasks
        .iter()
        .filter(|task| task.status == "complete")
        .map(|task| task.gid.clone())
        .collect::<Vec<_>>();
    for gid in completed_ids {
        let _: String = rpc_call(&client, &config, "aria2.removeDownloadResult", vec![json!(gid)]).await?;
    }
    Ok(())
}

#[tauri::command]
async fn aria2_clear_all_tasks(config: Aria2RpcConfig) -> Result<(), String> {
    let client = Client::new();
    let tasks = tell_statuses(&client, &config).await?;
    let active_ids = tasks
        .iter()
        .filter(|task| task.status == "active" || task.status == "waiting" || task.status == "paused")
        .map(|task| task.gid.clone())
        .collect::<Vec<_>>();
    for gid in active_ids {
        let _: String = rpc_call(&client, &config, "aria2.forceRemove", vec![json!(gid)]).await?;
    }
    let stopped_tasks = tell_statuses(&client, &config).await?;
    let result_ids = stopped_tasks
        .iter()
        .filter(|task| task.status == "complete" || task.status == "error" || task.status == "removed")
        .map(|task| task.gid.clone())
        .collect::<Vec<_>>();
    for gid in result_ids {
        let _: String = rpc_call(&client, &config, "aria2.removeDownloadResult", vec![json!(gid)]).await?;
    }
    Ok(())
}

#[tauri::command]
async fn aria2_get_version(config: Aria2RpcConfig) -> Result<Aria2VersionDto, String> {
    let client = Client::new();
    let version: Aria2VersionResult = match rpc_call(&client, &config, "aria2.getVersion", vec![]).await {
        Ok(version) => version,
        Err(error) => {
            if is_auth_error(&error) {
                return Err(error);
            }
            start_aria2_process(&config)?;
            if !wait_aria2_online(&client, &config).await {
                return Err("aria2 引擎未就绪，请检查可执行路径、端口和密钥配置".to_string());
            }
            rpc_call(&client, &config, "aria2.getVersion", vec![]).await?
        }
    };
    Ok(Aria2VersionDto {
        version: version.version,
        enabled_features: version.enabled_features,
    })
}

#[tauri::command]
async fn aria2_update_and_restart_engine(config: Aria2RpcConfig) -> Result<(), String> {
    let client = Client::new();
    let _ = rpc_call::<String>(&client, &config, "aria2.forceShutdown", vec![]).await;
    std::thread::sleep(Duration::from_millis(500));
    #[cfg(target_os = "windows")]
    {
        if install_or_update_mod_aria2_with_repo().is_err() && !has_explicit_or_bundled_aria2(&config) {
            let _ = update_or_install_aria2_with_winget();
        }
    }
    start_aria2_process(&config)?;
    if wait_aria2_online(&client, &config).await {
        return Ok(());
    }
    Err("更新并重启后仍无法连接 aria2 引擎，请检查端口、密钥或 aria2c 路径配置".to_string())
}

#[tauri::command]
async fn aria2_set_global_speed_limit(
    request: GlobalSpeedLimitRequest,
    config: Aria2RpcConfig,
) -> Result<(), String> {
    let client = Client::new();
    ensure_engine_online(&client, &config).await?;
    let options = json!({
        "max-overall-upload-limit": request.upload_limit_bytes.to_string(),
        "max-overall-download-limit": request.download_limit_bytes.to_string()
    });
    let _: String = rpc_call(
        &client,
        &config,
        "aria2.changeGlobalOption",
        vec![options],
    )
    .await?;
    Ok(())
}

#[tauri::command]
async fn aria2_set_global_bt_options(
    request: GlobalBtOptionsRequest,
    config: Aria2RpcConfig,
) -> Result<(), String> {
    let client = Client::new();
    ensure_engine_online(&client, &config).await?;
    let seed_ratio = if request.keep_seeding {
        "0".to_string()
    } else {
        request.seed_ratio.max(0.0).to_string()
    };
    let seed_time = if request.keep_seeding {
        "0".to_string()
    } else {
        request.seed_time_minutes.to_string()
    };
    let options = json!({
        "follow-torrent": if request.auto_download_torrent { "true" } else { "false" },
        "bt-force-encryption": if request.force_encrypt { "true" } else { "false" },
        "seed-ratio": seed_ratio,
        "seed-time": seed_time
    });
    let _: String = rpc_call(
        &client,
        &config,
        "aria2.changeGlobalOption",
        vec![options],
    )
    .await?;
    Ok(())
}

#[tauri::command]
async fn aria2_set_global_tracker_list(
    tracker_list: String,
    config: Aria2RpcConfig,
) -> Result<(), String> {
    let client = Client::new();
    ensure_engine_online(&client, &config).await?;
    let options = json!({
        "bt-tracker": normalize_bt_tracker_value(&tracker_list)
    });
    let _: String = rpc_call(
        &client,
        &config,
        "aria2.changeGlobalOption",
        vec![options],
    )
    .await?;
    Ok(())
}

#[tauri::command]
fn plugin_list_installed(app: tauri::AppHandle) -> Result<Vec<PluginInstalledDto>, String> {
    let state = read_plugin_state(&app)?;
    Ok(state.installed)
}

#[tauri::command]
fn plugin_list_discover() -> Vec<PluginDiscoverDto> {
    default_discover_plugins()
}

#[tauri::command]
fn plugin_install(plugin_id: String, app: tauri::AppHandle) -> Result<PluginInstalledDto, String> {
    let discover = default_discover_plugins();
    let source = discover
        .into_iter()
        .find(|item| item.id == plugin_id)
        .ok_or_else(|| "插件不存在".to_string())?;
    let mut state = read_plugin_state(&app)?;
    if let Some(existed) = state.installed.iter().find(|item| item.id == source.id) {
        return Ok(existed.clone());
    }
    let installed = PluginInstalledDto {
        id: source.id,
        name: source.name,
        description: source.description,
        version: source.version,
        author: source.author,
        homepage: None,
        repository: None,
        license: None,
        source_type: "market".to_string(),
        package_path: None,
        manifest_path: None,
        package_size_bytes: None,
        menu_enabled: false,
        menu_title: None,
        menu_route_path: None,
        menu_icon: None,
        menu_group: None,
        enabled: true,
        installed_at: now_millis(),
    };
    state.installed.push(installed.clone());
    write_plugin_state(&app, &state)?;
    Ok(installed)
}

#[tauri::command]
fn plugin_uninstall(plugin_id: String, app: tauri::AppHandle) -> Result<(), String> {
    let mut state = read_plugin_state(&app)?;
    let removed = state
        .installed
        .iter()
        .find(|item| item.id == plugin_id)
        .cloned();
    state.installed.retain(|item| item.id != plugin_id);
    write_plugin_state(&app, &state)?;
    if let Some(local_plugin) = removed {
        if local_plugin.source_type == "local" {
            if let Some(path) = local_plugin.package_path {
                let package_path = PathBuf::from(path);
                if package_path.exists() && package_path.is_file() {
                    let _ = fs::remove_file(package_path);
                }
            }
            if let Some(path) = local_plugin.manifest_path {
                let manifest_path = PathBuf::from(path);
                if manifest_path.exists() && manifest_path.is_file() {
                    let _ = fs::remove_file(manifest_path);
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn plugin_toggle_enabled(plugin_id: String, app: tauri::AppHandle) -> Result<PluginInstalledDto, String> {
    let mut state = read_plugin_state(&app)?;
    let plugin = state
        .installed
        .iter_mut()
        .find(|item| item.id == plugin_id)
        .ok_or_else(|| "插件未安装".to_string())?;
    plugin.enabled = !plugin.enabled;
    let updated = plugin.clone();
    write_plugin_state(&app, &state)?;
    Ok(updated)
}

#[tauri::command]
fn plugin_precheck_local(file_path: String, app: tauri::AppHandle) -> Result<PluginImportPrecheckDto, String> {
    let trimmed_path = file_path.trim();
    if trimmed_path.is_empty() {
        return Err("插件文件路径不能为空".to_string());
    }
    let source_path = PathBuf::from(trimmed_path);
    if !source_path.exists() {
        return Err("插件文件不存在".to_string());
    }
    if !source_path.is_file() {
        return Err("请选择有效的插件文件".to_string());
    }
    let extension = source_path
        .extension()
        .and_then(|item| item.to_str())
        .map(|item| item.trim().to_ascii_lowercase())
        .ok_or_else(|| "插件文件缺少扩展名".to_string())?;
    if !LOCAL_PLUGIN_ALLOWED_EXTENSIONS.iter().any(|item| *item == extension) {
        return Err(format!("不支持的插件格式: .{extension}"));
    }
    let metadata = fs::metadata(&source_path).map_err(|error| format!("读取插件文件信息失败: {error}"))?;
    let file_size = metadata.len();
    if file_size == 0 {
        return Err("插件文件为空，无法导入".to_string());
    }
    let (manifest, manifest_path) = parse_local_plugin_manifest(&source_path)?;
    let plugin_id = manifest
        .id
        .as_deref()
        .map(normalize_plugin_id)
        .filter(|item| !item.is_empty())
        .unwrap_or_else(|| build_local_plugin_id(&source_path, file_size));
    let normalized_plugin_id = normalize_plugin_id(&plugin_id);
    let menu_enabled = manifest.menu.as_ref().map(|item| item.enabled).unwrap_or(false);
    let raw_menu_title = manifest
        .menu
        .as_ref()
        .and_then(|item| item.title.as_deref())
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .or_else(|| if menu_enabled { Some(manifest.name.trim().to_string()) } else { None });
    let raw_menu_route_path = if menu_enabled {
        let route = manifest
            .menu
            .as_ref()
            .and_then(|item| item.route_path.as_deref())
            .map(|item| item.trim().to_string())
            .filter(|item| !item.is_empty());
        Some(normalize_menu_route_path(&normalized_plugin_id, route.as_deref()))
    } else {
        None
    };
    let menu_icon = normalize_menu_icon(manifest.menu.as_ref().and_then(|item| item.icon.as_deref()));
    let menu_group = normalize_menu_group(manifest.menu.as_ref().and_then(|item| item.group.as_deref()));
    let state = read_plugin_state(&app)?;
    let (title_conflict_with, route_conflict_with, suggested_menu_title, suggested_menu_route_path) =
        resolve_menu_conflicts(
            &state,
            &plugin_id,
            menu_enabled,
            raw_menu_title.clone(),
            raw_menu_route_path.clone(),
        );
    let existed = state.installed.iter().find(|item| item.id == plugin_id);
    let upgrade_from_version = existed.map(|item| item.version.clone());
    let is_upgrade = existed
        .map(|item| is_newer_semver(manifest.version.trim(), item.version.trim()))
        .unwrap_or(false);
    let mut warnings = Vec::new();
    if menu_enabled && menu_icon.is_none() && manifest.menu.as_ref().and_then(|item| item.icon.as_deref()).is_some() {
        warnings.push("menu.icon 不在白名单中，已自动降级为默认图标".to_string());
    }
    if title_conflict_with.is_some() {
        warnings.push("菜单名称与现有插件冲突，导入时将自动重命名".to_string());
    }
    if route_conflict_with.is_some() {
        warnings.push("菜单路由与现有插件冲突，导入时将自动改写路由".to_string());
    }
    Ok(PluginImportPrecheckDto {
        file_path: source_path.to_string_lossy().to_string(),
        file_extension: extension,
        package_size_bytes: file_size,
        manifest_path: manifest_path.to_string_lossy().to_string(),
        plugin_id,
        plugin_name: manifest.name.trim().to_string(),
        plugin_version: manifest.version.trim().to_string(),
        plugin_author: manifest.author.trim().to_string(),
        menu_enabled,
        menu_title: raw_menu_title,
        menu_route_path: raw_menu_route_path,
        menu_icon,
        menu_group,
        route_conflict_with,
        title_conflict_with,
        suggested_menu_title,
        suggested_menu_route_path,
        upgrade_from_version,
        is_upgrade,
        warnings,
    })
}

#[tauri::command]
fn plugin_import_local(
    file_path: String,
    options: Option<PluginImportOptionsDto>,
    app: tauri::AppHandle,
) -> Result<PluginInstalledDto, String> {
    let trimmed_path = file_path.trim();
    if trimmed_path.is_empty() {
        return Err("插件文件路径不能为空".to_string());
    }
    let source_path = PathBuf::from(trimmed_path);
    if !source_path.exists() {
        return Err("插件文件不存在".to_string());
    }
    if !source_path.is_file() {
        return Err("请选择有效的插件文件".to_string());
    }
    let extension = source_path
        .extension()
        .and_then(|item| item.to_str())
        .map(|item| item.trim().to_ascii_lowercase())
        .ok_or_else(|| "插件文件缺少扩展名".to_string())?;
    if !LOCAL_PLUGIN_ALLOWED_EXTENSIONS.iter().any(|item| *item == extension) {
        return Err(format!("不支持的插件格式: .{extension}"));
    }
    let metadata = fs::metadata(&source_path).map_err(|error| format!("读取插件文件信息失败: {error}"))?;
    let file_size = metadata.len();
    if file_size == 0 {
        return Err("插件文件为空，无法导入".to_string());
    }
    let (manifest, source_manifest_path) = parse_local_plugin_manifest(&source_path)?;
    let plugin_id = manifest
        .id
        .as_deref()
        .map(normalize_plugin_id)
        .filter(|item| !item.is_empty())
        .unwrap_or_else(|| build_local_plugin_id(&source_path, file_size));
    let normalized_plugin_id = normalize_plugin_id(&plugin_id);
    let packages_dir = plugins_packages_dir(&app)?;
    let package_file_name = format!("{plugin_id}.{extension}");
    let package_path = packages_dir.join(package_file_name);
    let mut state = read_plugin_state(&app)?;
    let previous = state.installed.iter().find(|item| item.id == plugin_id).cloned();
    let version_policy = resolve_version_policy(options.as_ref());
    if version_policy == "upgradeOnly" {
        if let Some(previous_installed) = previous.as_ref() {
            if !is_newer_semver(manifest.version.trim(), previous_installed.version.trim()) {
                return Err(format!(
                    "当前版本策略仅允许升级：已安装 v{}，导入 v{}",
                    previous_installed.version,
                    manifest.version.trim()
                ));
            }
        }
    }
    if let Some(previous) = previous {
        if let Some(path) = previous.package_path {
            let previous_package_path = PathBuf::from(path);
            if previous_package_path.exists() && previous_package_path.is_file() {
                let _ = fs::remove_file(previous_package_path);
            }
        }
        if let Some(path) = previous.manifest_path {
            let previous_manifest_path = PathBuf::from(path);
            if previous_manifest_path.exists() && previous_manifest_path.is_file() {
                let _ = fs::remove_file(previous_manifest_path);
            }
        }
    }
    fs::copy(&source_path, &package_path).map_err(|error| format!("复制插件文件失败: {error}"))?;
    let manifest_copy_path = packages_dir.join(format!("{normalized_plugin_id}.manifest.json"));
    if is_encrypted_local_plugin_path(&source_path) {
        let encrypted = read_encrypted_local_plugin(&source_path)?;
        fs::write(&manifest_copy_path, encrypted.manifest_text)
            .map_err(|error| format!("写入插件清单失败: {error}"))?;
    } else {
        fs::copy(&source_manifest_path, &manifest_copy_path)
            .map_err(|error| format!("复制插件清单失败: {error}"))?;
    }
    state.installed.retain(|item| item.id != plugin_id);
    let menu_enabled = manifest.menu.as_ref().map(|item| item.enabled).unwrap_or(false);
    let mut raw_menu_title = manifest
        .menu
        .as_ref()
        .and_then(|item| item.title.as_deref())
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .or_else(|| if menu_enabled { Some(manifest.name.trim().to_string()) } else { None });
    let mut raw_menu_route_path = if menu_enabled {
        let route = manifest
            .menu
            .as_ref()
            .and_then(|item| item.route_path.as_deref())
            .map(|item| item.trim().to_string())
            .filter(|item| !item.is_empty());
        Some(normalize_menu_route_path(&normalized_plugin_id, route.as_deref()))
    } else {
        None
    };
    let override_menu_title = normalize_override_value(options.as_ref().and_then(|item| item.menu_title_override.as_deref()));
    let override_menu_route_path =
        normalize_override_value(options.as_ref().and_then(|item| item.menu_route_path_override.as_deref()));
    if let Some(override_route) = override_menu_route_path.as_deref() {
        raw_menu_route_path = Some(normalize_menu_route_path(&normalized_plugin_id, Some(override_route)));
    }
    if let Some(override_title) = override_menu_title {
        raw_menu_title = Some(override_title);
    }
    let menu_icon = normalize_menu_icon(manifest.menu.as_ref().and_then(|item| item.icon.as_deref()));
    let menu_group = normalize_menu_group(manifest.menu.as_ref().and_then(|item| item.group.as_deref()));
    let (_, _, menu_title, menu_route_path) = resolve_menu_conflicts(
        &state,
        &plugin_id,
        menu_enabled,
        raw_menu_title,
        raw_menu_route_path,
    );
    let installed = PluginInstalledDto {
        id: plugin_id,
        name: manifest.name.trim().to_string(),
        description: manifest
            .description
            .as_deref()
            .map(|item| item.trim().to_string())
            .filter(|item| !item.is_empty())
            .unwrap_or_else(|| format!("从本地文件导入: {}", source_path.to_string_lossy())),
        version: manifest.version.trim().to_string(),
        author: manifest.author.trim().to_string(),
        homepage: manifest
            .homepage
            .as_deref()
            .map(|item| item.trim().to_string())
            .filter(|item| !item.is_empty()),
        repository: manifest
            .repository
            .as_deref()
            .map(|item| item.trim().to_string())
            .filter(|item| !item.is_empty()),
        license: manifest
            .license
            .as_deref()
            .map(|item| item.trim().to_string())
            .filter(|item| !item.is_empty()),
        source_type: "local".to_string(),
        package_path: Some(package_path.to_string_lossy().to_string()),
        manifest_path: Some(manifest_copy_path.to_string_lossy().to_string()),
        package_size_bytes: Some(file_size),
        menu_enabled,
        menu_title,
        menu_route_path,
        menu_icon,
        menu_group,
        enabled: true,
        installed_at: now_millis(),
    };
    state.installed.insert(0, installed.clone());
    write_plugin_state(&app, &state)?;
    Ok(installed)
}

/// 把主窗口拉到前台：最小化/隐藏在托盘时，只 show 是拉不回来的，必须先 unminimize 再聚焦
fn reveal_main_window<R: tauri::Runtime>(app_handle: &tauri::AppHandle<R>) {
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 单实例：必须第一个注册。第二个进程会立刻退出，并把已有窗口拉到前台
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            reveal_main_window(app);
        }))
        .plugin(tauri_plugin_autostart::Builder::new().args(["--autostart"]).build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let show_main = tauri::menu::MenuItem::with_id(app, "tray_show_main", "显示主界面", true, None::<&str>)?;
            let quit_app = tauri::menu::MenuItem::with_id(app, "tray_quit_app", "退出", true, None::<&str>)?;
            let tray_menu = tauri::menu::Menu::with_items(app, &[&show_main, &quit_app])?;

            let mut tray_builder = tauri::tray::TrayIconBuilder::new()
                .menu(&tray_menu)
                .tooltip("TinyAii 下载器")
                .show_menu_on_left_click(false)
                .on_menu_event(|app_handle: &tauri::AppHandle, event: tauri::menu::MenuEvent| match event.id().as_ref() {
                    "tray_show_main" => reveal_main_window(app_handle),
                    "tray_quit_app" => app_handle.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray: &tauri::tray::TrayIcon, event: tauri::tray::TrayIconEvent| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event
                    {
                        reveal_main_window(tray.app_handle());
                    }
                });

            // 托盘图标必须显式设置：不设置时 Windows 托盘会留一个看不见的空位
            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }

            tray_builder.build(app)?;

            api_server::start(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            aria2_add_tasks,
            aria2_get_tasks,
            aria2_get_task_detail,
            aria2_start_task,
            aria2_pause_task,
            aria2_change_uri,
            aria2_stop_task,
            aria2_remove_task,
            aria2_start_all_tasks,
            aria2_pause_all_tasks,
            aria2_stop_all_tasks,
            aria2_clear_completed_tasks,
            aria2_clear_all_tasks,
            aria2_get_version,
            aria2_update_and_restart_engine,
            aria2_set_global_speed_limit,
            aria2_set_global_bt_options,
            aria2_set_global_tracker_list,
            aria2_get_task_option_constraints,
            app_get_install_dir,
            app_read_text_file,
            app_write_text_file,
            app_http_get_text,
            app_get_file_meta,
            app_truncate_text_file,
            app_probe_listen_ports,
            app_is_autostart_launch,
            app_exit,
            app_open_plugin_webview,
            app_collect_webview_cookies,
            app_http_get_json,
            app_probe_url,
            app_http_request_json,
            app_resolve_bilibili_links,
            plugin_list_installed,
            plugin_list_discover,
            plugin_install,
            plugin_read_runtime_script,
            plugin_precheck_local,
            plugin_import_local,
            plugin_uninstall,
            plugin_toggle_enabled,
            api_server::api_get_info,
            api_server::api_set_enabled,
            api_server::api_update_mirrors,
            api_server::api_update_config
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                terminate_engine();
            }
        });
}
