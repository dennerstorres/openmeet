use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::Wry;
use tauri::{AppHandle, Emitter, Manager, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutEvent, ShortcutState};
use tauri_plugin_notification::NotificationExt;

const SERVICE: &str = "OpenMeet";

struct Binding {
    id: &'static str,
    accelerator: &'static str,
    label: &'static str,
}

const SHORTCUTS: &[Binding] = &[
    Binding {
        id: "toggle-microphone",
        accelerator: "CommandOrControl+Shift+Alt+M",
        label: "Ctrl+Shift+Alt+M",
    },
    Binding {
        id: "toggle-camera",
        accelerator: "CommandOrControl+Shift+Alt+C",
        label: "Ctrl+Shift+Alt+C",
    },
    Binding {
        id: "toggle-window",
        accelerator: "CommandOrControl+Shift+Alt+O",
        label: "Ctrl+Shift+Alt+O",
    },
];

struct ShellState {
    tray: TrayIcon<Wry>,
    quitting: Arc<AtomicBool>,
    registration: Mutex<()>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShortcutView {
    id: &'static str,
    accelerator: &'static str,
    registered: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShellStatus {
    shortcut_consent: bool,
    shortcuts: Vec<ShortcutView>,
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Preferences {
    shortcut_consent: bool,
}

pub fn shortcut_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| on_shortcut(app, shortcut, event))
        .build()
}

pub fn install(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItem::with_id(app, "show", "Mostrar", true, None::<&str>)?;
    let microphone = MenuItem::with_id(app, "toggle-microphone", track_label("microphone", false, false), true, None::<&str>)?;
    let camera = MenuItem::with_id(app, "toggle-camera", track_label("camera", false, false), true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &microphone, &camera, &quit])?;
    let icon = app.default_window_icon().cloned().ok_or("missing window icon")?;
    let quitting = Arc::new(AtomicBool::new(false));
    let tray = TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip("OpenMeet")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "toggle-microphone" | "toggle-camera" => {
                let _ = app.emit("shell-action", event.id.as_ref());
            }
            "quit" => {
                if let Some(state) = app.try_state::<ShellState>() {
                    state.quitting.store(true, Ordering::Relaxed);
                }
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;
    let window = app.get_webview_window("main").ok_or("missing main window")?;
    let flag = Arc::clone(&quitting);
    let host = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            if flag.load(Ordering::Relaxed) {
                return;
            }
            api.prevent_close();
            let _ = host.hide();
        }
    });
    app.manage(ShellState {
        tray,
        quitting,
        registration: Mutex::new(()),
    });
    apply_shortcuts(app.handle(), read_consent(app.handle()), false)?;
    Ok(())
}

fn on_shortcut<R: tauri::Runtime>(app: &AppHandle<R>, shortcut: &Shortcut, event: ShortcutEvent) {
    if event.state != ShortcutState::Pressed {
        return;
    }
    let Some(action) = action_for(shortcut) else {
        return;
    };
    if action == "toggle-window" {
        show_main(app);
        return;
    }
    let _ = app.emit("shell-action", action);
}

fn action_for(shortcut: &Shortcut) -> Option<&'static str> {
    SHORTCUTS.iter().find_map(|binding| {
        let parsed = binding.accelerator.parse::<Shortcut>().ok()?;
        (parsed == *shortcut).then_some(binding.id)
    })
}

pub(crate) fn show_main<R: tauri::Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

fn apply_shortcuts(app: &AppHandle, consent: bool, announce: bool) -> Result<(), String> {
    let state = app.try_state::<ShellState>().ok_or("tray_unavailable")?;
    let _guard = state.registration.lock().map_err(|_| "tray_unavailable")?;
    write_consent(app, consent)?;
    let _ = app.global_shortcut().unregister_all();
    let mut blocked = Vec::new();
    if consent {
        for binding in SHORTCUTS {
            if app.global_shortcut().is_registered(binding.accelerator) {
                continue;
            }
            if app.global_shortcut().register(binding.accelerator).is_err() {
                blocked.push(binding.label);
            }
        }
    }
    if announce && !blocked.is_empty() {
        notify(app, &format!("Atalho em uso, nÃ£o registrado: {}", blocked.join(", ")));
    }
    Ok(())
}

fn current_status(app: &AppHandle) -> Result<ShellStatus, String> {
    let consent = read_consent(app);
    let shortcuts = SHORTCUTS
        .iter()
        .map(|binding| ShortcutView {
            id: binding.id,
            accelerator: binding.label,
            registered: consent && app.global_shortcut().is_registered(binding.accelerator),
        })
        .collect();
    Ok(ShellStatus {
        shortcut_consent: consent,
        shortcuts,
    })
}

fn preferences_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let directory = app.path().app_data_dir().map_err(|_| "store_failed")?;
    std::fs::create_dir_all(&directory).map_err(|_| "store_failed")?;
    Ok(directory.join("preferences.json"))
}

fn read_consent(app: &AppHandle) -> bool {
    let Ok(path) = preferences_path(app) else {
        return false;
    };
    let Ok(text) = std::fs::read_to_string(path) else {
        return false;
    };
    serde_json::from_str::<Preferences>(&text)
        .map(|preferences| preferences.shortcut_consent)
        .unwrap_or(false)
}

fn write_consent(app: &AppHandle, consent: bool) -> Result<(), String> {
    let path = preferences_path(app)?;
    let body = serde_json::to_vec(&Preferences { shortcut_consent: consent }).map_err(|_| "store_failed")?;
    std::fs::write(path, body).map_err(|_| "store_failed".to_string())
}

fn replace_menu(app: &AppHandle, live: bool, microphone: bool, camera: bool) -> Result<(), String> {
    let show = MenuItem::with_id(app, "show", "Mostrar", true, None::<&str>).map_err(|_| "tray_failed")?;
    let microphone = MenuItem::with_id(app, "toggle-microphone", track_label("microphone", live, microphone), true, None::<&str>).map_err(|_| "tray_failed")?;
    let camera = MenuItem::with_id(app, "toggle-camera", track_label("camera", live, camera), true, None::<&str>).map_err(|_| "tray_failed")?;
    let quit = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>).map_err(|_| "tray_failed")?;
    let menu = Menu::with_items(app, &[&show, &microphone, &camera, &quit]).map_err(|_| "tray_failed")?;
    let state = app.try_state::<ShellState>().ok_or("tray_unavailable")?;
    state.tray.set_menu(Some(menu)).map_err(|_| "tray_failed".to_string())
}

fn window_visible(app: &AppHandle) -> bool {
    app.get_webview_window("main")
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false)
}

fn notify(app: &AppHandle, body: &str) {
    let _ = app.notification().builder().title("OpenMeet").body(body).show();
}

/// S-05: one keyring item for the whole app. It holds the instance origin with its refresh token,
/// so the page can never ask for the token of another instance. Signing in elsewhere replaces it.
const ACTIVE_SLOT: &str = "active";

#[derive(Serialize, Deserialize)]
struct Slot {
    origin: String,
    refresh: String,
}

trait SlotStore {
    fn read(&self) -> Result<Option<String>, String>;
    fn write(&self, value: &str) -> Result<(), String>;
    fn erase(&self) -> Result<(), String>;
}

struct KeyringSlot;

impl KeyringSlot {
    fn entry() -> Result<keyring::Entry, String> {
        keyring::Entry::new(SERVICE, ACTIVE_SLOT).map_err(|_| "store_failed".to_string())
    }
}

impl SlotStore for KeyringSlot {
    fn read(&self) -> Result<Option<String>, String> {
        match Self::entry()?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("store_failed".to_string()),
        }
    }

    fn write(&self, value: &str) -> Result<(), String> {
        Self::entry()?.set_password(value).map_err(|_| "store_failed".to_string())
    }

    fn erase(&self) -> Result<(), String> {
        match Self::entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err("store_failed".to_string()),
        }
    }
}

/// Before S-05 each origin had its own item. They are never read again; saving or clearing an origin removes its old one.
fn drop_legacy_item(origin: &str) {
    if let Ok(entry) = keyring::Entry::new(SERVICE, origin) {
        let _ = entry.delete_credential();
    }
}

fn load_slot(store: &dyn SlotStore, origin: &str) -> Result<Option<String>, String> {
    if !accept_origin(origin) {
        return Err("invalid_origin".to_string());
    }
    let Some(raw) = store.read()? else {
        return Ok(None);
    };
    let slot: Slot = serde_json::from_str(&raw).map_err(|_| "invalid_token".to_string())?;
    // The error names the refusal, never the stored token or origin.
    if slot.origin != origin {
        return Err("invalid_origin".to_string());
    }
    if !accept_token(&slot.refresh) {
        return Err("invalid_token".to_string());
    }
    Ok(Some(slot.refresh))
}

fn save_slot(store: &dyn SlotStore, origin: &str, refresh_token: &str) -> Result<(), String> {
    if !accept_origin(origin) {
        return Err("invalid_origin".to_string());
    }
    if !accept_token(refresh_token) {
        return Err("invalid_token".to_string());
    }
    let slot = Slot { origin: origin.to_string(), refresh: refresh_token.to_string() };
    store.write(&serde_json::to_string(&slot).map_err(|_| "store_failed".to_string())?)
}

fn clear_slot(store: &dyn SlotStore, origin: &str) -> Result<(), String> {
    if !accept_origin(origin) {
        return Err("invalid_origin".to_string());
    }
    let Some(raw) = store.read()? else {
        return Ok(());
    };
    // A slot that does not parse is not anyone's session; it goes. Another origin's slot stays.
    match serde_json::from_str::<Slot>(&raw) {
        Ok(slot) if slot.origin != origin => Ok(()),
        _ => store.erase(),
    }
}

fn accept_origin(origin: &str) -> bool {
    if origin.len() > 256 {
        return false;
    }
    let Ok(url) = tauri::Url::parse(origin) else {
        return false;
    };
    if url.origin().ascii_serialization() != origin {
        return false;
    }
    match url.scheme() {
        "https" => url.host_str().is_some(),
        "http" => matches!(url.host_str(), Some("127.0.0.1") | Some("localhost")),
        _ => false,
    }
}

fn accept_token(token: &str) -> bool {
    (1..=4096).contains(&token.len()) && token.bytes().all(|byte| byte > 32 && byte != 127)
}

fn track_label(kind: &str, live: bool, on: bool) -> &'static str {
    match (kind, live, on) {
        ("microphone", true, true) => "Desligar microfone",
        ("microphone", true, false) => "Ligar microfone",
        ("microphone", false, _) => "Alternar microfone",
        ("camera", true, true) => "Desligar cÃ¢mera",
        ("camera", true, false) => "Ligar cÃ¢mera",
        _ => "Alternar cÃ¢mera",
    }
}

fn track_notice(kind: &str, on: bool) -> Option<&'static str> {
    match (kind, on) {
        ("microphone", true) => Some("Microfone ligado"),
        ("microphone", false) => Some("Microfone desligado"),
        ("camera", true) => Some("CÃ¢mera ligada"),
        ("camera", false) => Some("CÃ¢mera desligada"),
        _ => None,
    }
}

#[tauri::command]
pub fn session_load(origin: String) -> Result<Option<String>, String> {
    load_slot(&KeyringSlot, &origin)
}

#[tauri::command]
pub fn session_save(origin: String, refresh_token: String) -> Result<(), String> {
    save_slot(&KeyringSlot, &origin, &refresh_token)?;
    drop_legacy_item(&origin);
    Ok(())
}

#[tauri::command]
pub fn session_clear(origin: String) -> Result<(), String> {
    clear_slot(&KeyringSlot, &origin)?;
    drop_legacy_item(&origin);
    Ok(())
}

#[tauri::command]
pub fn shell_status(app: AppHandle) -> Result<ShellStatus, String> {
    current_status(&app)
}

#[tauri::command]
pub fn shell_set_consent(app: AppHandle, consent: bool) -> Result<ShellStatus, String> {
    apply_shortcuts(&app, consent, true)?;
    current_status(&app)
}

#[tauri::command]
pub fn shell_show(app: AppHandle) {
    show_main(&app);
}

#[tauri::command]
pub fn shell_tracks(app: AppHandle, live: bool, microphone: bool, camera: bool, announce: Option<String>) -> Result<(), String> {
    replace_menu(&app, live, microphone, camera)?;
    if let Some(kind) = announce {
        let on = match kind.as_str() {
            "microphone" => microphone,
            "camera" => camera,
            _ => return Err("invalid_body".to_string()),
        };
        if !window_visible(&app) {
            if let Some(body) = track_notice(&kind, on) {
                notify(&app, body);
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{accept_origin, accept_token, clear_slot, load_slot, save_slot, track_label, track_notice, SlotStore, SHORTCUTS};
    use std::cell::RefCell;

    #[derive(Default)]
    struct FakeSlot(RefCell<Option<String>>);

    impl SlotStore for FakeSlot {
        fn read(&self) -> Result<Option<String>, String> {
            Ok(self.0.borrow().clone())
        }

        fn write(&self, value: &str) -> Result<(), String> {
            *self.0.borrow_mut() = Some(value.to_string());
            Ok(())
        }

        fn erase(&self) -> Result<(), String> {
            *self.0.borrow_mut() = None;
            Ok(())
        }
    }

    #[test]
    fn the_slot_answers_only_its_own_origin() {
        let store = FakeSlot::default();
        assert_eq!(load_slot(&store, "https://a.example"), Ok(None));
        save_slot(&store, "https://a.example", "refresh-a").expect("save");
        assert_eq!(load_slot(&store, "https://a.example"), Ok(Some("refresh-a".to_string())));
        let refused = load_slot(&store, "https://b.example");
        assert_eq!(refused, Err("invalid_origin".to_string()));
        assert!(!format!("{refused:?}").contains("refresh-a"));
        assert_eq!(load_slot(&store, "https://a.example/path"), Err("invalid_origin".to_string()));

        clear_slot(&store, "https://b.example").expect("clear other");
        assert_eq!(load_slot(&store, "https://a.example"), Ok(Some("refresh-a".to_string())));

        save_slot(&store, "https://b.example", "refresh-b").expect("switch");
        assert_eq!(load_slot(&store, "https://a.example"), Err("invalid_origin".to_string()));
        assert_eq!(load_slot(&store, "https://b.example"), Ok(Some("refresh-b".to_string())));
        assert!(!store.0.borrow().clone().unwrap_or_default().contains("refresh-a"));

        clear_slot(&store, "https://b.example").expect("clear own");
        assert_eq!(load_slot(&store, "https://b.example"), Ok(None));
        assert_eq!(save_slot(&store, "https://b.example", "has space"), Err("invalid_token".to_string()));
        assert_eq!(save_slot(&store, "http://meet.example", "refresh"), Err("invalid_origin".to_string()));
    }

    #[test]
    fn shortcuts_use_three_modifiers_and_parse() {
        for binding in SHORTCUTS {
            assert!(binding.accelerator.parse::<tauri_plugin_global_shortcut::Shortcut>().is_ok());
            assert!(binding.accelerator.contains("Shift"));
            assert!(binding.accelerator.contains("Alt"));
            assert!(!binding.id.is_empty());
        }
    }

    #[test]
    fn consent_starts_closed() {
        let preferences = serde_json::from_str::<super::Preferences>("{}");
        assert!(preferences.is_err());
        let stored = serde_json::from_str::<super::Preferences>(r#"{"shortcutConsent":false}"#).expect("preferences");
        assert!(!stored.shortcut_consent);
    }

    #[test]
    fn origin_matches_the_instance_rule() {
        assert!(accept_origin("https://meet.example"));
        assert!(accept_origin("http://127.0.0.1:3000"));
        assert!(accept_origin("http://localhost:3000"));
        assert!(!accept_origin("http://meet.example"));
        assert!(!accept_origin("https://user:secret@meet.example"));
        assert!(!accept_origin("https://meet.example/room"));
        assert!(!accept_origin("https://meet.example?token=1"));
    }

    #[test]
    fn token_rejects_blank_space_and_huge_values() {
        assert!(accept_token("refresh-token"));
        assert!(!accept_token(""));
        assert!(!accept_token("refresh token"));
        assert!(!accept_token("refresh\ntoken"));
        assert!(!accept_token(&"a".repeat(4097)));
    }

    #[test]
    fn tray_label_says_toggle_until_the_meeting_is_live() {
        assert_eq!(track_label("microphone", false, true), "Alternar microfone");
        assert_eq!(track_label("microphone", true, true), "Desligar microfone");
        assert_eq!(track_label("camera", true, false), "Ligar cÃ¢mera");
        assert_eq!(track_notice("microphone", false), Some("Microfone desligado"));
        assert_eq!(track_notice("screen", true), None);
    }
}
