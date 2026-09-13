use tauri::{plugin::{Builder, TauriPlugin}, Runtime};
tauri::ios_plugin_binding!(init_plugin_polymux_apple);

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("polymux-apple")
        .setup(|_app, api| {
            api.register_ios_plugin(init_plugin_polymux_apple)?;
            Ok(())
        })
        .build()
}
