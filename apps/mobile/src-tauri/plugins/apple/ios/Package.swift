// swift-tools-version:5.5
import PackageDescription
let package = Package(
    name: "tauri-plugin-polymux-apple",
    platforms: [.iOS(.v15)],
    products: [.library(name: "tauri-plugin-polymux-apple", type: .static, targets: ["PolymuxApple"])],
    dependencies: [.package(name: "Tauri", path: "../.tauri/tauri-api")],
    targets: [.target(name: "PolymuxApple", dependencies: [.byName(name: "Tauri")], path: "Sources")]
)
