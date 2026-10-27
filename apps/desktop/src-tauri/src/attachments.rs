//! ADR 0024: files of text room messages through the native session. The page never gets the token: a
//! picture for the preview comes back as bytes, a download is written by this process into the user's
//! Downloads folder and never opened or run from here.

use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;

use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

use crate::session::{is_id, NativeSession};

/// The table's hard stop; the instance's ATTACHMENT_MAX_BYTES is at most this.
const ATTACHMENT_MAX_BYTES: u64 = 25 * 1024 * 1024;
/// Windows paths stop at 260 characters; the Downloads folder takes part of that.
const NAME_MAX_CHARS: usize = 120;

/// PNG, JPEG, GIF or WebP by the first bytes. The API only ever declares these for a picture.
fn picture_kind(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) {
        Some("image/png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

/// A file name Windows accepts and that cannot leave the folder: no separators, no reserved characters
/// or device names, no trailing dot or space. Whatever is left empty becomes "anexo".
fn safe_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|char| if char.is_control() || matches!(char, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || is_bidi(char) { '_' } else { char })
        .collect();
    let mut cleaned = cleaned.trim().trim_end_matches(['.', ' ']).trim_start_matches('.').to_string();
    if cleaned.chars().count() > NAME_MAX_CHARS {
        // Keep the extension, so the system still knows what the file is.
        let (stem, extension) = match cleaned.rsplit_once('.') {
            Some((stem, extension)) if !stem.is_empty() && extension.chars().count() <= 16 => (stem.to_string(), format!(".{extension}")),
            _ => (cleaned.clone(), String::new()),
        };
        let keep = NAME_MAX_CHARS - extension.chars().count();
        cleaned = format!("{}{extension}", stem.chars().take(keep).collect::<String>().trim_end_matches(['.', ' ']));
    }
    let stem = cleaned.split('.').next().unwrap_or_default().to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ((stem.starts_with("COM") || stem.starts_with("LPT")) && stem.len() == 4 && stem.as_bytes()[3].is_ascii_digit());
    if cleaned.is_empty() {
        "anexo".to_string()
    } else if reserved {
        format!("_{cleaned}")
    } else {
        cleaned
    }
}

fn is_bidi(char: char) -> bool {
    matches!(char as u32, 0x202a..=0x202e | 0x2066..=0x2069)
}

/// `name`, then `name (1)`, `name (2)`… The first one free is created, never an existing file replaced.
fn create_unique(folder: &Path, name: &str) -> std::io::Result<(PathBuf, std::fs::File)> {
    let (stem, extension) = match name.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() => (stem, format!(".{extension}")),
        _ => (name, String::new()),
    };
    for attempt in 0..1000 {
        let candidate = if attempt == 0 { name.to_string() } else { format!("{stem} ({attempt}){extension}") };
        let path = folder.join(candidate);
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => return Ok((path, file)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
    Err(std::io::Error::new(std::io::ErrorKind::AlreadyExists, "no free name"))
}

/// Marks the file as downloaded from the internet, as a browser would, so Windows warns before running it.
#[cfg(windows)]
fn mark_downloaded(path: &Path) {
    let mut stream = path.as_os_str().to_owned();
    stream.push(":Zone.Identifier");
    let _ = std::fs::write(PathBuf::from(stream), "[ZoneTransfer]\r\nZoneId=3\r\n");
}

#[cfg(not(windows))]
fn mark_downloaded(_path: &Path) {}

async fn fetch(held: &NativeSession, origin: &str, id: &str) -> Result<(String, Vec<u8>), String> {
    if !is_id(id) {
        return Err("invalid_path".to_string());
    }
    let access = held.access_for(origin).ok_or("unauthorized")?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|_| "request_failed".to_string())?;
    let response = client
        .get(format!("{origin}/api/v1/attachments/{id}"))
        .bearer_auth(access)
        .send()
        .await
        .map_err(|_| "request_failed".to_string())?;
    let status = response.status().as_u16();
    if status == 401 {
        held.forget();
    }
    if status != 200 {
        return Err(if status == 404 { "attachment_not_found" } else { "request_failed" }.to_string());
    }
    let declared = response.headers().get("content-type").and_then(|value| value.to_str().ok()).unwrap_or_default().to_string();
    if response.content_length().is_some_and(|length| length > ATTACHMENT_MAX_BYTES) {
        return Err("invalid_attachment".to_string());
    }
    let bytes = response.bytes().await.map_err(|_| "request_failed".to_string())?;
    if bytes.len() as u64 > ATTACHMENT_MAX_BYTES {
        return Err("invalid_attachment".to_string());
    }
    Ok((declared, bytes.to_vec()))
}

/// The bytes of one sent picture for the preview, refused unless it is declared and actually a picture.
#[tauri::command]
pub async fn instance_attachment(held: tauri::State<'_, NativeSession>, origin: String, id: String) -> Result<tauri::ipc::Response, String> {
    let (declared, bytes) = fetch(&held, &origin, &id).await?;
    if picture_kind(&bytes) != Some(declared.as_str()) {
        return Err("invalid_attachment".to_string());
    }
    Ok(tauri::ipc::Response::new(bytes))
}

/// Saves one sent file into Downloads under a safe, unused name and shows it in Explorer. Returns the name used.
#[tauri::command]
pub async fn instance_attachment_save(app: AppHandle, held: tauri::State<'_, NativeSession>, origin: String, id: String, name: String) -> Result<String, String> {
    let (_, bytes) = fetch(&held, &origin, &id).await?;
    let folder = app.path().download_dir().map_err(|_| "save_failed".to_string())?;
    let (path, mut file) = create_unique(&folder, &safe_name(&name)).map_err(|_| "save_failed".to_string())?;
    if file.write_all(&bytes).and_then(|()| file.sync_all()).is_err() {
        drop(file);
        let _ = std::fs::remove_file(&path);
        return Err("save_failed".to_string());
    }
    drop(file);
    mark_downloaded(&path);
    let _ = app.opener().reveal_item_in_dir(&path);
    Ok(path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::{create_unique, picture_kind, safe_name};

    #[test]
    fn a_saved_name_never_leaves_the_folder_or_names_a_device() {
        assert_eq!(safe_name("foto.png"), "foto.png");
        assert_eq!(safe_name("..\\..\\Windows\\system.ini"), "_.._Windows_system.ini");
        assert_eq!(safe_name("../../etc/passwd"), "_.._etc_passwd");
        assert_eq!(safe_name("a:b*c?.txt"), "a_b_c_.txt");
        assert_eq!(safe_name("evil\u{202e}gnp.exe"), "evil_gnp.exe");
        assert_eq!(safe_name("CON.txt"), "_CON.txt");
        assert_eq!(safe_name("com1"), "_com1");
        assert_eq!(safe_name("nota. . "), "nota");
        assert_eq!(safe_name("..."), "anexo");
        assert_eq!(safe_name(""), "anexo");
        assert_eq!(safe_name(".bashrc"), "bashrc");
        let long = format!("{}.pdf", "a".repeat(300));
        let cut = safe_name(&long);
        assert_eq!(cut.chars().count(), 120);
        assert!(cut.ends_with(".pdf"));
    }

    #[test]
    fn a_second_download_gets_its_own_name() {
        let folder = std::env::temp_dir().join(format!("openmeet-attachments-{}", std::process::id()));
        std::fs::create_dir_all(&folder).expect("folder");
        let (first, _) = create_unique(&folder, "nota.txt").expect("first");
        let (second, _) = create_unique(&folder, "nota.txt").expect("second");
        assert_eq!(first.file_name().and_then(|name| name.to_str()), Some("nota.txt"));
        assert_eq!(second.file_name().and_then(|name| name.to_str()), Some("nota (1).txt"));
        std::fs::remove_dir_all(&folder).expect("cleanup");
    }

    #[test]
    fn only_png_jpeg_gif_and_webp_bytes_pass_as_pictures() {
        assert_eq!(picture_kind(&[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]), Some("image/png"));
        assert_eq!(picture_kind(b"GIF89a\x01\0\x01\0"), Some("image/gif"));
        assert_eq!(picture_kind(b"RIFF\x10\0\0\0WEBPVP8L"), Some("image/webp"));
        assert_eq!(picture_kind(b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>"), None);
        assert_eq!(picture_kind(b"<html><script>"), None);
    }
}
