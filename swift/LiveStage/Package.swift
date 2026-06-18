// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "LiveStage",
    platforms: [
        .iOS("16.2"),
        // Host platform for `swift test`: lets the portable LiveStageModels + its tests
        // build/run on macOS. All ActivityKit/WidgetKit code is guarded with #if canImport(...).
        .macOS(.v13),
    ],
    products: [
        // Shared data contract imported by every Swift side (and mirrored by the backend in M1+).
        .library(name: "LiveStageModels", targets: ["LiveStageModels"]),
        // The public SDK: configure/start/update/end/status/fetchConfiguration/handleDeepLink
        // plus the internal engine (networking, ActivityKit bridge, polling). Imported by the app.
        .library(name: "LiveStage", targets: ["LiveStage"]),
        // Reusable native SwiftUI renderers + the ActivityConfiguration for the Widget Extension.
        .library(name: "LiveStageUI", targets: ["LiveStageUI"]),
    ],
    targets: [
        .target(name: "LiveStageModels"),
        .target(name: "LiveStage", dependencies: ["LiveStageModels"]),
        .target(name: "LiveStageUI", dependencies: ["LiveStageModels"]),
        .testTarget(name: "LiveStageModelsTests", dependencies: ["LiveStageModels"]),
        // Pure-logic SDK tests that run on the macOS host (deep-link, error mapping, sync decision,
        // wire schema). ActivityKit paths are #if os(iOS) and excluded here.
        .testTarget(name: "LiveStageTests", dependencies: ["LiveStage"]),
    ]
)
