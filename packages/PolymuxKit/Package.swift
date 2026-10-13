// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "PolymuxKit",
    products: [
        .library(name: "PolymuxKit", targets: ["PolymuxKit"]),
    ],
    targets: [
        .systemLibrary(name: "CSQLite", path: "CSQLite"),
        .target(
            name: "PolymuxKit",
            dependencies: ["CSQLite"],
            path: "Sources/PolymuxKit",
            // Voice clients take URLSession from Foundation. Linux's copy lives in
            // FoundationNetworking, and these tests never open a live session.
            exclude: ["LiveAudio.swift", "TextAgent.swift", "GeminiLive.swift"]
        ),
        .testTarget(
            name: "PolymuxKitTests",
            dependencies: ["PolymuxKit"],
            path: "Tests/PolymuxKitTests",
            exclude: [
                "ActivityTests.swift", "CacheTests.swift", "DeletionTests.swift", "GeminiTests.swift",
                "GroupTests.swift", "HTMLTests.swift", "LiveTests.swift", "MigrationTests.swift",
                "OrderTests.swift", "ReplyTests.swift", "RoutineTests.swift", "SSETests.swift",
                "TextAgentTests.swift", "TransportTests.swift",
            ],
            sources: ["ChatStoreCacheTests.swift", "ChatStoreDeltaTests.swift"]
        ),
    ]
)
