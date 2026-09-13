fn main() {
    tauri_plugin::Builder::new(&["signIn", "secureGet", "secureSet", "secureRemove", "updateAutoFill", "disableAutoFill", "registerPush", "oauth"])
        .ios_path("ios")
        .build();
}
