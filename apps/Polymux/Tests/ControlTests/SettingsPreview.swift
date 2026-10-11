import SwiftUI

@main
struct SettingsPreview: App {
    var body: some Scene {
        WindowGroup("Mac control preview") {
            Form { ControlSettings(server: URL(string: "http://127.0.0.1:7337")) }
                .formStyle(.grouped)
                .frame(width: 480, height: 520)
                .background { InputFocus().frame(width: 0, height: 0).accessibilityHidden(true) }
        }
    }
}
