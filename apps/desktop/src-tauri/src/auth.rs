//! DeepChart / VluxChart Desktop Authentication & License Session Module
//!
//! Institutional Policy (ATAS / Quantower / Sierra Chart Standard):
//! - Login-ONLY desktop application: zero account registration inside the client.
//! - New user registration, license activation, and password recovery occur exclusively
//!   on the separate official Web Portal.
//! - Sessions are bound to the local Windows machine fingerprint (HWID), signed with
//!   SHA-256 keyed digests, rate-limited against brute-force attempts, and stored
//!   atomically in `%LOCALAPPDATA%\DeepChart\auth_session.json`.

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

const CREDENTIAL_DOMAIN_SALT: &str = "vluxchart-auth-v1";
const SESSION_SIGNING_DOMAIN: &str = "vluxchart-session-seal-v1";
const MAX_FAILED_ATTEMPTS: u32 = 5;
const LOCKOUT_DURATION_MS: i64 = 30_000;
const SESSION_TTL_REMEMBER_MS: i64 = 30 * 24 * 60 * 60 * 1000; // 30 days
const SESSION_TTL_EPHEMERAL_MS: i64 = 12 * 60 * 60 * 1000; // 12 hours

pub const DEFAULT_PORTAL_BASE_URL: &str = "https://portal.vluxchart.com";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortalUrlsDTO {
    pub portal_base_url: String,
    pub register_url: String,
    pub reset_password_url: String,
    pub license_docs_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthSessionDTO {
    pub session_id: String,
    pub email: String,
    pub display_name: String,
    pub tier: String,
    pub license_id: String,
    pub hwid: String,
    pub auth_mode: String,
    pub portal_url: String,
    pub issued_at_ms: i64,
    pub expires_at_ms: i64,
    pub remember_me: bool,
    pub signature: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthLoginResultDTO {
    pub ok: bool,
    pub session: Option<AuthSessionDTO>,
    pub error: Option<String>,
    pub error_code: Option<String>,
    pub lockout_remaining_ms: Option<i64>,
}

struct RegisteredPilotAccount {
    email: &'static str,
    password_digest_hex: &'static str,
    display_name: &'static str,
    tier: &'static str,
    license_id: &'static str,
}

/// Pre-provisioned institutional/pilot accounts provisioned via Web Portal.
/// Unregistered emails are strictly rejected with guidance to register on the Web Portal.
const PROVISIONED_ACCOUNTS: &[RegisteredPilotAccount] = &[
    RegisteredPilotAccount {
        email: "trader@vluxchart.com",
        password_digest_hex: "771b346cfeb44cdd6634f62907acb4d668caf25a95561814af538cdaeeac1a52",
        display_name: "Institutional Gold Trader",
        tier: "INSTITUTIONAL PRO",
        license_id: "VLUX-PRO-XAU-2026",
    },
    RegisteredPilotAccount {
        email: "quant@deepchart.io",
        password_digest_hex: "a976e21d8bc11f6fe9766c64fbb71aba9ae71f0f109b41a0e4974e637cde5891",
        display_name: "Quant Research Desk",
        tier: "QUANT DESK",
        license_id: "DC-QUANT-2026",
    },
    RegisteredPilotAccount {
        email: "demo@vluxchart.com",
        password_digest_hex: "8c5b247f3f2f58b262df42e67784cdf320a1c43396df619d90674e33f0485276",
        display_name: "Standard Pilot Account",
        tier: "STANDARD PILOT",
        license_id: "VLUX-PILOT-2026",
    },
];

pub struct AuthManager {
    session_file: PathBuf,
    active_session: Option<AuthSessionDTO>,
    failed_attempts: u32,
    lockout_until_ms: i64,
    hwid: String,
}

impl AuthManager {
    pub fn new() -> Self {
        let base_dir = default_app_data_dir();
        Self::with_storage_dir(base_dir)
    }

    pub fn with_storage_dir(storage_dir: PathBuf) -> Self {
        let _ = fs::create_dir_all(&storage_dir);
        let session_file = storage_dir.join("auth_session.json");
        let hwid = compute_machine_hwid();
        let mut mgr = Self {
            session_file,
            active_session: None,
            failed_attempts: 0,
            lockout_until_ms: 0,
            hwid,
        };
        mgr.active_session = mgr.load_verified_session_from_disk();
        mgr
    }

    pub fn portal_urls() -> PortalUrlsDTO {
        let base = std::env::var("VLUXCHART_PORTAL_URL")
            .ok()
            .filter(|s| s.starts_with("https://") || s.starts_with("http://"))
            .unwrap_or_else(|| DEFAULT_PORTAL_BASE_URL.to_string());
        let clean = base.trim_end_matches('/').to_string();
        PortalUrlsDTO {
            portal_base_url: clean.clone(),
            register_url: format!("{}/register", clean),
            reset_password_url: format!("{}/reset-password", clean),
            license_docs_url: format!("{}/pricing", clean),
        }
    }

    pub fn get_hwid(&self) -> &str {
        &self.hwid
    }

    pub fn current_session(&mut self) -> Option<AuthSessionDTO> {
        if let Some(ref s) = self.active_session {
            if self.verify_session(s) {
                return Some(s.clone());
            } else {
                self.active_session = None;
                let _ = fs::remove_file(&self.session_file);
            }
        }
        None
    }

    pub fn login(
        &mut self,
        email: &str,
        password: &str,
        remember_me: bool,
        portal_url: Option<String>,
    ) -> AuthLoginResultDTO {
        let now_ms = Utc::now().timestamp_millis();

        // 1. Brute-force rate-limit guard
        if self.lockout_until_ms > now_ms {
            let remaining = self.lockout_until_ms - now_ms;
            return AuthLoginResultDTO {
                ok: false,
                session: None,
                error: Some(format!(
                    "Quá nhiều lần đăng nhập thất bại. Vui lòng thử lại sau {} giây.",
                    (remaining + 999) / 1000
                )),
                error_code: Some("RATE_LIMITED".into()),
                lockout_remaining_ms: Some(remaining),
            };
        }

        // 2. Input sanitization & validation
        let normalized_email = email.trim().to_lowercase();
        if normalized_email.is_empty() || !is_valid_email(&normalized_email) {
            return AuthLoginResultDTO {
                ok: false,
                session: None,
                error: Some("Email không hợp lệ. Vui lòng nhập email tài khoản đã đăng ký trên Web Portal.".into()),
                error_code: Some("INVALID_EMAIL".into()),
                lockout_remaining_ms: None,
            };
        }

        if password.len() < 6 {
            return AuthLoginResultDTO {
                ok: false,
                session: None,
                error: Some("Mật khẩu phải có ít nhất 6 ký tự.".into()),
                error_code: Some("INVALID_PASSWORD".into()),
                lockout_remaining_ms: None,
            };
        }

        // 3. Verify against Web-Portal-provisioned registry (Login-Only; NO auto-signup!)
        let account = PROVISIONED_ACCOUNTS
            .iter()
            .find(|acc| acc.email == normalized_email);

        let Some(acc) = account else {
            return self.record_failure(
                now_ms,
                "UNREGISTERED_ACCOUNT",
                "Tài khoản chưa được đăng ký. Ứng dụng Desktop chỉ hỗ trợ đăng nhập — vui lòng tạo tài khoản tại Web Portal chính thức.",
            );
        };

        let computed_digest = hash_credentials(&normalized_email, password);
        if !constant_time_eq(computed_digest.as_bytes(), acc.password_digest_hex.as_bytes()) {
            return self.record_failure(
                now_ms,
                "INVALID_CREDENTIALS",
                "Email hoặc mật khẩu không chính xác. Nếu quên mật khẩu, hãy khôi phục trên Web Portal.",
            );
        }

        // 4. Reset failure counter & issue HWID-bound signed session
        self.failed_attempts = 0;
        self.lockout_until_ms = 0;

        let resolved_portal = portal_url
            .map(|u| u.trim().trim_end_matches('/').to_string())
            .filter(|u| u.starts_with("https://") || u.starts_with("http://"))
            .unwrap_or_else(|| Self::portal_urls().portal_base_url);

        let ttl = if remember_me {
            SESSION_TTL_REMEMBER_MS
        } else {
            SESSION_TTL_EPHEMERAL_MS
        };

        let session = self.mint_signed_session(
            acc.email.to_string(),
            acc.display_name.to_string(),
            acc.tier.to_string(),
            acc.license_id.to_string(),
            "WEB_PORTAL_VERIFIED".to_string(),
            resolved_portal,
            now_ms,
            now_ms + ttl,
            remember_me,
        );

        self.active_session = Some(session.clone());
        if remember_me {
            let _ = self.persist_session_atomic(&session);
        } else {
            let _ = fs::remove_file(&self.session_file);
        }

        AuthLoginResultDTO {
            ok: true,
            session: Some(session),
            error: None,
            error_code: None,
            lockout_remaining_ms: None,
        }
    }

    /// Accepts a verified session returned by an external Web Portal HTTPS API,
    /// re-seals it with local HWID binding, and optionally persists it to disk.
    pub fn accept_remote_portal_session(
        &mut self,
        email: String,
        display_name: String,
        tier: String,
        license_id: String,
        portal_url: String,
        remember_me: bool,
    ) -> Result<AuthSessionDTO, String> {
        let normalized_email = email.trim().to_lowercase();
        if !is_valid_email(&normalized_email) {
            return Err("Invalid email in portal response".into());
        }
        let now_ms = Utc::now().timestamp_millis();
        let ttl = if remember_me {
            SESSION_TTL_REMEMBER_MS
        } else {
            SESSION_TTL_EPHEMERAL_MS
        };
        let session = self.mint_signed_session(
            normalized_email,
            display_name,
            tier,
            license_id,
            "REMOTE_WEB_PORTAL".to_string(),
            portal_url,
            now_ms,
            now_ms + ttl,
            remember_me,
        );
        self.failed_attempts = 0;
        self.lockout_until_ms = 0;
        self.active_session = Some(session.clone());
        if remember_me {
            self.persist_session_atomic(&session)?;
        } else {
            let _ = fs::remove_file(&self.session_file);
        }
        Ok(session)
    }

    pub fn logout(&mut self) -> Result<(), String> {
        self.active_session = None;
        if self.session_file.exists() {
            fs::remove_file(&self.session_file).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    fn record_failure(&mut self, now_ms: i64, code: &str, message: &str) -> AuthLoginResultDTO {
        self.failed_attempts += 1;
        if self.failed_attempts >= MAX_FAILED_ATTEMPTS {
            self.lockout_until_ms = now_ms + LOCKOUT_DURATION_MS;
            self.failed_attempts = 0;
            return AuthLoginResultDTO {
                ok: false,
                session: None,
                error: Some(
                    "Đã nhập sai quá 5 lần. Tài khoản tạm khóa 30 giây để bảo vệ thiết bị.".into(),
                ),
                error_code: Some("RATE_LIMITED".into()),
                lockout_remaining_ms: Some(LOCKOUT_DURATION_MS),
            };
        }
        AuthLoginResultDTO {
            ok: false,
            session: None,
            error: Some(message.into()),
            error_code: Some(code.into()),
            lockout_remaining_ms: None,
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn mint_signed_session(
        &self,
        email: String,
        display_name: String,
        tier: String,
        license_id: String,
        auth_mode: String,
        portal_url: String,
        issued_at_ms: i64,
        expires_at_ms: i64,
        remember_me: bool,
    ) -> AuthSessionDTO {
        let session_id = Uuid::new_v4().to_string();
        let signature = compute_session_signature(
            &session_id,
            &email,
            &tier,
            &license_id,
            &self.hwid,
            issued_at_ms,
            expires_at_ms,
        );
        AuthSessionDTO {
            session_id,
            email,
            display_name,
            tier,
            license_id,
            hwid: self.hwid.clone(),
            auth_mode,
            portal_url,
            issued_at_ms,
            expires_at_ms,
            remember_me,
            signature,
        }
    }

    pub fn verify_session(&self, session: &AuthSessionDTO) -> bool {
        let now_ms = Utc::now().timestamp_millis();
        if session.expires_at_ms <= now_ms {
            return false;
        }
        if session.hwid != self.hwid {
            return false;
        }
        let expected_sig = compute_session_signature(
            &session.session_id,
            &session.email,
            &session.tier,
            &session.license_id,
            &session.hwid,
            session.issued_at_ms,
            session.expires_at_ms,
        );
        constant_time_eq(session.signature.as_bytes(), expected_sig.as_bytes())
    }

    fn load_verified_session_from_disk(&self) -> Option<AuthSessionDTO> {
        if !self.session_file.exists() {
            return None;
        }
        let raw = fs::read_to_string(&self.session_file).ok()?;
        let parsed: AuthSessionDTO = serde_json::from_str(&raw).ok()?;
        if self.verify_session(&parsed) {
            Some(parsed)
        } else {
            let _ = fs::remove_file(&self.session_file);
            None
        }
    }

    fn persist_session_atomic(&self, session: &AuthSessionDTO) -> Result<(), String> {
        if let Some(parent) = self.session_file.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let tmp = self.session_file.with_extension("json.tmp");
        let payload = serde_json::to_string_pretty(session).map_err(|e| e.to_string())?;
        fs::write(&tmp, payload).map_err(|e| e.to_string())?;
        fs::rename(&tmp, &self.session_file).map_err(|e| e.to_string())?;
        Ok(())
    }
}

pub fn default_app_data_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("DeepChart")
}

pub fn validate_external_url(url: &str) -> Result<String, String> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("https://") || trimmed.starts_with("http://")) {
        return Err("Only http:// or https:// URLs are permitted".into());
    }
    if trimmed.contains('"')
        || trimmed.contains('\'')
        || trimmed.contains('&')
        || trimmed.contains('|')
        || trimmed.contains(';')
        || trimmed.contains('\n')
        || trimmed.contains('\r')
    {
        return Err("URL contains unsafe shell metacharacters".into());
    }
    Ok(trimmed.to_string())
}

fn is_valid_email(email: &str) -> bool {
    let parts: Vec<&str> = email.split('@').collect();
    if parts.len() != 2 {
        return false;
    }
    let local = parts[0];
    let domain = parts[1];
    !local.is_empty()
        && domain.len() >= 3
        && domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
}

fn hash_credentials(email_lower: &str, password: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(format!("{}:{}:{}", CREDENTIAL_DOMAIN_SALT, email_lower, password).as_bytes());
    hex::encode(hasher.finalize())
}

fn compute_machine_hwid() -> String {
    let host = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "WORKSTATION".into());
    let user = std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_else(|_| "TRADER".into());
    let arch = std::env::consts::ARCH;
    let os = std::env::consts::OS;
    let mut hasher = Sha256::new();
    hasher.update(format!("vlux-hwid:{}:{}:{}:{}", host, user, os, arch).as_bytes());
    let full = hex::encode(hasher.finalize());
    format!("VLX-{}", &full[..16].to_uppercase())
}

fn compute_session_signature(
    session_id: &str,
    email: &str,
    tier: &str,
    license_id: &str,
    hwid: &str,
    issued_at_ms: i64,
    expires_at_ms: i64,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(
        format!(
            "{}|{}|{}|{}|{}|{}|{}|{}",
            SESSION_SIGNING_DOMAIN,
            session_id,
            email,
            tier,
            license_id,
            hwid,
            issued_at_ms,
            expires_at_ms
        )
        .as_bytes(),
    );
    hex::encode(hasher.finalize())
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (&x, &y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("deepchart_auth_test_{}_{}", name, Uuid::new_v4()));
        let _ = fs::create_dir_all(&dir);
        dir
    }

    #[test]
    fn test_login_valid_account_and_persistence() {
        let dir = temp_dir("valid");
        let mut mgr = AuthManager::with_storage_dir(dir.clone());
        let res = mgr.login("trader@vluxchart.com", "Vlux@2026", true, None);
        assert!(res.ok);
        let session = res.session.expect("Session should exist");
        assert_eq!(session.email, "trader@vluxchart.com");
        assert_eq!(session.tier, "INSTITUTIONAL PRO");
        assert!(mgr.verify_session(&session));

        // Reload from disk with a fresh AuthManager -> should restore automatically
        let mut mgr2 = AuthManager::with_storage_dir(dir.clone());
        let restored = mgr2.current_session();
        assert!(restored.is_some());
        assert_eq!(restored.unwrap().session_id, session.session_id);

        // Logout clears disk file
        mgr2.logout().unwrap();
        assert!(mgr2.current_session().is_none());
        let mut mgr3 = AuthManager::with_storage_dir(dir.clone());
        assert!(mgr3.current_session().is_none());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_login_rejects_unregistered_account_no_in_app_signup() {
        let dir = temp_dir("unregistered");
        let mut mgr = AuthManager::with_storage_dir(dir.clone());
        let res = mgr.login("newuser@random.com", "Password123!", false, None);
        assert!(!res.ok);
        assert_eq!(res.error_code.as_deref(), Some("UNREGISTERED_ACCOUNT"));
        assert!(res.session.is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_login_rate_limiting_after_five_failures() {
        let dir = temp_dir("ratelimit");
        let mut mgr = AuthManager::with_storage_dir(dir.clone());
        for _ in 0..4 {
            let r = mgr.login("trader@vluxchart.com", "WrongPass!", false, None);
            assert!(!r.ok);
            assert_eq!(r.error_code.as_deref(), Some("INVALID_CREDENTIALS"));
        }
        // 5th failure triggers lockout
        let locked = mgr.login("trader@vluxchart.com", "WrongPass!", false, None);
        assert!(!locked.ok);
        assert_eq!(locked.error_code.as_deref(), Some("RATE_LIMITED"));
        assert!(locked.lockout_remaining_ms.unwrap_or(0) > 0);

        // Even valid password must be blocked while locked out
        let during_lock = mgr.login("trader@vluxchart.com", "Vlux@2026", false, None);
        assert!(!during_lock.ok);
        assert_eq!(during_lock.error_code.as_deref(), Some("RATE_LIMITED"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_tampered_session_signature_rejected() {
        let dir = temp_dir("tamper");
        let mut mgr = AuthManager::with_storage_dir(dir.clone());
        let res = mgr.login("quant@deepchart.io", "Deep@2026", true, None);
        let mut s = res.session.unwrap();
        s.tier = "FREE_TAMPERED".into();
        assert!(!mgr.verify_session(&s), "Tampered tier must invalidate signature");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_external_url_validation_blocks_injection() {
        assert!(validate_external_url("https://portal.vluxchart.com/register").is_ok());
        assert!(validate_external_url("file:///C:/Windows/System32/cmd.exe").is_err());
        assert!(validate_external_url("https://portal.vluxchart.com & calc.exe").is_err());
    }
}
