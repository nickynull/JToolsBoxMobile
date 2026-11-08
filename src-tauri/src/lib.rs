// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("你好，{name}！这条消息来自 Rust。")
}

#[derive(serde::Serialize)]
struct PlatformInfo {
    os: &'static str,
    arch: &'static str,
    family: &'static str,
    tauri: &'static str,
}

#[tauri::command]
fn get_platform() -> PlatformInfo {
    PlatformInfo {
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        family: std::env::consts::FAMILY,
        tauri: tauri::VERSION,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, get_platform])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
