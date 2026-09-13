import AppKit
import CoreGraphics

// The pasteboard carries the application URL, not an image of its logo.
final class ApplicationDragView: NSImageView, NSDraggingSource {
    let applicationURL: URL
    init(applicationURL: URL) {
        self.applicationURL = applicationURL
        super.init(frame: NSRect(x: 0, y: 0, width: 64, height: 64))
        image = NSWorkspace.shared.icon(forFile: applicationURL.path)
        imageScaling = .scaleProportionallyUpOrDown
        toolTip = "Drag Polymux into the application list in System Settings"
        setAccessibilityLabel("Polymux application. Drag into Screen Recording in System Settings.")
    }
    required init?(coder: NSCoder) { nil }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func resetCursorRects() { addCursorRect(bounds, cursor: .openHand) }
    override func mouseDown(with event: NSEvent) {
        let item = NSDraggingItem(pasteboardWriter: applicationURL as NSURL)
        item.setDraggingFrame(bounds, contents: image)
        beginDraggingSession(with: [item], event: event, source: self)
    }
    func draggingSession(_ session: NSDraggingSession, sourceOperationMaskFor context: NSDraggingContext) -> NSDragOperation { .copy }
}

final class PermissionPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

final class Guide: NSObject, NSApplicationDelegate, NSWindowDelegate {
    let applicationURL: URL
    let parentPID: pid_t
    var panel: PermissionPanel!
    var timer: Timer?
    var settingsWindowID: Int?
    var settingsPID: pid_t?
    var hadSettingsWindow = false
    let started = Date()

    init(applicationURL: URL, parentPID: pid_t) {
        self.applicationURL = applicationURL
        self.parentPID = parentPID
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        panel = PermissionPanel(contentRect: NSRect(x: 0, y: 0, width: 448, height: 112),
            styleMask: [.titled, .fullSizeContentView, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.title = "Polymux Screen Recording"
        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.isMovableByWindowBackground = false
        panel.collectionBehavior = [.moveToActiveSpace, .fullScreenAuxiliary]
        panel.delegate = self
        panel.backgroundColor = .windowBackgroundColor

        let content = NSView()
        panel.contentView = content
        let logo = ApplicationDragView(applicationURL: applicationURL)
        let heading = NSTextField(labelWithString: "Drag Polymux into Screen Recording")
        heading.font = .systemFont(ofSize: 13, weight: .semibold)
        let detail = NSTextField(wrappingLabelWithString: "Drop it in the app list, then turn it on.")
        detail.font = .systemFont(ofSize: 12)
        detail.textColor = .secondaryLabelColor
        let fallback = NSButton(title: "Show in Finder", target: self, action: #selector(revealApplication))
        fallback.isBordered = false
        fallback.font = .systemFont(ofSize: 11)
        fallback.contentTintColor = .linkColor
        fallback.alignment = .left
        let copy = NSStackView(views: [heading, detail, fallback])
        copy.orientation = .vertical
        copy.alignment = .leading
        copy.spacing = 4
        let close = NSButton(image: NSImage(systemSymbolName: "xmark", accessibilityDescription: "Close permission helper")!, target: self, action: #selector(dismiss))
        close.keyEquivalent = "\u{1b}"
        close.isBordered = false
        close.contentTintColor = .secondaryLabelColor
        for view in [logo, copy, close] {
            view.translatesAutoresizingMaskIntoConstraints = false
            content.addSubview(view)
        }
        NSLayoutConstraint.activate([
            logo.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 18),
            logo.centerYAnchor.constraint(equalTo: content.centerYAnchor),
            logo.widthAnchor.constraint(equalToConstant: 64), logo.heightAnchor.constraint(equalToConstant: 64),
            copy.leadingAnchor.constraint(equalTo: logo.trailingAnchor, constant: 12),
            copy.centerYAnchor.constraint(equalTo: content.centerYAnchor),
            copy.trailingAnchor.constraint(lessThanOrEqualTo: close.leadingAnchor, constant: -10),
            close.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -10),
            close.topAnchor.constraint(equalTo: content.topAnchor, constant: 10),
            close.widthAnchor.constraint(equalToConstant: 22), close.heightAnchor.constraint(equalToConstant: 22),
        ])
        followSettings()
        timer = Timer.scheduledTimer(withTimeInterval: 0.3, repeats: true) { [weak self] _ in self?.followSettings() }
        print("ready")
        fflush(stdout)
    }

    @objc func dismiss() { NSApp.terminate(nil) }
    @objc func revealApplication() { NSWorkspace.shared.activateFileViewerSelecting([applicationURL]) }
    func windowWillClose(_ notification: Notification) { dismiss() }

    func followSettings() {
        guard kill(parentPID, 0) == 0 else { dismiss(); return }
        guard let settings = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.systempreferences").first,
              let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
            panel.orderOut(nil)
            if hadSettingsWindow || Date().timeIntervalSince(started) > 20 { dismiss() }
            return
        }
        if let settingsPID, settingsPID != settings.processIdentifier { dismiss(); return }
        settingsPID = settings.processIdentifier
        let candidates = windows.filter {
            ($0[kCGWindowOwnerPID as String] as? Int) == Int(settings.processIdentifier) &&
            ($0[kCGWindowLayer as String] as? Int) == 0
        }
        // Once attached, keep that exact window. Other Settings dialogs do not
        // become a new anchor merely because they are on top.
        let entry = candidates.first {
            if let settingsWindowID { return ($0[kCGWindowNumber as String] as? Int) == settingsWindowID }
            guard let rect = $0[kCGWindowBounds as String] as? [String: CGFloat] else { return false }
            return (rect["Width"] ?? 0) >= 500 && (rect["Height"] ?? 0) >= 350
        }
        guard let entry, let bounds = entry[kCGWindowBounds as String] as? [String: Any],
              let cgFrame = CGRect(dictionaryRepresentation: bounds as CFDictionary), let primary = NSScreen.screens.first else {
            panel.orderOut(nil)
            if let settingsWindowID,
               let allWindows = CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as? [[String: Any]],
               !allWindows.contains(where: { ($0[kCGWindowNumber as String] as? Int) == settingsWindowID }) { dismiss() }
            if Date().timeIntervalSince(started) > 20 && !hadSettingsWindow { dismiss() }
            return
        }
        hadSettingsWindow = true
        settingsWindowID = entry[kCGWindowNumber as String] as? Int
        // Quartz's origin is at the top of the main display; AppKit's is at its bottom.
        let frame = NSRect(x: cgFrame.minX, y: primary.frame.maxY - cgFrame.maxY, width: cgFrame.width, height: cgFrame.height)
        let display = NSScreen.screens.max { a, b in
            let ar = a.frame.intersection(frame), br = b.frame.intersection(frame)
            return (ar.isNull ? 0 : ar.width * ar.height) < (br.isNull ? 0 : br.width * br.height)
        } ?? primary
        let work = display.visibleFrame
        let size = panel.frame.size
        var origin = NSPoint(x: frame.midX - size.width / 2, y: frame.minY - size.height - 8)
        // Prefer below. If the Settings window fills the display vertically,
        // put the helper above when possible and otherwise keep it reachable.
        if origin.y < work.minY {
            if frame.maxY + size.height + 8 <= work.maxY { origin.y = frame.maxY + 8 }
            else if frame.maxX + size.width + 8 <= work.maxX { origin = NSPoint(x: frame.maxX + 8, y: frame.minY) }
            else if frame.minX - size.width - 8 >= work.minX { origin = NSPoint(x: frame.minX - size.width - 8, y: frame.minY) }
        }
        origin.x = max(work.minX + 8, min(origin.x, work.maxX - size.width - 8))
        origin.y = max(work.minY + 8, min(origin.y, work.maxY - size.height - 8))
        if panel.frame.origin != origin { panel.setFrameOrigin(origin) }
        // Stay out of other work when the user leaves Settings. The non-key
        // panel still receives the logo's first mouse-down for native dragging.
        if NSWorkspace.shared.frontmostApplication?.processIdentifier == settings.processIdentifier {
            if !panel.isVisible { panel.orderFrontRegardless() }
        } else { panel.orderOut(nil) }
    }
}

guard CommandLine.arguments.count == 3,
      let parentPID = Int32(CommandLine.arguments[2]), parentPID > 1 else { exit(1) }
let applicationURL = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
guard applicationURL.pathExtension == "app", FileManager.default.fileExists(atPath: applicationURL.path) else { exit(1) }
let application = NSApplication.shared
application.setActivationPolicy(.accessory)
let delegate = Guide(applicationURL: applicationURL, parentPID: parentPID)
application.delegate = delegate
application.run()
