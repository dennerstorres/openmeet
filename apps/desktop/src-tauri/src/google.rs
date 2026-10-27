//! ADR 0010: Google sign-in happens in the system browser. The webview may ask for one
//! address only: Google's own authorization page over HTTPS.

use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

const AUTHORIZE: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const MAX_URL: usize = 4096;

pub fn accept_google_url(raw: &str) -> Option<String> {
    if raw.len() > MAX_URL || raw.chars().any(char::is_control) {
        return None;
    }
    let url = tauri::Url::parse(raw).ok()?;
    if url.scheme() != "https" || url.host_str() != Some("accounts.google.com") || url.port().is_some() {
        return None;
    }
    if !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() {
        return None;
    }
    if format!("{}://{}{}", url.scheme(), url.host_str()?, url.path()) != AUTHORIZE {
        return None;
    }
    Some(url.to_string())
}

/// ADR 0024: a link in a chat message, after the person confirmed the address. Only http and https, no
/// credentials in the address, nothing hidden: the system browser opens it, never this window.
pub fn accept_chat_link(raw: &str) -> Option<String> {
    if raw.len() > MAX_URL || raw.chars().any(char::is_control) {
        return None;
    }
    let url = tauri::Url::parse(raw).ok()?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() || !url.username().is_empty() || url.password().is_some() {
        return None;
    }
    Some(url.to_string())
}

#[tauri::command]
pub fn open_chat_link(app: AppHandle, url: String) -> Result<(), String> {
    let url = accept_chat_link(&url).ok_or_else(|| "invalid_link".to_string())?;
    app.opener().open_url(url, None::<&str>).map_err(|_| "open_failed".to_string())
}

#[tauri::command]
pub fn open_google_login(app: AppHandle, url: String) -> Result<(), String> {
    let url = accept_google_url(&url).ok_or_else(|| "invalid_google_url".to_string())?;
    app.opener().open_url(url, None::<&str>).map_err(|_| "open_failed".to_string())
}

#[cfg(test)]
mod tests {
    use super::{accept_chat_link, accept_google_url};

    #[test]
    fn chat_links_open_only_as_plain_web_addresses() {
        assert_eq!(accept_chat_link("https://example.com/a?b=1#c").as_deref(), Some("https://example.com/a?b=1#c"));
        assert!(accept_chat_link("http://example.com").is_some());
        for raw in [
            "javascript:alert(1)",
            "file:///C:/Windows/System32/calc.exe",
            "openmeet://convite/x",
            "https://user:pass@example.com",
            "https://example.com/\nx",
            "ms-settings:",
        ] {
            assert!(accept_chat_link(raw).is_none(), "{raw}");
        }
    }

    #[test]
    fn opens_only_google_authorization() {
        let good = "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=y";
        assert!(accept_google_url(good).is_some());
        for raw in [
            "http://accounts.google.com/o/oauth2/v2/auth?x=1",
            "https://accounts.google.com.evil.example/o/oauth2/v2/auth",
            "https://evil.example/o/oauth2/v2/auth",
            "https://user@accounts.google.com/o/oauth2/v2/auth",
            "https://accounts.google.com:444/o/oauth2/v2/auth",
            "https://accounts.google.com/o/oauth2/v2/auth#x",
            "https://accounts.google.com/other",
            "file:///C:/Windows/System32/calc.exe",
            "javascript:alert(1)",
        ] {
            assert!(accept_google_url(raw).is_none(), "{raw}");
        }
    }
}
