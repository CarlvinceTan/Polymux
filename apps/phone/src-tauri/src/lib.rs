#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::default().build());
    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_barcode_scanner::init());
    #[cfg(target_os = "ios")]
    let builder = builder.plugin(tauri_plugin_polymux_apple::init());
    builder
        .run(tauri::generate_context!())
        .expect("error while running Polymux Phone");
}
