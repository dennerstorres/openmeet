mod google;
mod invite;
mod shell;

fn is_app_origin(url: &tauri::Url) -> bool {
    let host = url.host_str().unwrap_or("");
    match url.scheme() {
        "tauri" => host == "localhost",
        "http" => {
            host == "tauri.localhost"
                || ((host == "localhost" || host == "127.0.0.1") && url.port() == Some(1420))
        }
        _ => false,
    }
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
        .on_permission_request(|webview, kind| {
            use tauri::webview::{PermissionKind, PermissionResponse};
            let Ok(url) = webview.url() else {
                return PermissionResponse::Deny;
            };
            if !is_app_origin(&url) {
                return PermissionResponse::Deny;
            }
            match kind {
                PermissionKind::Microphone
                | PermissionKind::Camera
                | PermissionKind::DisplayCapture
                | PermissionKind::Autoplay => PermissionResponse::Allow,
                _ => PermissionResponse::Deny,
            }
        })
        .manage(invite::PendingInvite::default())
        .setup(|app| {
            use tauri_plugin_deep_link::DeepLinkExt;
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
            shell::session_load,
            shell::session_save,
            shell::session_clear,
            shell::shell_status,
            shell::shell_set_consent,
            shell::shell_tracks,
            shell::shell_show,
            invite::invite_take,
            google::open_google_login
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
