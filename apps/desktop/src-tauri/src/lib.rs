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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
