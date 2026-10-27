// ADR 0024: the chat SSE stream of the signed-in instance. The native process opens it with the access token it
// holds and passes each event to the page; the token never crosses. One stream at a time: opening another one
// ends the previous. Reconnecting, with the last id, is the page's call.

use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{Emitter, Manager};

use crate::session::NativeSession;

/// A frame larger than this is not an event the API sends; the stream is dropped instead of growing.
const LINE_MAX_BYTES: usize = 1024 * 1024;
/// The API writes a keepalive every 25 s; silence past this means the connection is gone.
const READ_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ChatEvent {
    pub id: Option<String>,
    pub name: String,
    pub data: String,
}

#[derive(Clone, Serialize)]
struct ChatClosed {
    status: u16,
}

/// Turns the bytes of a `text/event-stream` into events: comments and `retry` are skipped, several `data` lines
/// join with a newline, CRLF is accepted, and a line split between two chunks waits for its end.
#[derive(Default)]
pub struct SseParser {
    pending: Vec<u8>,
    id: Option<String>,
    name: Option<String>,
    data: Vec<String>,
}

impl SseParser {
    pub fn feed(&mut self, chunk: &[u8]) -> Result<Vec<ChatEvent>, &'static str> {
        self.pending.extend_from_slice(chunk);
        let mut events = Vec::new();
        while let Some(end) = self.pending.iter().position(|byte| *byte == b'\n') {
            let mut line: Vec<u8> = self.pending.drain(..=end).collect();
            line.pop();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            let line = String::from_utf8(line).map_err(|_| "invalid_stream")?;
            if let Some(event) = self.line(&line) {
                events.push(event);
            }
        }
        if self.pending.len() > LINE_MAX_BYTES {
            return Err("invalid_stream");
        }
        Ok(events)
    }

    fn line(&mut self, line: &str) -> Option<ChatEvent> {
        if line.is_empty() {
            let name = self.name.take();
            let id = self.id.take();
            let data = std::mem::take(&mut self.data);
            return name.map(|name| ChatEvent { id, name, data: data.join("\n") });
        }
        if line.starts_with(':') {
            return None;
        }
        let (field, value) = line.split_once(':').map_or((line, ""), |(field, value)| (field, value.strip_prefix(' ').unwrap_or(value)));
        match field {
            "id" => self.id = Some(value.to_string()),
            "event" => self.name = Some(value.to_string()),
            "data" => self.data.push(value.to_string()),
            _ => {}
        }
        None
    }
}

/// Only an id the API itself writes goes back as Last-Event-ID: hex epoch, a dash, digits.
fn valid_last_id(value: &str) -> bool {
    match value.split_once('-') {
        Some((epoch, seq)) => {
            (1..=32).contains(&epoch.len())
                && epoch.chars().all(|char| char.is_ascii_hexdigit())
                && (1..=20).contains(&seq.len())
                && seq.chars().all(|char| char.is_ascii_digit())
        }
        None => false,
    }
}

#[derive(Default)]
pub struct ChatStream(Mutex<Option<tauri::async_runtime::JoinHandle<()>>>);

impl ChatStream {
    fn replace(&self, next: Option<tauri::async_runtime::JoinHandle<()>>) {
        if let Ok(mut held) = self.0.lock() {
            if let Some(previous) = held.take() {
                previous.abort();
            }
            *held = next;
        }
    }
}

/// Opens the stream. Events reach the page as `chat-event`; the end, with the HTTP status (0 for a network
/// failure), as `chat-closed`. A 401 also drops the held token, as instance_call does.
#[tauri::command]
pub async fn instance_events_open(
    app: tauri::AppHandle,
    held: tauri::State<'_, NativeSession>,
    stream: tauri::State<'_, ChatStream>,
    origin: String,
    last_event_id: Option<String>,
) -> Result<(), String> {
    if last_event_id.as_deref().is_some_and(|id| !valid_last_id(id)) {
        return Err("invalid_body".to_string());
    }
    let access = held.access_for(&origin).ok_or("unauthorized")?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .read_timeout(READ_TIMEOUT)
        .build()
        .map_err(|_| "request_failed".to_string())?;
    let mut request = client
        .get(format!("{origin}/api/v1/events"))
        .header("accept", "text/event-stream")
        .bearer_auth(access);
    if let Some(id) = last_event_id {
        request = request.header("last-event-id", id);
    }
    let task = tauri::async_runtime::spawn(async move {
        let status = run(&app, request).await;
        if status == 401 {
            app.state::<NativeSession>().forget();
        }
        let _ = app.emit_to("main", "chat-closed", ChatClosed { status });
    });
    stream.replace(Some(task));
    Ok(())
}

async fn run(app: &tauri::AppHandle, request: reqwest::RequestBuilder) -> u16 {
    let Ok(mut response) = request.send().await else {
        return 0;
    };
    let status = response.status().as_u16();
    let event_stream = response
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.starts_with("text/event-stream"));
    if status != 200 || !event_stream {
        return if status == 200 { 0 } else { status };
    }
    let mut parser = SseParser::default();
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) => match parser.feed(&chunk) {
                Ok(events) => {
                    for event in events {
                        let _ = app.emit_to("main", "chat-event", event);
                    }
                }
                Err(_) => return 0,
            },
            Ok(None) | Err(_) => return 0,
        }
    }
}

#[tauri::command]
pub fn instance_events_close(stream: tauri::State<'_, ChatStream>) {
    stream.replace(None);
}

#[cfg(test)]
mod tests {
    use super::{valid_last_id, ChatEvent, SseParser};

    fn event(id: Option<&str>, name: &str, data: &str) -> ChatEvent {
        ChatEvent { id: id.map(str::to_string), name: name.to_string(), data: data.to_string() }
    }

    #[test]
    fn frames_split_across_chunks_come_out_whole() {
        let mut parser = SseParser::default();
        assert_eq!(parser.feed(b"retry: 3000\n\nid: ab-1\nevent: message.cre").unwrap(), vec![]);
        assert_eq!(
            parser.feed(b"ated\ndata: {\"body\":\"ol\xc3").unwrap(),
            vec![]
        );
        assert_eq!(
            parser.feed(b"\xa1\"}\n\n: keepalive\n\nevent: typing\r\ndata: {}\r\n\r\n").unwrap(),
            vec![event(Some("ab-1"), "message.created", "{\"body\":\"olá\"}"), event(None, "typing", "{}")]
        );
    }

    #[test]
    fn data_lines_join_and_nameless_blocks_are_dropped() {
        let mut parser = SseParser::default();
        assert_eq!(
            parser.feed(b"data: sem nome\n\nevent: ready\ndata: a\ndata: b\n\n").unwrap(),
            vec![event(None, "ready", "a\nb")]
        );
    }

    #[test]
    fn a_runaway_line_or_broken_utf8_ends_the_stream() {
        let mut parser = SseParser::default();
        assert!(parser.feed(&vec![b'a'; 1024 * 1024 + 1]).is_err());
        let mut parser = SseParser::default();
        assert!(parser.feed(b"data: \xff\n").is_err());
    }

    #[test]
    fn only_api_shaped_ids_go_back_as_last_event_id() {
        assert!(valid_last_id("a1b2c3d4e5f6-42"));
        assert!(!valid_last_id("a1b2-"));
        assert!(!valid_last_id("zz-1"));
        assert!(!valid_last_id("ab-1\r\nx-evil: 1"));
        assert!(!valid_last_id("42"));
    }
}
