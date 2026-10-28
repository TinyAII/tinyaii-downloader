use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use flate2::read::GzDecoder;
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Cursor, Read};
use std::path::Path;

pub const ENCRYPTED_LOCAL_PLUGIN_EXTENSION: &str = "tinyplugin";

const ENCRYPTED_LOCAL_PLUGIN_MAGIC: &[u8] = b"TAII_PLUGIN_V1";
const ENCRYPTED_LOCAL_PLUGIN_NONCE_LENGTH: usize = 12;
const ENCRYPTED_LOCAL_PLUGIN_SECRET: &str =
    "TinyAii::LocalPlugin::2026-03-25::fd7a8eaec1a54ed58bb8b18b2d2f8c63";

#[derive(Debug, Deserialize)]
struct EncryptedLocalPluginScriptPayload {
    #[serde(default)]
    file_name: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct EncryptedLocalPluginPayload {
    format: String,
    version: u32,
    manifest: Value,
    script: EncryptedLocalPluginScriptPayload,
}

#[derive(Debug, Clone)]
pub struct EncryptedLocalPluginContent {
    pub manifest_text: String,
    pub script_file_name: String,
    pub script_text: String,
}

pub fn is_encrypted_local_plugin_path(path: &Path) -> bool {
    path.extension()
        .and_then(|item| item.to_str())
        .map(|item| item.trim().eq_ignore_ascii_case(ENCRYPTED_LOCAL_PLUGIN_EXTENSION))
        .unwrap_or(false)
}

pub fn read_encrypted_local_plugin(path: &Path) -> Result<EncryptedLocalPluginContent, String> {
    let encrypted_bytes = fs::read(path).map_err(|error| format!("读取加密插件包失败: {error}"))?;
    if encrypted_bytes.len()
        <= ENCRYPTED_LOCAL_PLUGIN_MAGIC.len() + ENCRYPTED_LOCAL_PLUGIN_NONCE_LENGTH
    {
        return Err("读取加密插件包失败: 文件内容不完整".to_string());
    }
    if !encrypted_bytes.starts_with(ENCRYPTED_LOCAL_PLUGIN_MAGIC) {
        return Err("读取加密插件包失败: 文件头校验失败".to_string());
    }
    let nonce_start = ENCRYPTED_LOCAL_PLUGIN_MAGIC.len();
    let nonce_end = nonce_start + ENCRYPTED_LOCAL_PLUGIN_NONCE_LENGTH;
    let nonce = Nonce::from_slice(&encrypted_bytes[nonce_start..nonce_end]);
    let ciphertext = &encrypted_bytes[nonce_end..];
    if ciphertext.is_empty() {
        return Err("读取加密插件包失败: 缺少密文内容".to_string());
    }
    let cipher = Aes256Gcm::new_from_slice(&build_encrypted_local_plugin_key())
        .map_err(|error| format!("初始化插件解密器失败: {error}"))?;
    let compressed_payload = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| "读取加密插件包失败: 解密失败，文件可能已损坏或来源不受支持".to_string())?;
    let mut payload_json = String::new();
    GzDecoder::new(Cursor::new(compressed_payload))
        .read_to_string(&mut payload_json)
        .map_err(|error| format!("读取加密插件包失败: 解压内容失败: {error}"))?;
    let payload = serde_json::from_str::<EncryptedLocalPluginPayload>(&payload_json)
        .map_err(|error| format!("读取加密插件包失败: 解析载荷失败: {error}"))?;
    if payload.format.trim() != "tinyaii-local-plugin" {
        return Err("读取加密插件包失败: 载荷格式不受支持".to_string());
    }
    if payload.version != 1 {
        return Err(format!("读取加密插件包失败: 载荷版本 {} 不受支持", payload.version));
    }
    if payload.script.content.trim().is_empty() {
        return Err("读取加密插件包失败: 插件脚本内容为空".to_string());
    }
    let manifest_text = serde_json::to_string_pretty(&payload.manifest)
        .map_err(|error| format!("读取加密插件包失败: 序列化清单失败: {error}"))?;
    let script_file_name = if payload.script.file_name.trim().is_empty() {
        "index.js".to_string()
    } else {
        payload.script.file_name.trim().to_string()
    };
    Ok(EncryptedLocalPluginContent {
        manifest_text,
        script_file_name,
        script_text: payload.script.content,
    })
}

fn build_encrypted_local_plugin_key() -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(ENCRYPTED_LOCAL_PLUGIN_SECRET.as_bytes());
    hasher
        .finalize()
        .as_slice()
        .try_into()
        .unwrap_or([0_u8; 32])
}
