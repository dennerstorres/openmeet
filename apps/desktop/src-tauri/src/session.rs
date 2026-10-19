//! S-05, S-06 and S-18: both tokens live only in this process. The refresh is in the vault slot; the
//! access token is in memory here. The page gets the user and a marker, and calls the instance through
//! `instance_call`. Instance metadata and the Google start stay in the page: they carry no token.

use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};

use crate::shell::{accept_origin, accept_token, clear_slot, drop_legacy_item, load_slot, save_slot, KeyringSlot};

/// Stands in for the access token in the page, so the page can tell it is signed in. It opens nothing.
const ACCESS_MARKER: &str = "held-by-native";

/// The access token of the signed-in instance. Never serialized, never sent to the page.
#[derive(Default)]
pub struct NativeSession(Mutex<Option<(String, String)>>);

impl NativeSession {
    fn hold(&self, origin: &str, access: String) {
        if let Ok(mut held) = self.0.lock() {
            *held = Some((origin.to_string(), access));
        }
    }

    fn forget(&self) {
        if let Ok(mut held) = self.0.lock() {
            *held = None;
        }
    }

    fn access_for(&self, origin: &str) -> Option<String> {
        self.0.lock().ok()?.as_ref().filter(|(held, _)| held == origin).map(|(_, access)| access.clone())
    }
}

/// Swaps the access token in a session body for the marker. Returns the real one.
fn take_access(reply: &mut Reply) -> Option<String> {
    let object = reply.body.as_object_mut()?;
    let access = object.get("accessToken")?.as_str()?.to_string();
    object.insert("accessToken".to_string(), Value::String(ACCESS_MARKER.to_string()));
    accept_token(&access).then_some(access)
}

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

async fn start(held: &NativeSession, origin: &str, path: &str, body: Value) -> Result<Reply, String> {
    if !accept_origin(origin) {
        return Err("invalid_origin".to_string());
    }
    let (status, answer) = post(origin, path, &body).await?;
    let (mut reply, refresh) = take_refresh(status, answer)?;
    if let Some(refresh) = refresh {
        let access = take_access(&mut reply).ok_or("invalid_session")?;
        save_slot(&KeyringSlot, origin, &refresh)?;
        drop_legacy_item(origin);
        held.hold(origin, access);
    }
    Ok(reply)
}

#[tauri::command]
pub async fn session_login(held: tauri::State<'_, NativeSession>, origin: String, username: String, password: String) -> Result<Reply, String> {
    start(&held, &origin, "/api/v1/auth/login", json!({ "username": username, "password": password })).await
}

#[tauri::command]
pub async fn session_bootstrap(
    held: tauri::State<'_, NativeSession>,
    origin: String,
    token: String,
    username: String,
    password: String,
    display_name: String,
) -> Result<Reply, String> {
    let body = json!({ "token": token, "username": username, "password": password, "displayName": display_name });
    start(&held, &origin, "/api/v1/auth/bootstrap", body).await
}

/// ADR 0010: the Google poll hands over a session once. 202 means still waiting.
#[tauri::command]
pub async fn session_google(held: tauri::State<'_, NativeSession>, origin: String, poll: String) -> Result<Reply, String> {
    start(&held, &origin, "/api/v1/auth/google/poll", json!({ "poll": poll })).await
}

/// Renews from the slot. `None` when the slot holds nothing for this instance.
#[tauri::command]
pub async fn session_refresh(held: tauri::State<'_, NativeSession>, origin: String) -> Result<Option<Reply>, String> {
    let refresh = match load_slot(&KeyringSlot, &origin) {
        Ok(Some(refresh)) => refresh,
        Ok(None) => return Ok(None),
        Err(code) if code == "invalid_origin" => return Ok(None),
        Err(code) => return Err(code),
    };
    let (status, answer) = post(&origin, "/api/v1/auth/refresh", &json!({ "refreshToken": refresh })).await?;
    let (mut reply, renewed) = take_refresh(status, answer)?;
    if let Some(renewed) = renewed {
        let access = take_access(&mut reply).ok_or("invalid_session")?;
        save_slot(&KeyringSlot, &origin, &renewed)?;
        held.hold(&origin, access);
    }
    Ok(Some(reply))
}

/// S-18: logout with the refresh of the slot, never one sent by the page. The slot goes only when the
/// server is done with it (204, or a 4xx that no retry fixes). A 5xx or a network failure keeps it for the retry.
#[tauri::command]
pub async fn session_logout(held: tauri::State<'_, NativeSession>, origin: String) -> Result<Reply, String> {
    // The page is signed out from here on, whatever the server answers.
    held.forget();
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

fn is_id(value: &str) -> bool {
    value.len() == 36
        && value.char_indices().all(|(index, char)| match index {
            8 | 13 | 18 | 23 => char == '-',
            _ => char.is_ascii_hexdigit(),
        })
}

/// S-06: the instance routes the page may call with the session. Auth, admin and password routes are not here.
fn allowed_call(method: &str, path: &str) -> bool {
    let parts: Vec<&str> = path.split('/').collect();
    match (method, parts.as_slice()) {
        ("GET" | "POST", ["", "api", "v1", "rooms"]) => true,
        ("GET" | "POST", ["", "api", "v1", "servers"]) => true,
        ("POST", ["", "api", "v1", "invites", "accept"]) => true,
        ("POST", ["", "api", "v1", "rooms", id, "join"]) => is_id(id),
        ("GET" | "POST", ["", "api", "v1", "servers", id, "rooms"]) => is_id(id),
        ("POST", ["", "api", "v1", "servers", id, "invites"]) => is_id(id),
        ("GET", ["", "api", "v1", "servers", id, "presence"]) => is_id(id),
        _ => false,
    }
}

/// One call to the signed-in instance with the access token held here. The answer passes as it is:
/// a room join gives the page the signal URL and the room JWT, which the media session needs.
#[tauri::command]
pub async fn instance_call(held: tauri::State<'_, NativeSession>, origin: String, method: String, path: String, body: Option<Value>) -> Result<Reply, String> {
    if !allowed_call(&method, &path) {
        return Err("invalid_path".to_string());
    }
    let access = held.access_for(&origin).ok_or("unauthorized")?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|_| "request_failed".to_string())?;
    let url = format!("{origin}{path}");
    let request = if method == "GET" {
        client.get(url)
    } else {
        client
            .post(url)
            .header("content-type", "application/json")
            .body(body.unwrap_or_else(|| json!({})).to_string())
    };
    let response = request
        .header("accept", "application/json")
        .bearer_auth(access)
        .send()
        .await
        .map_err(|_| "request_failed".to_string())?;
    let status = response.status().as_u16();
    let text = response.text().await.unwrap_or_default();
    if status == 401 {
        held.forget();
    }
    Ok(Reply { status, body: serde_json::from_str(&text).unwrap_or(Value::Null) })
}

#[cfg(test)]
mod tests {
    use super::{allowed_call, take_access, take_refresh, NativeSession, Reply, ACCESS_MARKER};
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

    #[test]
    fn the_page_gets_a_marker_instead_of_the_access_token() {
        let body = json!({ "accessToken": "real-access", "refreshToken": "refresh-value", "expiresIn": 900, "user": {} });
        let (mut reply, _) = take_refresh(200, body).expect("session");
        assert_eq!(take_access(&mut reply).as_deref(), Some("real-access"));
        let text = serde_json::to_string(&reply).expect("json");
        assert!(!text.contains("real-access"));
        assert!(text.contains(ACCESS_MARKER));
        let mut empty = Reply { status: 200, body: json!({}) };
        assert_eq!(take_access(&mut empty), None);
    }

    #[test]
    fn the_held_token_answers_only_its_instance() {
        let held = NativeSession::default();
        assert_eq!(held.access_for("https://a.example"), None);
        held.hold("https://a.example", "access-a".to_string());
        assert_eq!(held.access_for("https://a.example").as_deref(), Some("access-a"));
        assert_eq!(held.access_for("https://b.example"), None);
        held.forget();
        assert_eq!(held.access_for("https://a.example"), None);
    }

    #[test]
    fn only_room_and_server_routes_go_through_the_session() {
        let id = "11111111-1111-4111-8111-111111111111";
        for (method, path) in [
            ("GET", "/api/v1/rooms".to_string()),
            ("POST", "/api/v1/rooms".to_string()),
            ("GET", "/api/v1/servers".to_string()),
            ("POST", "/api/v1/servers".to_string()),
            ("POST", "/api/v1/invites/accept".to_string()),
            ("POST", format!("/api/v1/rooms/{id}/join")),
            ("GET", format!("/api/v1/servers/{id}/rooms")),
            ("POST", format!("/api/v1/servers/{id}/invites")),
            ("GET", format!("/api/v1/servers/{id}/presence")),
        ] {
            assert!(allowed_call(method, &path), "{method} {path}");
        }
        for (method, path) in [
            ("POST", "/api/v1/auth/password".to_string()),
            ("GET", "/api/v1/admin/users".to_string()),
            ("POST", format!("/api/v1/admin/users/{id}/disable")),
            ("POST", "/api/v1/auth/logout".to_string()),
            ("GET", "/api/v1/auth/me".to_string()),
            ("DELETE", format!("/api/v1/servers/{id}/members/{id}")),
            ("POST", "/api/v1/rooms/not-an-id/join".to_string()),
            ("POST", format!("/api/v1/rooms/{id}/join?x=1")),
            ("GET", "//evil.example/api/v1/rooms".to_string()),
            ("POST", format!("/api/v1/servers/{id}/presence")),
        ] {
            assert!(!allowed_call(method, &path), "{method} {path}");
        }
    }
}
