// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "Luce",
    platforms: [.iOS("27.0"), .macOS("27.0")],
    products: [
        .library(name: "LuceKit", targets: ["LuceKit"]),
        .library(name: "AvatarKit", targets: ["AvatarKit"]),
        .library(name: "LuceControl", targets: ["LuceControl"]),
        .executable(name: "media-text", targets: ["MediaText"])
    ],
    targets: [
        .systemLibrary(name: "CSQLite", path: "packages/CSQLite"),
        .target(name: "LuceKit", dependencies: ["CSQLite"], path: "packages/LuceKit/Sources/LuceKit"),
        .target(name: "AvatarKit", path: "packages/AvatarKit/Sources/AvatarKit", resources: [.copy("Resources/Bloub-LICENSE.txt")]),
        .target(name: "LuceControl", path: "packages/LuceControl/Sources/LuceControl"),
        .testTarget(name: "LuceControlTests", dependencies: ["LuceControl"], path: "packages/LuceControl/Tests/LuceControlTests"),
        .target(name: "LuceAvatar", dependencies: ["LuceKit", "AvatarKit"], path: "apps/Luce/Sources/Avatar",
                exclude: ["AgentAvatar.swift", "AvatarEditor.swift", "AvatarStack.swift", "AvatarView.swift"],
                sources: ["AvatarOptions.swift", "AvatarPalette.swift"]),
        .target(name: "LuceVoice", dependencies: ["LuceKit"], path: "apps/Luce/Sources/Voice",
                exclude: ["SpeechOrb.swift", "VoiceOverlay.swift", "VoiceSettings.swift"],
                sources: ["AppleVoice.swift", "VoiceStore.swift", "VoiceTypes.swift", "LiveSound.swift", "LiveStore.swift",
                          "VoiceConfig.swift", "Spokesperson.swift", "VoiceBridge.swift"]),
        .executableTarget(name: "MediaText", path: "packages/MediaText/Sources/MediaText"),
        .testTarget(name: "LuceKitTests", dependencies: ["LuceKit", "LuceAvatar", "AvatarKit"], path: "packages/LuceKit/Tests/LuceKitTests"),
        .testTarget(name: "LuceVoiceTests", dependencies: ["LuceVoice", "LuceKit"], path: "apps/Luce/Tests/VoiceTests"),
        .testTarget(name: "VoiceCoreTests", dependencies: ["LuceVoice", "LuceKit"], path: "apps/Luce/Tests/VoiceCoreTests"),
        .testTarget(name: "AvatarKitTests", dependencies: ["AvatarKit"], path: "packages/AvatarKit/Tests/AvatarKitTests", resources: [.copy("Fixtures")])
    ]
)
