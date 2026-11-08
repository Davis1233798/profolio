#![allow(dead_code)]

use hmac::{Hmac, Mac};
use sha2::Sha256;
use serde::{Deserialize, Serialize};

type HmacSha256 = Hmac<Sha256>;

pub const DEFAULT_MASTER_SECRET: &str = "BUSINESS_SUITE_MASTER_AUTHORITY_KEY_2026_PRODUCTION_SIGNING_SECRET";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicensePayload {
    pub id: String,
    pub customer: String,
    pub contact: String,
    pub hwid: String,
    pub modules: Vec<String>,
    #[serde(rename = "issuedAt")]
    pub issued_at: u64,
    #[serde(rename = "expiresAt")]
    pub expires_at: u64,
    pub tier: String,
}

impl LicensePayload {
    pub fn is_expired(&self, current_timestamp: u64) -> bool {
        current_timestamp > self.expires_at
    }

    pub fn allows_module(&self, module: &str) -> bool {
        self.modules.iter().any(|m| m.eq_ignore_ascii_case(module) || m == "all" || m == "*")
    }
}

pub fn sign_license(payload: &LicensePayload, secret: &str) -> Result<String, String> {
    let json_bytes = serde_json::to_vec(payload)
        .map_err(|e| format!("序列化失敗: {e}"))?;
    let payload_b64 = simple_base64_encode(&json_bytes);

    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .map_err(|e| format!("HMAC 初始化失敗: {e}"))?;
    mac.update(payload_b64.as_bytes());
    let sig = mac.finalize().into_bytes();
    let sig_hex = sig.iter().map(|b| format!("{:02x}", b)).collect::<String>();

    Ok(format!("BSLIC-V1-{payload_b64}.{sig_hex}"))
}

pub fn verify_license(key: &str, secret: &str) -> Result<LicensePayload, String> {
    let trimmed = key.trim();
    if !trimmed.starts_with("BSLIC-V1-") {
        return Err("金鑰格式錯誤（缺少 BSLIC-V1- 前綴）".to_string());
    }
    let rest = &trimmed["BSLIC-V1-".len()..];
    let parts: Vec<&str> = rest.split('.').collect();
    if parts.len() != 2 {
        return Err("金鑰結構無效（缺少簽章段落）".to_string());
    }
    let payload_b64 = parts[0];
    let sig_hex = parts[1];

    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .map_err(|e| format!("HMAC 初始化失敗: {e}"))?;
    mac.update(payload_b64.as_bytes());
    let expected_sig = mac.finalize().into_bytes();
    let expected_hex = expected_sig.iter().map(|b| format!("{:02x}", b)).collect::<String>();

    if sig_hex.to_lowercase() != expected_hex.to_lowercase() {
        return Err("金鑰簽章驗證失敗，金鑰可能遭到篡改或無效。".to_string());
    }

    let json_bytes = simple_base64_decode(payload_b64)
        .map_err(|e| format!("金鑰內容解碼失敗: {e}"))?;
    let payload: LicensePayload = serde_json::from_slice(&json_bytes)
        .map_err(|e| format!("金鑰資料格式無效: {e}"))?;

    Ok(payload)
}

// Lightweight standard base64 implementation without external dependencies
pub fn simple_base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    let mut i = 0;
    while i < data.len() {
        let b0 = data[i];
        let b1 = if i + 1 < data.len() { data[i + 1] } else { 0 };
        let b2 = if i + 2 < data.len() { data[i + 2] } else { 0 };

        out.push(CHARS[(b0 >> 2) as usize] as char);
        out.push(CHARS[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);
        if i + 1 < data.len() {
            out.push(CHARS[(((b1 & 0x0F) << 2) | (b2 >> 6)) as usize] as char);
        } else {
            out.push('=');
        }
        if i + 2 < data.len() {
            out.push(CHARS[(b2 & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
        i += 3;
    }
    out
}

pub fn simple_base64_decode(input: &str) -> Result<Vec<u8>, String> {
    fn val(c: u8) -> Result<u8, String> {
        match c {
            b'A'..=b'Z' => Ok(c - b'A'),
            b'a'..=b'z' => Ok(c - b'a' + 26),
            b'0'..=b'9' => Ok(c - b'0' + 52),
            b'+' => Ok(62),
            b'/' => Ok(63),
            b'=' => Ok(0),
            _ => Err(format!("無效的 Base64 字元: {}", c as char)),
        }
    }

    let bytes: Vec<u8> = input.bytes().filter(|&b| b != b'\r' && b != b'\n' && b != b' ').collect();
    if bytes.len() % 4 != 0 {
        return Err("Base64 長度無效".to_string());
    }

    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        let v0 = val(bytes[i])?;
        let v1 = val(bytes[i + 1])?;
        let v2 = val(bytes[i + 2])?;
        let v3 = val(bytes[i + 3])?;

        out.push((v0 << 2) | (v1 >> 4));
        if bytes[i + 2] != b'=' {
            out.push(((v1 & 0x0F) << 4) | (v2 >> 2));
        }
        if bytes[i + 3] != b'=' {
            out.push(((v2 & 0x03) << 6) | v3);
        }
        i += 4;
    }
    Ok(out)
}
