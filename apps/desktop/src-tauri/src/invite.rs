//! ADR 0012: `openmeet://convite` links. The native side keeps only that shape and hands
//! the link to the webview, which parses it again and asks the person before anything is sent.

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, Runtime};

const MAX_LINK: usize = 512;

#[derive(Default)]
pub struct PendingInvite(Mutex<Option<String>>);

pub fn accept_link(raw: &str) -> Option<String> {
    if raw.len() > MAX_LINK || raw.chars().any(char::is_control) {
        return None;
    }
    let url = tauri::Url::parse(raw).ok()?;
    if url.scheme() != "openmeet" || url.host_str() != Some("convite") {
        return None;
    }
    if !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() {
        return None;
    }
    if !matches!(url.path(), "" | "/") || url.query().is_none() {
        return None;
    }
    Some(url.to_string())
}

/// Keeps the newest valid link and tells the webview to take it.
pub fn deliver<R: Runtime>(app: &AppHandle<R>, links: impl IntoIterator<Item = String>) {
    let Some(link) = links.into_iter().filter_map(|raw| accept_link(&raw)).last() else {
        return;
    };
    let Some(state) = app.try_state::<PendingInvite>() else {
        return;
    };
    let Ok(mut slot) = state.0.lock() else {
        return;
    };
    *slot = Some(link);
    drop(slot);
    crate::shell::show_main(app);
    let _ = app.emit("invite-link", ());
}

#[tauri::command]
pub fn invite_take(state: tauri::State<'_, PendingInvite>) -> Option<String> {
    state.0.lock().ok().and_then(|mut slot| slot.take())
}

#[cfg(test)]
mod tests {
    use super::accept_link;

    const CODE: &str = "AAAAAAAAAAAAAAAAAAAAb_-99999999999999999999";

    #[test]
    fn keeps_only_invite_links() {
        let link = format!("openmeet://convite?host=meet.example&code={CODE}");
        assert_eq!(accept_link(&link).as_deref(), Some(link.as_str()));
        for raw in [
            format!("openmeet://sala?host=meet.example&code={CODE}"),
            format!("https://meet.example/convite/{CODE}"),
            format!("openmeet://user@convite?host=meet.example&code={CODE}"),
            format!("openmeet://convite/extra?host=meet.example&code={CODE}"),
            format!("openmeet://convite?host=meet.example&code={CODE}#x"),
            format!("openmeet://convite?host=meet.example\n&code={CODE}"),
            "openmeet://convite".to_string(),
            "x".repeat(600),
        ] {
            assert_eq!(accept_link(&raw), None, "{raw}");
        }
    }
}
