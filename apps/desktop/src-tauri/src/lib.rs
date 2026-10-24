mod google;
mod invite;
mod session;
mod shell;
mod updater;

/// The page shipped inside the installer. No dev port, no https.
fn is_bundle_origin(url: &tauri::Url) -> bool {
    let host = url.host_str().unwrap_or("");
    match url.scheme() {
        "tauri" => host == "localhost",
        "http" => host == "tauri.localhost",
        _ => false,
    }
}

/// The Vite server of `tauri dev`. Only a debug build trusts it (S-07).
fn is_dev_server(url: &tauri::Url, debug: bool) -> bool {
    debug
        && url.scheme() == "http"
        && matches!(url.host_str(), Some("localhost") | Some("127.0.0.1"))
        && url.port() == Some(1420)
}

fn is_app_page(url: &tauri::Url, debug: bool) -> bool {
    is_bundle_origin(url) || is_dev_server(url, debug)
}

/// S-07: camera, microphone and autoplay in one arm, screen capture in another, both only for the app page.
fn media_permission(url: &tauri::Url, kind: &tauri::webview::PermissionKind, debug: bool) -> bool {
    use tauri::webview::PermissionKind;
    if !is_app_page(url, debug) {
        return false;
    }
    match kind {
        PermissionKind::Microphone | PermissionKind::Camera | PermissionKind::Autoplay => true,
        PermissionKind::DisplayCapture => true,
        _ => false,
    }
}

/// S-08: the only window. Navigation leaves the app page never, and no page opens a new window.
fn create_main_window<R: tauri::Runtime, M: tauri::Manager<R>>(manager: &M) -> tauri::Result<tauri::WebviewWindow<R>> {
    let debug = cfg!(debug_assertions);
    tauri::WebviewWindowBuilder::new(manager, "main", tauri::WebviewUrl::default())
        .title("OpenMeet")
        .inner_size(800.0, 600.0)
        .on_navigation(move |url| is_app_page(url, debug))
        .on_new_window(|_url, _features| tauri::webview::NewWindowResponse::Deny)
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // A second launch, including one opened by an openmeet:// link, hands its link to this one.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| shell::show_main(app)))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(shell::shortcut_plugin())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .on_permission_request(|webview, kind| {
            use tauri::webview::PermissionResponse;
            let Ok(url) = webview.url() else {
                return PermissionResponse::Deny;
            };
            if media_permission(&url, &kind, cfg!(debug_assertions)) {
                PermissionResponse::Allow
            } else {
                PermissionResponse::Deny
            }
        })
        .manage(invite::PendingInvite::default())
        .manage(session::NativeSession::default())
        .manage(updater::CallLive::default())
        .manage(updater::PendingUpdate::default())
        .setup(|app| {
            use tauri_plugin_deep_link::DeepLinkExt;
            // `install` looks the window up by its label, so it is created first.
            create_main_window(app)?;
            shell::install(app)?;
            #[cfg(debug_assertions)]
            app.deep_link().register_all()?;
            let handle = app.handle().clone();
            app.deep_link()
                .on_open_url(move |event| invite::deliver(&handle, event.urls().into_iter().map(|url| url.to_string())));
            if let Some(urls) = app.deep_link().get_current()? {
                invite::deliver(app.handle(), urls.into_iter().map(|url| url.to_string()));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            session::session_login,
            session::session_bootstrap,
            session::session_google,
            session::session_refresh,
            session::session_logout,
            session::instance_call,
            shell::shell_status,
            shell::shell_set_consent,
            shell::shell_tracks,
            shell::shell_show,
            invite::invite_take,
            google::open_google_login,
            updater::update_check,
            updater::update_install
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::webview::PermissionKind;

    fn url(value: &str) -> tauri::Url {
        tauri::Url::parse(value).expect("test url")
    }

    #[test]
    fn release_denies_the_dev_port_and_foreign_pages() {
        for page in ["http://127.0.0.1:1420", "http://localhost:1420", "https://meet.example", "https://tauri.localhost"] {
            for kind in [PermissionKind::Microphone, PermissionKind::Camera, PermissionKind::DisplayCapture] {
                assert!(!media_permission(&url(page), &kind, false), "{page}");
            }
            assert!(!is_app_page(&url(page), false), "{page}");
        }
    }

    #[test]
    fn the_bundle_gets_media_and_screen_in_both_profiles() {
        for page in ["http://tauri.localhost", "tauri://localhost"] {
            for debug in [false, true] {
                assert!(media_permission(&url(page), &PermissionKind::Microphone, debug));
                assert!(media_permission(&url(page), &PermissionKind::DisplayCapture, debug));
                assert!(is_app_page(&url(page), debug));
            }
        }
        assert!(!media_permission(&url("http://tauri.localhost"), &PermissionKind::Geolocation, false));
    }

    #[test]
    fn the_dev_server_counts_only_in_a_debug_build() {
        assert!(is_app_page(&url("http://localhost:1420"), true));
        assert!(is_app_page(&url("http://127.0.0.1:1420"), true));
        assert!(!is_app_page(&url("http://localhost:1421"), true));
        assert!(!is_app_page(&url("https://localhost:1420"), true));
        assert!(media_permission(&url("http://localhost:1420"), &PermissionKind::DisplayCapture, true));
        assert!(!is_app_page(&url("https://meet.example"), true));
    }
}
