//! S-05 and S-18: the refresh token lives only in this process and in the vault slot.
//! The page gets the access token and the user, never the refresh. Instance metadata stays in the page.

use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};

use crate::shell::{accept_origin, accept_token, clear_slot, drop_legacy_item, load_slot, save_slot, KeyringSlot};

/// What the page sees of an HTTP answer. `refreshToken` is never part of `body`.
#[derive(Debug, PartialEq, Serialize)]
pub struct Reply {
    status: u16,
    body: Value,
}

/// Removes the refresh from the body. A success must carry one; anything else never passes it on.
fn take_refresh(status: u16, mut body: Value) -> Result<(Reply, Option<String>), String> {
    let refresh = body
        .as_object_mut()
        .and_then(|object| object.remove("refreshToken"))
        .and_then(|value| value.as_str().map(str::to_string));
    if status == 200 || status == 201 {
        let Some(refresh) = refresh.filter(|token| accept_token(token)) else {
            return Err("invalid_session".to_string());
        };
        return Ok((Reply { status, body }, Some(refresh)));
    }
    Ok((Reply { status, body }, None))
}

/// One POST to the pinned instance: ten seconds, no redirect, no cookie.
async fn post(origin: &str, path: &str, body: &Value) -> Result<(u16, Value), String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|_| "request_failed".to_string())?;
    let response = client
        .post(format!("{origin}{path}"))
        .header("accept", "application/json")
        .header("content-type", "application/json")
        .body(body.to_string())
        .send()
        .await
        .map_err(|_| "request_failed".to_string())?;
    let status = response.status().as_u16();
    let text = response.text().await.unwrap_or_default();
    Ok((status, serde_json::from_str(&text).unwrap_or(Value::Null)))
}

async fn start(origin: &str, path: &str, body: Value) -> Result<Reply, String> {
    if !accept_origin(origin) {
        return Err("invalid_origin".to_string());
    }
    let (status, answer) = post(origin, path, &body).await?;
    let (reply, refresh) = take_refresh(status, answer)?;
    if let Some(refresh) = refresh {
        save_slot(&KeyringSlot, origin, &refresh)?;
        drop_legacy_item(origin);
    }
    Ok(reply)
}

#[tauri::command]
pub async fn session_login(origin: String, username: String, password: String) -> Result<Reply, String> {
    start(&origin, "/api/v1/auth/login", json!({ "username": username, "password": password })).await
}

#[tauri::command]
pub async fn session_bootstrap(origin: String, token: String, username: String, password: String, display_name: String) -> Result<Reply, String> {
    let body = json!({ "token": token, "username": username, "password": password, "displayName": display_name });
    start(&origin, "/api/v1/auth/bootstrap", body).await
}

/// ADR 0010: the Google poll hands over a session once. 202 means still waiting.
#[tauri::command]
pub async fn session_google(origin: String, poll: String) -> Result<Reply, String> {
    start(&origin, "/api/v1/auth/google/poll", json!({ "poll": poll })).await
}

/// Renews from the slot. `None` when the slot holds nothing for this instance.
#[tauri::command]
pub async fn session_refresh(origin: String) -> Result<Option<Reply>, String> {
    let refresh = match load_slot(&KeyringSlot, &origin) {
        Ok(Some(refresh)) => refresh,
        Ok(None) => return Ok(None),
        Err(code) if code == "invalid_origin" => return Ok(None),
        Err(code) => return Err(code),
    };
    let (status, answer) = post(&origin, "/api/v1/auth/refresh", &json!({ "refreshToken": refresh })).await?;
    let (reply, renewed) = take_refresh(status, answer)?;
    if let Some(renewed) = renewed {
        save_slot(&KeyringSlot, &origin, &renewed)?;
    }
    Ok(Some(reply))
}

/// S-18: logout with the refresh of the slot, never one sent by the page. The slot goes only when the
/// server is done with it (204, or a 4xx that no retry fixes). A 5xx or a network failure keeps it for the retry.
#[tauri::command]
pub async fn session_logout(origin: String) -> Result<Reply, String> {
    let refresh = match load_slot(&KeyringSlot, &origin) {
        Ok(Some(refresh)) => refresh,
        Ok(None) | Err(_) => return Ok(Reply { status: 204, body: Value::Null }),
    };
    let (status, answer) = post(&origin, "/api/v1/auth/logout", &json!({ "refreshToken": refresh }))
        .await
        .map_err(|_| "media_disconnect_failed".to_string())?;
    let (reply, _) = take_refresh(status, answer)?;
    if status < 500 && load_slot(&KeyringSlot, &origin).ok().flatten().as_deref() == Some(refresh.as_str()) {
        clear_slot(&KeyringSlot, &origin)?;
    }
    Ok(reply)
}

#[cfg(test)]
mod tests {
    use super::take_refresh;
    use serde_json::json;

    #[test]
    fn a_session_reaches_the_page_without_its_refresh() {
        let body = json!({ "accessToken": "access", "refreshToken": "refresh-value", "expiresIn": 900, "user": { "id": "u" } });
        let (reply, refresh) = take_refresh(200, body).expect("session");
        assert_eq!(refresh.as_deref(), Some("refresh-value"));
        let text = serde_json::to_string(&reply).expect("json");
        assert!(!text.contains("refresh"));
        assert!(text.contains("access"));
    }

    #[test]
    fn a_success_without_a_usable_refresh_is_refused() {
        assert_eq!(take_refresh(200, json!({ "accessToken": "a" })), Err("invalid_session".to_string()));
        assert_eq!(take_refresh(201, json!({ "accessToken": "a", "refreshToken": "has space" })), Err("invalid_session".to_string()));
    }

    #[test]
    fn errors_and_waits_pass_through_and_never_carry_a_refresh() {
        let (reply, refresh) = take_refresh(401, json!({ "error": "invalid_credentials", "refreshToken": "leak" })).expect("error");
        assert_eq!(refresh, None);
        assert!(!serde_json::to_string(&reply).expect("json").contains("leak"));
        let (waiting, none) = take_refresh(202, json!({ "status": "pending" })).expect("pending");
        assert_eq!(none, None);
        assert_eq!(waiting.status, 202);
    }
}
