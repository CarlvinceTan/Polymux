#!/usr/bin/env swift

import AppKit
import CoreGraphics
import Foundation

struct WindowState {
    let id: CGWindowID
    let bounds: CGRect
    let isOnscreen: Bool
    let visibleFraction: Double
    let screenFilling: Bool
}

struct WindowSelection {
    let state: WindowState?
    let candidateCount: Int
}

func argument(after flag: String) -> String? {
    guard let index = CommandLine.arguments.firstIndex(of: flag) else { return nil }
    let valueIndex = CommandLine.arguments.index(after: index)
    guard valueIndex < CommandLine.arguments.endIndex else { return nil }
    return CommandLine.arguments[valueIndex]
}

func displayBounds() -> [CGRect] {
    var count: UInt32 = 0
    guard CGGetActiveDisplayList(0, nil, &count) == .success, count > 0 else { return [] }
    var displays = [CGDirectDisplayID](repeating: 0, count: Int(count))
    guard CGGetActiveDisplayList(count, &displays, &count) == .success else { return [] }
    return displays.prefix(Int(count)).map(CGDisplayBounds)
}

func area(_ rect: CGRect) -> Double {
    max(0, rect.width) * max(0, rect.height)
}

func windowSelection(
    for pid: pid_t,
    displays: [CGRect],
    exactWindowID: CGWindowID? = nil
) -> WindowSelection {
    guard let rawWindows = CGWindowListCopyWindowInfo(
        [.optionAll, .excludeDesktopElements],
        kCGNullWindowID
    ) as? [[String: Any]] else { return WindowSelection(state: nil, candidateCount: 0) }

    let candidates: [(CGWindowID, CGRect, Bool)] = rawWindows.compactMap { window in
        guard let ownerPID = window[kCGWindowOwnerPID as String] as? NSNumber,
              ownerPID.int32Value == pid,
              let windowNumber = window[kCGWindowNumber as String] as? NSNumber,
              let layer = window[kCGWindowLayer as String] as? NSNumber,
              layer.intValue == 0,
              let boundsDictionary = window[kCGWindowBounds as String] as? NSDictionary,
              let bounds = CGRect(dictionaryRepresentation: boundsDictionary),
              bounds.width >= 80,
              bounds.height >= 80
        else { return nil }

        let windowID = CGWindowID(windowNumber.uint32Value)
        if let exactWindowID, windowID != exactWindowID { return nil }
        let isOnscreen = (window[kCGWindowIsOnscreen as String] as? NSNumber)?.boolValue ?? false
        return (windowID, bounds, isOnscreen)
    }

    guard let selected = candidates.sorted(by: {
        if $0.2 != $1.2 { return $0.2 && !$1.2 }
        return area($0.1) > area($1.1)
    }).first else { return WindowSelection(state: nil, candidateCount: 0) }

    let windowArea = area(selected.1)
    guard windowArea > 0 else { return WindowSelection(state: nil, candidateCount: candidates.count) }

    let visibleArea = displays.map { area(selected.1.intersection($0)) }.max() ?? 0
    let visibleFraction = min(1, visibleArea / windowArea)
    let screenFilling = displays.contains { display in
        selected.1.width >= display.width * 0.94
            && selected.1.height >= display.height * 0.94
    }

    return WindowSelection(
        state: WindowState(
            id: selected.0,
            bounds: selected.1,
            isOnscreen: selected.2,
            visibleFraction: visibleFraction,
            screenFilling: screenFilling
        ),
        candidateCount: candidates.count
    )
}

func report(
    status: String,
    frontmost: NSRunningApplication?,
    frontWindow: WindowState?,
    target: NSRunningApplication?,
    targetWindow: WindowState?,
    targetCandidateCount: Int
) {
    print("status=\(status)")
    print("frontmost_name=\(frontmost?.localizedName ?? "unknown")")
    print("frontmost_bundle_id=\(frontmost?.bundleIdentifier ?? "unknown")")
    print("frontmost_screen_filling=\(frontWindow.map { String($0.screenFilling) } ?? "unknown")")
    print("target_name=\(target?.localizedName ?? "unknown")")
    print("target_bundle_id=\(target?.bundleIdentifier ?? "unknown")")
    print("target_running=\(target != nil)")
    print("target_frontmost=\(target?.isActive ?? false)")
    print("target_window_id=\(targetWindow.map { String($0.id) } ?? "unknown")")
    print("target_window_candidates=\(targetCandidateCount)")
    print("target_window_onscreen=\(targetWindow.map { String($0.isOnscreen) } ?? "unknown")")
    print(String(
        format: "target_window_visible_fraction=%.3f",
        targetWindow?.visibleFraction ?? -1
    ))
    print("target_screen_filling=\(targetWindow.map { String($0.screenFilling) } ?? "unknown")")
}

let targetProcess = argument(after: "--target-process")
let targetBundleID = argument(after: "--target-bundle-id")
let targetWindowID = argument(after: "--target-window-id").flatMap(UInt32.init)
let allowFrontmostRequested = CommandLine.arguments.contains("--allow-frontmost-requested")

guard targetProcess != nil || targetBundleID != nil else {
    FileHandle.standardError.write(Data(
        "Usage: check-background-layout.swift --target-process NAME [--target-bundle-id ID] [--target-window-id CG_ID] [--allow-frontmost-requested]\n".utf8
    ))
    exit(64)
}

let workspace = NSWorkspace.shared
let frontmost = workspace.frontmostApplication
let running = workspace.runningApplications.filter { !$0.isTerminated }
let target = running.first { application in
    if let targetBundleID, application.bundleIdentifier == targetBundleID { return true }
    if let targetProcess, application.localizedName == targetProcess { return true }
    if let targetProcess, application.executableURL?.lastPathComponent == targetProcess { return true }
    return false
}
let displays = displayBounds()
let frontSelection = frontmost.map { windowSelection(for: $0.processIdentifier, displays: displays) }
let frontWindow = frontSelection?.state
let targetSelection = target.map {
    windowSelection(for: $0.processIdentifier, displays: displays, exactWindowID: targetWindowID)
}
let targetWindow = targetSelection?.state
let targetCandidateCount = targetSelection?.candidateCount ?? 0

guard !displays.isEmpty, let frontmost, let frontWindow else {
    report(
        status: "blocked_state_unavailable",
        frontmost: frontmost,
        frontWindow: frontWindow,
        target: target,
        targetWindow: targetWindow,
        targetCandidateCount: targetCandidateCount
    )
    exit(8)
}

guard let target else {
    report(
        status: "blocked_target_not_running",
        frontmost: frontmost,
        frontWindow: frontWindow,
        target: nil,
        targetWindow: nil,
        targetCandidateCount: 0
    )
    exit(7)
}

if frontWindow.screenFilling && !target.isActive {
    report(
        status: "blocked_frontmost_expanded",
        frontmost: frontmost,
        frontWindow: frontWindow,
        target: target,
        targetWindow: targetWindow,
        targetCandidateCount: targetCandidateCount
    )
    exit(3)
}

if targetWindowID == nil && targetCandidateCount > 1 {
    report(
        status: "blocked_target_window_ambiguous",
        frontmost: frontmost,
        frontWindow: frontWindow,
        target: target,
        targetWindow: targetWindow,
        targetCandidateCount: targetCandidateCount
    )
    exit(9)
}

guard let targetWindow else {
    report(
        status: "blocked_target_window_unavailable",
        frontmost: frontmost,
        frontWindow: frontWindow,
        target: target,
        targetWindow: nil,
        targetCandidateCount: targetCandidateCount
    )
    exit(6)
}

if targetWindow.screenFilling {
    report(
        status: "blocked_target_expanded",
        frontmost: frontmost,
        frontWindow: frontWindow,
        target: target,
        targetWindow: targetWindow,
        targetCandidateCount: targetCandidateCount
    )
    exit(4)
}

if !targetWindow.isOnscreen || targetWindow.visibleFraction < 0.85 {
    report(
        status: "blocked_target_not_fully_onscreen",
        frontmost: frontmost,
        frontWindow: frontWindow,
        target: target,
        targetWindow: targetWindow,
        targetCandidateCount: targetCandidateCount
    )
    exit(5)
}

let readyStatus: String
if target.isActive {
    if allowFrontmostRequested {
        readyStatus = "ready_frontmost_observation_layout"
    } else {
        report(
            status: "blocked_target_user_active",
            frontmost: frontmost,
            frontWindow: frontWindow,
            target: target,
            targetWindow: targetWindow,
            targetCandidateCount: targetCandidateCount
        )
        exit(2)
    }
} else {
    readyStatus = "ready_background_layout"
}

report(
    status: readyStatus,
    frontmost: frontmost,
    frontWindow: frontWindow,
    target: target,
    targetWindow: targetWindow,
    targetCandidateCount: targetCandidateCount
)
