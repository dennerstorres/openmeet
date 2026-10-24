//! ADR 0018: the update check and install run here. The page gets these two commands, never the
//! plugin permissions. The plugin itself refuses a package without the pinned signature and a
//! version not above the installed one.

use serde::Serialize;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};

/// Set by `shell_tracks`: a live meeting refuses the install.
#[derive(Default)]
pub struct CallLive(AtomicBool);

impl CallLive {
    pub fn set(&self, live: bool) {
        self.0.store(live, Ordering::SeqCst);
    }

    fn get(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

/// The update found by the last check; install takes this one, never a version the page names.
#[derive(Default)]
pub struct PendingUpdate(Mutex<Option<Update>>);

#[derive(Serialize)]
pub struct UpdateView {
    version: String,
    notes: Option<String>,
}

const NOTES_MAX: usize = 2000;

fn view(version: &str, body: Option<&str>) -> UpdateView {
    let notes = body.map(str::trim).filter(|text| !text.is_empty()).map(|text| text.chars().take(NOTES_MAX).collect());
    UpdateView { version: version.to_string(), notes }
}

fn install_gate(live: bool, pending: bool) -> Result<(), &'static str> {
    if live {
        return Err("update_in_call");
    }
    if !pending {
        return Err("update_missing");
    }
    Ok(())
}

#[tauri::command]
pub async fn update_check(app: AppHandle, pending: State<'_, PendingUpdate>) -> Result<Option<UpdateView>, String> {
    let updater = app.updater().map_err(|_| "update_unavailable")?;
    let found = updater.check().await.map_err(|_| "update_check_failed")?;
    let result = found.as_ref().map(|update| view(&update.version, update.body.as_deref()));
    *pending.0.lock().map_err(|_| "update_unavailable")? = found;
    Ok(result)
}

#[tauri::command]
pub async fn update_install(app: AppHandle, live: State<'_, CallLive>, pending: State<'_, PendingUpdate>) -> Result<(), String> {
    let update = {
        let mut slot = pending.0.lock().map_err(|_| "update_unavailable")?;
        install_gate(live.get(), slot.is_some())?;
        slot.take().ok_or("update_missing")?
    };
    update.download_and_install(|_, _| {}, || {}).await.map_err(|_| "update_install_failed")?;
    // NSIS in passive mode closes the app on Windows; this restart only runs where it does not.
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::{NOTES_MAX, install_gate, view};

    #[test]
    fn a_live_meeting_refuses_the_install() {
        assert_eq!(install_gate(true, true), Err("update_in_call"));
        assert_eq!(install_gate(false, false), Err("update_missing"));
        assert_eq!(install_gate(false, true), Ok(()));
    }

    #[test]
    fn notes_are_trimmed_capped_and_optional() {
        assert_eq!(view("0.3.0", Some("  ")).notes, None);
        assert_eq!(view("0.3.0", None).notes, None);
        assert_eq!(view("0.3.0", Some(" Correções ")).notes.as_deref(), Some("Correções"));
        let long = "a".repeat(NOTES_MAX + 10);
        assert_eq!(view("0.3.0", Some(&long)).notes.map(|text| text.chars().count()), Some(NOTES_MAX));
    }
}
