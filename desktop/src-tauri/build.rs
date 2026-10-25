fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "load_workspace",
            "save_workspace",
            "load_secret",
            "save_secret",
            "export_markdown",
            "chat_stream",
            "cancel_chat",
        ]),
    ))
    .expect("prepare Clay Chat build");
}
