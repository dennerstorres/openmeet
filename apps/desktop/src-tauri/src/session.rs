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

fn parse_json(bytes: &[u8]) -> Value {
    serde_json::from_slice(bytes).unwrap_or(Value::Null)
}

/// The access token of the signed-in instance. Never serialized, never sent to the page.
#[derive(Default)]
pub struct NativeSession(Mutex<Option<(String, String)>>);

impl NativeSession {
    fn hold(&self, origin: &str, access: String) {
        if let Ok(mut held) = self.0.lock() {
            *held = Some((origin.to_string(), access));
        }
    }

    pub(crate) fn forget(&self) {
        if let Ok(mut held) = self.0.lock() {
            *held = None;
        }
    }

    pub(crate) fn access_for(&self, origin: &str) -> Option<String> {
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
    let bytes = response.bytes().await.unwrap_or_default();
    Ok((status, parse_json(&bytes)))
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

pub(crate) fn is_id(value: &str) -> bool {
    value.len() == 36
        && value.char_indices().all(|(index, char)| match index {
            8 | 13 | 18 | 23 => char == '-',
            _ => char.is_ascii_hexdigit(),
        })
}

fn is_message_id(value: &str) -> bool {
    (1..=18).contains(&value.len()) && !value.starts_with('0') && value.chars().all(|char| char.is_ascii_digit())
}

/// ADR 0024: the only query a call may carry is the message cursor, `?before=` or `?after=` with a message id.
fn split_query(path: &str) -> Option<(&str, bool)> {
    match path.split_once('?') {
        None => Some((path, false)),
        Some((route, query)) => {
            let (key, value) = query.split_once('=')?;
            (matches!(key, "before" | "after" | "around") && is_message_id(value)).then_some((route, true))
        }
    }
}

/// S-06: the instance routes the page may call with the session. Auth, admin and password routes are not here.
fn allowed_call(method: &str, path: &str) -> bool {
    let Some((path, cursor)) = split_query(path) else {
        return false;
    };
    let parts: Vec<&str> = path.split('/').collect();
    if cursor {
        return method == "GET" && matches!(parts.as_slice(), ["", "api", "v1", "rooms", id, "messages"] if is_id(id));
    }
    match (method, parts.as_slice()) {
        ("GET" | "POST", ["", "api", "v1", "rooms"]) => true,
        ("GET" | "POST", ["", "api", "v1", "servers"]) => true,
        ("POST", ["", "api", "v1", "invites", "accept"]) => true,
        ("POST", ["", "api", "v1", "rooms", id, "join"]) => is_id(id),
        // ADR 0023: removing a room or a server.
        ("POST", ["", "api", "v1", "rooms" | "servers", id, "delete"]) => is_id(id),
        ("POST", ["", "api", "v1", "rooms", id, "participants", user_id, "kick"]) => is_id(id) && is_id(user_id),
        ("GET" | "POST", ["", "api", "v1", "servers", id, "rooms"]) => is_id(id),
        ("POST", ["", "api", "v1", "servers", id, "invites"]) => is_id(id),
        ("GET", ["", "api", "v1", "servers", id, "presence"]) => is_id(id),
        ("GET", ["", "api", "v1", "servers", id, "members"]) => is_id(id),
        ("POST", ["", "api", "v1", "servers", id, "presence", "heartbeat" | "mode" | "policy"]) => is_id(id),
        ("POST", ["", "api", "v1", "servers", id, "icon" | "profile"]) => is_id(id),
        ("POST", ["", "api", "v1", "profile", "avatar"]) => true,
        // ADR 0021: server sound libraries and the caller's own sounds. The bytes go through instance_sound.
        ("GET" | "POST", ["", "api", "v1", "servers", id, "sounds"]) => is_id(id),
        ("POST", ["", "api", "v1", "servers", id, "sounds", sound, "import" | "remove"]) => is_id(id) && is_id(sound),
        ("GET", ["", "api", "v1", "sounds", "mine"]) => true,
        ("POST", ["", "api", "v1", "sounds", sound, "rename" | "delete"]) => is_id(sound),
        // ADR 0024: text room messages. The live stream goes through instance_events_open.
        ("GET" | "POST", ["", "api", "v1", "rooms", id, "messages"]) => is_id(id),
        ("GET", ["", "api", "v1", "rooms", id, "pins"]) => is_id(id),
        ("POST", ["", "api", "v1", "rooms", id, "messages", "search"]) => is_id(id),
        ("POST", ["", "api", "v1", "rooms", id, "typing"]) => is_id(id),
        ("POST", ["", "api", "v1", "messages", message, "edit" | "delete" | "pin" | "reactions"]) => is_message_id(message),
        // A file goes up here as base64; it comes back through instance_attachment(_save).
        ("POST", ["", "api", "v1", "rooms", id, "attachments"]) => is_id(id),
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
    // Up to 10 MB of file goes up in one call; everything else answers in seconds.
    let wait = if path.ends_with("/attachments") { 120 } else { 10 };
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(wait))
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
    let bytes = response.bytes().await.unwrap_or_default();
    if status == 401 {
        held.forget();
    }
    Ok(Reply { status, body: parse_json(&bytes) })
}

/// ADR 0019: the same caps the API applies to an upload.
const IMAGE_MAX_BYTES: usize = 256 * 1024;

/// PNG, JPEG or WebP by the first bytes. The page checks the whole header again before showing it.
fn image_kind(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) {
        Some("image/png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

/// The bytes of one icon or avatar, `GET /api/v1/images/:id` and nothing else. The answer must say and be
/// an accepted image type within the size cap; anything else comes back as an error, never as bytes.
#[tauri::command]
pub async fn instance_image(held: tauri::State<'_, NativeSession>, origin: String, id: String) -> Result<tauri::ipc::Response, String> {
    if !is_id(&id) {
        return Err("invalid_path".to_string());
    }
    let access = held.access_for(&origin).ok_or("unauthorized")?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|_| "request_failed".to_string())?;
    let response = client
        .get(format!("{origin}/api/v1/images/{id}"))
        .bearer_auth(access)
        .send()
        .await
        .map_err(|_| "request_failed".to_string())?;
    let status = response.status().as_u16();
    if status == 401 {
        held.forget();
    }
    if status != 200 {
        return Err(if status == 404 { "image_not_found" } else { "request_failed" }.to_string());
    }
    let declared = response
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    if response.content_length().is_some_and(|length| length > IMAGE_MAX_BYTES as u64) {
        return Err("invalid_image".to_string());
    }
    let bytes = response.bytes().await.map_err(|_| "request_failed".to_string())?;
    if bytes.len() > IMAGE_MAX_BYTES || image_kind(&bytes) != Some(declared.as_str()) {
        return Err("invalid_image".to_string());
    }
    Ok(tauri::ipc::Response::new(bytes.to_vec()))
}

/// ADR 0021: the canonical WAV is never larger than 20 s of 24 kHz mono 16-bit plus its header.
const SOUND_MAX_BYTES: usize = 44 + 24_000 * 2 * 20;

/// RIFF/WAVE with PCM, mono, 24 kHz, 16 bits. The page checks the whole header again before playing it.
fn is_sound(bytes: &[u8]) -> bool {
    bytes.len() >= 46
        && bytes.len() <= SOUND_MAX_BYTES
        && &bytes[0..4] == b"RIFF"
        && &bytes[8..16] == b"WAVEfmt "
        && bytes[20..24] == [1, 0, 1, 0]
        && bytes[24..28] == 24_000u32.to_le_bytes()
        && bytes[34..36] == [16, 0]
        && &bytes[36..40] == b"data"
}

/// The bytes of one library sound, `GET /api/v1/sounds/:id` and nothing else, refused unless it is the
/// declared and actual canonical WAV within the size cap.
#[tauri::command]
pub async fn instance_sound(held: tauri::State<'_, NativeSession>, origin: String, id: String) -> Result<tauri::ipc::Response, String> {
    if !is_id(&id) {
        return Err("invalid_path".to_string());
    }
    let access = held.access_for(&origin).ok_or("unauthorized")?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|_| "request_failed".to_string())?;
    let response = client
        .get(format!("{origin}/api/v1/sounds/{id}"))
        .bearer_auth(access)
        .send()
        .await
        .map_err(|_| "request_failed".to_string())?;
    let status = response.status().as_u16();
    if status == 401 {
        held.forget();
    }
    if status != 200 {
        return Err(if status == 404 { "sound_not_found" } else { "request_failed" }.to_string());
    }
    let declared = response.headers().get("content-type").and_then(|value| value.to_str().ok()).unwrap_or_default() == "audio/wav";
    if response.content_length().is_some_and(|length| length > SOUND_MAX_BYTES as u64) {
        return Err("invalid_sound".to_string());
    }
    let bytes = response.bytes().await.map_err(|_| "request_failed".to_string())?;
    if !declared || !is_sound(&bytes) {
        return Err("invalid_sound".to_string());
    }
    Ok(tauri::ipc::Response::new(bytes.to_vec()))
}

#[cfg(test)]
mod tests {
    use super::{allowed_call, image_kind, is_sound, parse_json, take_access, take_refresh, NativeSession, Reply, ACCESS_MARKER};
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
            ("POST", format!("/api/v1/rooms/{id}/participants/{id}/kick")),
            ("GET", format!("/api/v1/servers/{id}/rooms")),
            ("POST", format!("/api/v1/servers/{id}/invites")),
            ("GET", format!("/api/v1/servers/{id}/presence")),
            ("GET", format!("/api/v1/servers/{id}/members")),
            ("POST", format!("/api/v1/servers/{id}/presence/heartbeat")),
            ("POST", format!("/api/v1/servers/{id}/presence/mode")),
            ("POST", format!("/api/v1/servers/{id}/presence/policy")),
            ("POST", format!("/api/v1/servers/{id}/icon")),
            ("POST", format!("/api/v1/servers/{id}/profile")),
            ("POST", "/api/v1/profile/avatar".to_string()),
            ("GET", format!("/api/v1/servers/{id}/sounds")),
            ("POST", format!("/api/v1/servers/{id}/sounds")),
            ("POST", format!("/api/v1/servers/{id}/sounds/{id}/import")),
            ("POST", format!("/api/v1/servers/{id}/sounds/{id}/remove")),
            ("GET", "/api/v1/sounds/mine".to_string()),
            ("POST", format!("/api/v1/sounds/{id}/rename")),
            ("POST", format!("/api/v1/sounds/{id}/delete")),
            ("POST", format!("/api/v1/rooms/{id}/delete")),
            ("POST", format!("/api/v1/servers/{id}/delete")),
            ("GET", format!("/api/v1/rooms/{id}/messages")),
            ("GET", format!("/api/v1/rooms/{id}/messages?before=42")),
            ("GET", format!("/api/v1/rooms/{id}/messages?after=1")),
            ("POST", format!("/api/v1/rooms/{id}/messages")),
            ("GET", format!("/api/v1/rooms/{id}/pins")),
            ("POST", format!("/api/v1/rooms/{id}/messages/search")),
            ("POST", format!("/api/v1/rooms/{id}/typing")),
            ("POST", "/api/v1/messages/42/edit".to_string()),
            ("POST", "/api/v1/messages/42/delete".to_string()),
            ("POST", "/api/v1/messages/42/pin".to_string()),
            ("POST", "/api/v1/messages/42/reactions".to_string()),
            ("GET", format!("/api/v1/rooms/{id}/messages?around=7")),
            ("POST", format!("/api/v1/rooms/{id}/attachments")),
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
            ("POST", format!("/api/v1/rooms/{id}/participants/not-an-id/kick")),
            ("GET", format!("/api/v1/rooms/{id}/participants/{id}/kick")),
            ("POST", format!("/api/v1/rooms/{id}/join?x=1")),
            ("GET", "//evil.example/api/v1/rooms".to_string()),
            ("POST", format!("/api/v1/servers/{id}/presence")),
            ("GET", format!("/api/v1/servers/{id}/icon")),
            ("POST", format!("/api/v1/servers/not-an-id/profile")),
            ("POST", format!("/api/v1/servers/{id}/members/{id}/profile")),
            ("GET", format!("/api/v1/images/{id}")),
            ("POST", "/api/v1/profile".to_string()),
            ("GET", format!("/api/v1/sounds/{id}")),
            ("POST", format!("/api/v1/servers/{id}/sounds/{id}")),
            ("GET", format!("/api/v1/servers/{id}/sounds/{id}/import")),
            ("POST", format!("/api/v1/servers/{id}/sounds/not-an-id/remove")),
            ("POST", "/api/v1/sounds/mine".to_string()),
            ("POST", format!("/api/v1/sounds/{id}/play")),
            ("POST", format!("/api/v1/rooms/{id}/messages?after=1")),
            ("GET", format!("/api/v1/rooms/{id}/messages?after=01")),
            ("GET", format!("/api/v1/rooms/{id}/messages?after=1&before=2")),
            ("GET", format!("/api/v1/rooms/{id}/messages?q=segredo")),
            ("GET", format!("/api/v1/rooms/{id}/pins?after=1")),
            ("POST", "/api/v1/messages/abc/edit".to_string()),
            ("POST", format!("/api/v1/messages/{id}/edit")),
            ("GET", "/api/v1/messages/42/edit".to_string()),
            ("GET", "/api/v1/events".to_string()),
            ("GET", format!("/api/v1/attachments/{id}")),
            ("GET", format!("/api/v1/rooms/{id}/attachments")),
            ("POST", "/api/v1/rooms/not-an-id/attachments".to_string()),
        ] {
            assert!(!allowed_call(method, &path), "{method} {path}");
        }
    }

    #[test]
    fn only_the_canonical_wav_passes_as_a_sound() {
        let mut wav = Vec::new();
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&40u32.to_le_bytes());
        wav.extend_from_slice(b"WAVEfmt ");
        wav.extend_from_slice(&16u32.to_le_bytes());
        wav.extend_from_slice(&[1, 0, 1, 0]);
        wav.extend_from_slice(&24_000u32.to_le_bytes());
        wav.extend_from_slice(&48_000u32.to_le_bytes());
        wav.extend_from_slice(&[2, 0, 16, 0]);
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&2u32.to_le_bytes());
        wav.extend_from_slice(&[0, 0]);
        assert!(is_sound(&wav));
        let mut stereo = wav.clone();
        stereo[22] = 2;
        assert!(!is_sound(&stereo));
        let mut fast = wav.clone();
        fast[24..28].copy_from_slice(&48_000u32.to_le_bytes());
        assert!(!is_sound(&fast));
        assert!(!is_sound(&wav[..44]));
        assert!(!is_sound(b"ID3       not a wav at all, but long enough to look at"));
        let mut huge = wav.clone();
        huge.resize(44 + 24_000 * 2 * 20 + 2, 0);
        assert!(!is_sound(&huge));
    }

    #[test]
    fn only_png_jpeg_and_webp_bytes_pass_as_images() {
        assert_eq!(image_kind(&[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]), Some("image/png"));
        assert_eq!(image_kind(&[0xff, 0xd8, 0xff, 0xe0]), Some("image/jpeg"));
        assert_eq!(image_kind(b"RIFF\x10\0\0\0WEBPVP8L"), Some("image/webp"));
        assert_eq!(image_kind(b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>"), None);
        assert_eq!(image_kind(b"GIF89a"), None);
        assert_eq!(image_kind(b"RIFF"), None);
    }

    #[test]
    fn json_keeps_utf8_display_names() {
        assert_eq!(parse_json(b"{\"displayName\":\"Jo\\u00e3o A\\u00e7\\u00e3o\"}"), json!({ "displayName": "João Ação" }));
        assert_eq!(parse_json("{\"displayName\":\"Gustavo Pavão\"}".as_bytes()), json!({ "displayName": "Gustavo Pavão" }));
    }
}
