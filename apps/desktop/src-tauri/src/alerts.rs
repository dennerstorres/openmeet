// ADR 0024 (F13-13): chat notifications and the unread count on the tray icon. The page decides when a
// message notifies (level, focus, open chat); here it only becomes a Windows toast and a badge.

use serde::Serialize;
use tauri::image::Image;
use tauri::{AppHandle, Emitter};

const TITLE_MAX: usize = 80;
const BODY_MAX: usize = 200;

/// What the page opens when a toast is clicked.
#[derive(Clone, Serialize)]
pub(crate) struct OpenChat {
    kind: &'static str,
    id: String,
}

fn chat_kind(kind: &str) -> Option<&'static str> {
    match kind {
        "room" => Some("room"),
        "dm" => Some("dm"),
        _ => None,
    }
}

fn is_uuid(value: &str) -> bool {
    value.len() == 36
        && value.char_indices().all(|(index, ch)| match index {
            8 | 13 | 18 | 23 => ch == '-',
            _ => ch.is_ascii_hexdigit(),
        })
}

/// One line, control characters out, cut to `max` characters.
pub(crate) fn clip(value: &str, max: usize) -> String {
    let line: String = value.chars().map(|ch| if ch.is_control() { ' ' } else { ch }).collect();
    let trimmed = line.trim();
    if trimmed.chars().count() <= max {
        return trimmed.to_string();
    }
    let mut cut: String = trimmed.chars().take(max.saturating_sub(1)).collect();
    cut.push('…');
    cut
}

#[tauri::command]
pub fn shell_notify(app: AppHandle, title: String, body: String, kind: String, id: String) -> Result<(), String> {
    let kind = chat_kind(&kind).ok_or("invalid_body")?;
    if !is_uuid(&id) {
        return Err("invalid_body".to_string());
    }
    let open = OpenChat { kind, id };
    show_toast(&app, &clip(&title, TITLE_MAX), &clip(&body, BODY_MAX), open);
    Ok(())
}

// On Windows the toast goes straight through WinRT so its click can open the chat; the plugin's own
// toast has no click. The app id follows the plugin: the installed identifier, PowerShell's in a dev build.
#[cfg(windows)]
fn show_toast(app: &AppHandle, title: &str, body: &str, open: OpenChat) {
    use tauri_winrt_notification::Toast;
    let installed = tauri::utils::platform::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.display().to_string()))
        .map(|dir| !(dir.ends_with("\\target\\debug") || dir.ends_with("\\target\\release")))
        .unwrap_or(false);
    let identifier = app.config().identifier.clone();
    let app_id = if installed { identifier.as_str() } else { Toast::POWERSHELL_APP_ID };
    let handle = app.clone();
    let shown = Toast::new(app_id)
        .title(title)
        .text1(body)
        .on_activated(move |_| {
            crate::shell::show_main(&handle);
            let _ = handle.emit("shell-open-chat", open.clone());
            Ok(())
        })
        .show();
    // Without WinRT the toast still shows through the plugin, only without the click.
    if shown.is_err() {
        use tauri_plugin_notification::NotificationExt;
        let _ = app.notification().builder().title(title).body(body).show();
    }
}

#[cfg(not(windows))]
fn show_toast(app: &AppHandle, title: &str, body: &str, _open: OpenChat) {
    use tauri_plugin_notification::NotificationExt;
    let _ = app.notification().builder().title(title).body(body).show();
}

#[tauri::command]
pub fn shell_badge(app: AppHandle, count: u32) -> Result<(), String> {
    let tray = app.tray_by_id("main").ok_or("tray_unavailable")?;
    let base = app.default_window_icon().ok_or("tray_unavailable")?;
    let (width, height) = (base.width(), base.height());
    let mut rgba = base.rgba().to_vec();
    if count > 0 {
        draw_badge(&mut rgba, width, height, count);
    }
    tray.set_icon(Some(Image::new_owned(rgba, width, height))).map_err(|_| "tray_failed")?;
    let tooltip = match count {
        0 => "OpenMeet".to_string(),
        1 => "OpenMeet — 1 não lida".to_string(),
        n => format!("OpenMeet — {} não lidas", badge_text(n)),
    };
    tray.set_tooltip(Some(tooltip)).map_err(|_| "tray_failed".to_string())
}

pub(crate) fn badge_text(count: u32) -> String {
    if count > 9 {
        "9+".to_string()
    } else {
        count.to_string()
    }
}

// 3x5 digits, one row per byte, the three low bits left to right.
const GLYPHS: [(char, [u8; 5]); 11] = [
    ('0', [0b111, 0b101, 0b101, 0b101, 0b111]),
    ('1', [0b010, 0b110, 0b010, 0b010, 0b111]),
    ('2', [0b111, 0b001, 0b111, 0b100, 0b111]),
    ('3', [0b111, 0b001, 0b111, 0b001, 0b111]),
    ('4', [0b101, 0b101, 0b111, 0b001, 0b001]),
    ('5', [0b111, 0b100, 0b111, 0b001, 0b111]),
    ('6', [0b111, 0b100, 0b111, 0b101, 0b111]),
    ('7', [0b111, 0b001, 0b010, 0b010, 0b010]),
    ('8', [0b111, 0b101, 0b111, 0b101, 0b111]),
    ('9', [0b111, 0b101, 0b111, 0b001, 0b111]),
    ('+', [0b000, 0b010, 0b111, 0b010, 0b000]),
];

fn put(rgba: &mut [u8], width: u32, x: u32, y: u32, color: [u8; 4]) {
    let at = ((y * width + x) * 4) as usize;
    if let Some(pixel) = rgba.get_mut(at..at + 4) {
        pixel.copy_from_slice(&color);
    }
}

/// A red disc in the lower right corner with the count in white.
pub(crate) fn draw_badge(rgba: &mut [u8], width: u32, height: u32, count: u32) {
    let side = width.min(height);
    let diameter = (side * 5 / 8).max(6);
    let radius = diameter as f32 / 2.0;
    let (cx, cy) = (width as f32 - radius, height as f32 - radius);
    for y in height.saturating_sub(diameter)..height {
        for x in width.saturating_sub(diameter)..width {
            let (dx, dy) = (x as f32 + 0.5 - cx, y as f32 + 0.5 - cy);
            if dx * dx + dy * dy <= radius * radius {
                put(rgba, width, x, y, [0xe5, 0x48, 0x4d, 0xff]);
            }
        }
    }
    let text = badge_text(count);
    let glyphs: Vec<[u8; 5]> = text.chars().filter_map(|ch| GLYPHS.iter().find(|(c, _)| *c == ch).map(|(_, rows)| *rows)).collect();
    let columns = glyphs.len() as u32 * 4 - 1;
    let scale = ((diameter * 6 / 10) / columns.max(5)).max(1);
    let (text_w, text_h) = (columns * scale, 5 * scale);
    let left = (cx - text_w as f32 / 2.0).round().max(0.0) as u32;
    let top = (cy - text_h as f32 / 2.0).round().max(0.0) as u32;
    for (index, rows) in glyphs.iter().enumerate() {
        for (row, bits) in rows.iter().enumerate() {
            for column in 0..3u32 {
                if bits & (0b100 >> column) == 0 {
                    continue;
                }
                for sy in 0..scale {
                    for sx in 0..scale {
                        let x = left + (index as u32 * 4 + column) * scale + sx;
                        let y = top + row as u32 * scale + sy;
                        if x < width && y < height {
                            put(rgba, width, x, y, [0xff, 0xff, 0xff, 0xff]);
                        }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{badge_text, chat_kind, clip, draw_badge, is_uuid};

    #[test]
    fn badge_text_caps_at_nine_plus() {
        assert_eq!(badge_text(1), "1");
        assert_eq!(badge_text(9), "9");
        assert_eq!(badge_text(10), "9+");
    }

    #[test]
    fn badge_paints_the_corner_and_leaves_the_rest() {
        let (width, height) = (32u32, 32u32);
        let mut rgba = vec![0u8; (width * height * 4) as usize];
        draw_badge(&mut rgba, width, height, 3);
        let pixel = |x: u32, y: u32| rgba[((y * width + x) * 4) as usize..((y * width + x) * 4 + 4) as usize].to_vec();
        assert_eq!(pixel(0, 0), vec![0, 0, 0, 0]);
        assert_eq!(pixel(width - 3, height - 10), vec![0xe5, 0x48, 0x4d, 0xff]);
        assert!(rgba.chunks(4).any(|p| p == [0xff, 0xff, 0xff, 0xff]));
    }

    #[test]
    fn toast_input_is_checked_and_clipped() {
        assert_eq!(chat_kind("room"), Some("room"));
        assert_eq!(chat_kind("server"), None);
        assert!(is_uuid("0f8fad5b-d9cb-469f-a165-70867728950e"));
        assert!(!is_uuid("../../etc"));
        assert_eq!(clip("oi\nbia", 10), "oi bia");
        assert_eq!(clip("abcdef", 4), "abc…");
    }
}
