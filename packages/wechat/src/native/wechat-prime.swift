// Reconnect WeChat's background-send signal chain without activating WeChat.
//
// WeChat 4 rebuilds its chat InputView after a restart, page change, or a long
// idle. The local daemon cannot emit through that Qt signal chain until one
// chat row has been selected. This helper performs exactly that semantic
// accessibility action while another application remains frontmost.

import AppKit
import ApplicationServices
import CoreGraphics
import Darwin
import Foundation
import ScreenCaptureKit
import Vision

// Receipt for each actual AX dispatch. Missing output after a helper crash is
// still uncertain; a returned precondition failure need not look like a send.
var mutationResults: [[String: Any]] = []
var loginSubmissionAttempted = false

func backgroundMutationAllowed(_ application: AXUIElement) -> Bool {
    var pid: pid_t = 0
    return !macSessionIsLocked() && AXUIElementGetPid(application, &pid) == .success &&
        requestedProcessBirthMatches(pid) && verifiedBackgroundGuard(pid)
}

// Recheck at the actual dispatch boundary, including QR refresh and chat
// selection after a slow AX traversal. No mutation can bypass this gate.
func performGuardedAXAction(_ element: AXUIElement, _ action: CFString) -> AXError {
    guard backgroundMutationAllowed(element) else { return .cannotComplete }
    let result = AXUIElementPerformAction(element, action)
    mutationResults.append(["action": action as String, "result": result.rawValue])
    return result
}

func setGuardedAXAttribute(_ element: AXUIElement, _ name: CFString, _ value: CFTypeRef) -> AXError {
    guard backgroundMutationAllowed(element) else { return .cannotComplete }
    let result = AXUIElementSetAttributeValue(element, name, value)
    mutationResults.append(["attribute": name as String, "result": result.rawValue])
    return result
}

func acquireLoginLock(_ pid: pid_t) -> Int32? {
    let path = NSTemporaryDirectory() + "polymux-wechat-login-\(getuid())-\(pid).lock"
    let descriptor = open(path, O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, S_IRUSR | S_IWUSR)
    guard descriptor >= 0 else { return nil }
    var info = stat()
    guard fstat(descriptor, &info) == 0, info.st_uid == getuid(), info.st_nlink == 1,
          (info.st_mode & S_IFMT) == S_IFREG, flock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
        close(descriptor); return nil
    }
    return descriptor
}

// Login images are ephemeral. Only a verified login window is captured; the
// full window and decoded QR payload never leave this helper or touch disk.
func loginWindow(_ application: AXUIElement) -> AXUIElement? {
    guard let windows = attribute(application, kAXWindowsAttribute as CFString) as? [AXUIElement]
    else { return nil }
    let matches = windows.filter { window in
        let ids = descendants(window).map { stringAttribute($0, kAXIdentifierAttribute as CFString) }
        return !ids.contains("session_list") && ids.contains(where: {
            $0.hasPrefix("login_") || $0 == "current_login_nick_name"
        })
    }
    return matches.count == 1 ? matches[0] : nil
}

func loginCheckboxValue(_ element: AXUIElement) -> Int? {
    guard let value = attribute(element, kAXValueAttribute as CFString) else { return nil }
    if let number = value as? NSNumber, [0, 1].contains(number.intValue) { return number.intValue }
    if let text = value as? String, ["0", "1"].contains(text) { return Int(text) }
    return nil
}

/** Enable actual checkboxes on this login window, never generic buttons or
 * controls from a chat/settings window. A checked box is never pressed. */
func enableLoginCheckboxes(_ application: AXUIElement) -> Bool {
    guard backgroundMutationAllowed(application) else { return false }
    guard let window = loginWindow(application) else { return false }
    let boxes = descendants(window).filter {
        stringAttribute($0, kAXRoleAttribute as CFString) == kAXCheckBoxRole
    }
    for box in boxes {
        guard backgroundMutationAllowed(application) else { return false }
        guard let currentWindow = loginWindow(application), CFEqual(window, currentWindow),
              let value = loginCheckboxValue(box) else { return false }
        if value == 1 { continue }
        guard (attribute(box, kAXEnabledAttribute as CFString) as? Bool) == true else { return false }
        var writable = DarwinBoolean(false)
        let canSet = AXUIElementIsAttributeSettable(box, kAXValueAttribute as CFString, &writable)
        if canSet == .success && writable.boolValue {
            guard setGuardedAXAttribute(box, kAXValueAttribute as CFString, NSNumber(value: 1)) == .success
            else { return false }
        } else {
            guard actionNames(box).contains(kAXPressAction), loginCheckboxValue(box) == 0,
                  performGuardedAXAction(box, kAXPressAction as CFString) == .success else { return false }
        }
        Thread.sleep(forTimeInterval: 0.05)
        guard loginCheckboxValue(box) == 1 else { return false }
    }
    return true
}

func loginFrame(_ window: AXUIElement) -> CGRect? {
    guard let p = attribute(window, kAXPositionAttribute as CFString),
          let s = attribute(window, kAXSizeAttribute as CFString),
          CFGetTypeID(p) == AXValueGetTypeID(), CFGetTypeID(s) == AXValueGetTypeID() else { return nil }
    var point = CGPoint.zero
    var size = CGSize.zero
    guard AXValueGetValue(unsafeBitCast(p, to: AXValue.self), .cgPoint, &point),
          AXValueGetValue(unsafeBitCast(s, to: AXValue.self), .cgSize, &size),
          size.width > 0, size.height > 0 else { return nil }
    return CGRect(origin: point, size: size)
}

func croppedLoginQR(_ image: CGImage) -> String? {
    let request = VNDetectBarcodesRequest()
    request.symbologies = [.qr]
    guard (try? VNImageRequestHandler(cgImage: image).perform([request])) != nil,
          let codes = request.results, codes.count == 1, let code = codes.first,
          code.payloadStringValue?.isEmpty == false else { return nil }
    let b = code.boundingBox
    let rect = CGRect(x: b.minX * Double(image.width), y: (1 - b.maxY) * Double(image.height),
                      width: b.width * Double(image.width), height: b.height * Double(image.height))
    let margin = max(rect.width, rect.height) * 0.12
    let crop = rect.insetBy(dx: -margin, dy: -margin).integral.intersection(
        CGRect(x: 0, y: 0, width: image.width, height: image.height))
    guard let cropped = image.cropping(to: crop),
          let png = NSBitmapImageRep(cgImage: cropped).representation(using: .png, properties: [:]),
          png.count < 256_000 else { return nil }
    return "data:image/png;base64," + png.base64EncodedString()
}

func loginQRExpired(_ application: AXUIElement) -> Bool {
    guard let window = loginWindow(application) else { return true }
    let phrases = ["qr code expired", "qr code has expired", "二维码已失效", "二维码已过期", "二維碼已過期"]
    return descendants(window).contains { control in
        let text = (stringAttribute(control, kAXTitleAttribute as CFString) + " " +
                    stringAttribute(control, kAXValueAttribute as CFString)).lowercased()
        return phrases.contains(where: text.contains)
    }
}

func refreshExpiredLoginQR(_ application: AXUIElement) {
    guard backgroundMutationAllowed(application) else { return }
    guard loginQRExpired(application), let window = loginWindow(application) else { return }
    let titles = ["refresh", "refresh qr code", "刷新", "刷新二维码", "重新获取二维码"]
    let controls = descendants(window).filter {
        [kAXButtonRole, "AXLink"].contains(stringAttribute($0, kAXRoleAttribute as CFString)) &&
        titles.contains(stringAttribute($0, kAXTitleAttribute as CFString).lowercased()) &&
        actionNames($0).contains(kAXPressAction)
    }
    guard controls.count == 1, loginQRExpired(application) else { return }
    _ = performGuardedAXAction(controls[0], kAXPressAction as CFString)
}

@available(macOS 14.0, *)
func captureLoginQR(_ running: NSRunningApplication, _ application: AXUIElement) async -> String? {
    guard CGPreflightScreenCaptureAccess(), let login = loginWindow(application), let frame = loginFrame(login),
          let content = try? await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: false)
    else { return nil }
    let windows = content.windows.filter {
        $0.owningApplication?.processID == running.processIdentifier && $0.windowLayer == 0 &&
        abs($0.frame.minX - frame.minX) < 2 && abs($0.frame.minY - frame.minY) < 2 &&
        abs($0.frame.width - frame.width) < 2 && abs($0.frame.height - frame.height) < 2
    }
    guard windows.count == 1, let window = windows.first else { return nil }
    let configuration = SCStreamConfiguration()
    configuration.width = Int(frame.width * 2)
    configuration.height = Int(frame.height * 2)
    configuration.showsCursor = false
    guard let image = try? await SCScreenshotManager.captureImage(
        contentFilter: SCContentFilter(desktopIndependentWindow: window), configuration: configuration),
          !running.isTerminated, sessionState(application) == "interactive_login",
          let current = loginWindow(application), CFEqual(current, login), !loginQRExpired(application) else { return nil }
    return croppedLoginQR(image)
}

func emit(_ payload: [String: Any]) -> Never {
    var result = payload
    result["mutationResults"] = mutationResults
    result["loginSubmissionAttempted"] = loginSubmissionAttempted
    let data = try? JSONSerialization.data(withJSONObject: result)
    print(data.flatMap { String(data: $0, encoding: .utf8) } ?? "{\"ok\":false}")
    exit(0)
}

func attribute(_ element: AXUIElement, _ name: CFString) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name, &value) == .success ? value : nil
}

func stringAttribute(_ element: AXUIElement, _ name: CFString) -> String {
    attribute(element, name) as? String ?? ""
}

func children(_ element: AXUIElement) -> [AXUIElement] {
    attribute(element, kAXChildrenAttribute as CFString) as? [AXUIElement] ?? []
}

func attributeNames(_ element: AXUIElement) -> [String] {
    var names: CFArray?
    guard AXUIElementCopyAttributeNames(element, &names) == .success else {
        return []
    }
    return names as? [String] ?? []
}

func actionNames(_ element: AXUIElement) -> [String] {
    var names: CFArray?
    guard AXUIElementCopyActionNames(element, &names) == .success else {
        return []
    }
    return names as? [String] ?? []
}

func descendants(_ element: AXUIElement, depth: Int = 0) -> [AXUIElement] {
    if depth > 20 { return [] }
    return children(element).flatMap { [$0] + descendants($0, depth: depth + 1) }
}

/** Selects a chat semantically through Accessibility. AXPress opens a detached
 * chat in WeChat 4, while synthetic pointer events can interfere with another
 * foreground app, so neither is appropriate for background recovery. */
var selectionDiagnostic: [String: Any] = [:]

/** WeChat's session rows are read-only static text on current builds, but its
 * standard macOS menu exposes semantic next/previous-chat actions. Cycling one
 * step and immediately restoring it emits the same selection transition the
 * background relay needs without coordinates, key events, or activation. */
func hasOpenConversation(_ application: AXUIElement) -> Bool {
    guard let windows = attribute(
        application,
        kAXWindowsAttribute as CFString
    ) as? [AXUIElement] else { return false }
    return windows.flatMap { descendants($0) }.contains(where: {
        stringAttribute($0, kAXRoleAttribute as CFString) == kAXTextAreaRole
            && stringAttribute($0, kAXIdentifierAttribute as CFString)
                == "chat_input_field"
    })
}

func cycleSession(_ application: AXUIElement, restorePrevious: Bool) -> Bool {
    guard let menuBarValue = attribute(
        application,
        kAXMenuBarAttribute as CFString
    ), CFGetTypeID(menuBarValue) == AXUIElementGetTypeID() else {
        selectionDiagnostic["menu_bar"] = false
        return false
    }
    let menuBar = unsafeBitCast(menuBarValue, to: AXUIElement.self)
    let items = descendants(menuBar)
    let item = { (title: String) -> AXUIElement? in
        items.first(where: {
            stringAttribute($0, kAXTitleAttribute as CFString) == title
                && actionNames($0).contains(kAXPressAction)
        })
    }
    guard let next = item("Show Next Chat") else {
        selectionDiagnostic["next_chat_action"] = false
        return false
    }
    let nextResult = performGuardedAXAction(next, kAXPressAction as CFString)
    selectionDiagnostic["next_chat_result"] = nextResult.rawValue
    guard nextResult == .success else { return false }
    Thread.sleep(forTimeInterval: 0.1)
    // With no conversation open, Next Chat establishes the first real
    // selection and constructs WeChat's composer. Reversing that action would
    // return to the empty chat pane and leave the daemon's send breakpoint
    // armed with nothing capable of firing it. Preserve an existing user
    // selection, but keep the newly established selection when there was none.
    guard restorePrevious else {
        selectionDiagnostic["previous_chat_skipped"] = "no_open_conversation"
        Thread.sleep(forTimeInterval: 0.15)
        return hasOpenConversation(application)
    }
    if let previous = item("Show Previous Chat") {
        let previousResult = performGuardedAXAction(
            previous,
            kAXPressAction as CFString
        )
        selectionDiagnostic["previous_chat_result"] = previousResult.rawValue
    } else {
        selectionDiagnostic["previous_chat_action"] = false
    }
    Thread.sleep(forTimeInterval: 0.15)
    return hasOpenConversation(application)
}

/** Current WeChat 4 rows advertise AXPress even when their selection
 * attributes are read-only. Pressing the exact row object is the final
 * semantic fallback for an empty conversation pane; it may create a detached
 * chat window, but it neither activates WeChat nor synthesizes pointer input. */
func pressSessionRow(_ application: AXUIElement, _ row: AXUIElement) -> Bool {
    guard actionNames(row).contains(kAXPressAction) else {
        selectionDiagnostic["row_press_action"] = false
        return false
    }
    let result = performGuardedAXAction(row, kAXPressAction as CFString)
    selectionDiagnostic["row_press_result"] = result.rawValue
    guard result == .success else { return false }
    Thread.sleep(forTimeInterval: 0.25)
    return hasOpenConversation(application)
}

func selectRow(_ list: AXUIElement, _ element: AXUIElement) -> Bool {
    // WeChat 4.1.11 moved selection ownership from each session row to the
    // containing AXList. Prefer that standard list semantic, while retaining
    // the row attribute for builds that still expose it as writable.
    var listSelectionSettable = DarwinBoolean(false)
    let listCheck = AXUIElementIsAttributeSettable(
        list,
        kAXSelectedChildrenAttribute as CFString,
        &listSelectionSettable
    )
    selectionDiagnostic["list_selected_children_check"] = listCheck.rawValue
    selectionDiagnostic["list_selected_children_settable"] = listSelectionSettable.boolValue
    if listCheck == .success && listSelectionSettable.boolValue {
        let selected = [element] as CFArray
        let listSet = setGuardedAXAttribute(
            list,
            kAXSelectedChildrenAttribute as CFString,
            selected
        )
        selectionDiagnostic["list_selected_children_set"] = listSet.rawValue
        if listSet == .success {
            return true
        }
    }

    guard attributeNames(element).contains(kAXSelectedAttribute) else {
        selectionDiagnostic["row_has_selected"] = false
        return false
    }
    selectionDiagnostic["row_has_selected"] = true
    var rowSelectionSettable = DarwinBoolean(false)
    let rowCheck = AXUIElementIsAttributeSettable(
        element,
        kAXSelectedAttribute as CFString,
        &rowSelectionSettable
    )
    selectionDiagnostic["row_selected_check"] = rowCheck.rawValue
    selectionDiagnostic["row_selected_settable"] = rowSelectionSettable.boolValue
    let rowSet = setGuardedAXAttribute(
        element,
        kAXSelectedAttribute as CFString,
        kCFBooleanTrue
    )
    selectionDiagnostic["row_selected_set"] = rowSet.rawValue
    return rowSet == .success
}

/** The remembered-account screen in the pinned WeChat build exposes an exact
 * titled login control. Qt also exposes the window close affordance as the
 * only button advertising AXPress, so selecting an anonymous pressable button
 * closes WeChat instead of signing in. Require the visible semantic title plus
 * both remembered-account markers. Some Qt builds advertise only AXRaise for
 * the focused default button; Return can target that exact process without
 * raising its window, after verifying the focused control again. */
func requestRememberedLogin(_ application: AXUIElement) -> Bool {
    guard backgroundMutationAllowed(application) else { return false }
    guard enableLoginCheckboxes(application) else { return false }
    guard let windows = attribute(
        application,
        kAXWindowsAttribute as CFString
    ) as? [AXUIElement] else { return false }
    let controls = windows.flatMap { descendants($0) }
    guard controls.contains(where: {
        stringAttribute($0, kAXIdentifierAttribute as CFString)
            == "current_login_nick_name"
    }), controls.contains(where: {
        stringAttribute($0, kAXIdentifierAttribute as CFString)
            == "login_step_image_"
    }) else { return false }
    let buttonControls = controls.filter {
        stringAttribute($0, kAXRoleAttribute as CFString) == kAXButtonRole
    }
    let buttons = buttonControls.filter {
        stringAttribute($0, kAXTitleAttribute as CFString) == "Open WeChat"
    }
    selectionDiagnostic["remembered_login_buttons"] = buttons.count
    guard buttons.count == 1 else { return false }
    let actions = actionNames(buttons[0])
    selectionDiagnostic["remembered_login_actions"] = actions
    guard actions.contains(kAXPressAction) else {
        if requestFocusedRememberedLogin(application, button: buttons[0]) { return true }
        guard prepareRememberedLoginFocus(application, button: buttons[0]) else { return false }
        return requestFocusedRememberedLogin(application, button: buttons[0])
    }
    guard backgroundMutationAllowed(application) else { return false }
    loginSubmissionAttempted = true
    let result = performGuardedAXAction(
        buttons[0],
        kAXPressAction as CFString
    )
    selectionDiagnostic["remembered_login_result"] = result.rawValue
    return result == .success
}

func postWeChatLoginReturn(_ pid: pid_t) -> Bool {
    guard !macSessionIsLocked(), requestedProcessBirthMatches(pid), verifiedBackgroundGuard(pid) else { return false }
    guard let down = CGEvent(keyboardEventSource: nil, virtualKey: 36, keyDown: true),
          let up = CGEvent(keyboardEventSource: nil, virtualKey: 36, keyDown: false)
    else { return false }
    // postToPid never sends input to the foreground application or changes
    // the global keyboard focus. Readiness is checked separately after this
    // request; posting an event does not establish a signed-in session.
    loginSubmissionAttempted = true
    down.postToPid(pid)
    up.postToPid(pid)
    return true
}

func requestFocusedRememberedLogin(_ application: AXUIElement, button: AXUIElement) -> Bool {
    var pid: pid_t = 0
    var buttonPID: pid_t = 0
    guard !macSessionIsLocked(), backgroundMutationAllowed(application),
          AXUIElementGetPid(application, &pid) == .success, pid > 1,
          AXUIElementGetPid(button, &buttonPID) == .success, buttonPID == pid,
          let window = loginWindow(application) else { return false }
    let controls = descendants(window)
    let ids = controls.map { stringAttribute($0, kAXIdentifierAttribute as CFString) }
    let buttons = controls.filter {
        stringAttribute($0, kAXRoleAttribute as CFString) == kAXButtonRole &&
        stringAttribute($0, kAXTitleAttribute as CFString) == "Open WeChat"
    }
    guard ids.contains("current_login_nick_name"), ids.contains("login_step_image_"),
          !ids.contains("session_list"), buttons.count == 1, CFEqual(buttons[0], button),
          (attribute(button, kAXEnabledAttribute as CFString) as? Bool) == true,
          (attribute(button, kAXFocusedAttribute as CFString) as? Bool) == true,
          let focused = attribute(application, kAXFocusedUIElementAttribute as CFString),
          CFEqual(focused, button),
          controls.filter({ stringAttribute($0, kAXRoleAttribute as CFString) == kAXCheckBoxRole })
            .allSatisfy({ loginCheckboxValue($0) == 1 }),
          let current = loginWindow(application), CFEqual(current, window),
          !macSessionIsLocked()
    else { return false }
    let requested = postWeChatLoginReturn(pid)
    selectionDiagnostic["remembered_login_focused_return"] = requested
    return requested
}

/** A cold, guarded window has no focused element. Select only its verified
 * remembered-login button through AX, without raising the window or activating
 * the app. A different focused control belongs to the user and is left alone.
 * The Return path above repeats every identity/focus check after this setter. */
func prepareRememberedLoginFocus(_ application: AXUIElement, button: AXUIElement) -> Bool {
    var pid: pid_t = 0, buttonPID: pid_t = 0
    guard !macSessionIsLocked(), backgroundMutationAllowed(application),
          AXUIElementGetPid(application, &pid) == .success, pid > 1,
          AXUIElementGetPid(button, &buttonPID) == .success, buttonPID == pid,
          attribute(application, kAXFocusedUIElementAttribute as CFString) == nil,
          (attribute(button, kAXFocusedAttribute as CFString) as? Bool) == false,
          (attribute(button, kAXEnabledAttribute as CFString) as? Bool) == true,
          let window = loginWindow(application) else { return false }
    let controls = descendants(window)
    let ids = controls.map { stringAttribute($0, kAXIdentifierAttribute as CFString) }
    let buttons = controls.filter {
        stringAttribute($0, kAXRoleAttribute as CFString) == kAXButtonRole &&
        stringAttribute($0, kAXTitleAttribute as CFString) == "Open WeChat"
    }
    guard ids.contains("current_login_nick_name"), ids.contains("login_step_image_"),
          !ids.contains("session_list"), buttons.count == 1, CFEqual(buttons[0], button),
          controls.filter({ stringAttribute($0, kAXRoleAttribute as CFString) == kAXCheckBoxRole })
            .allSatisfy({ loginCheckboxValue($0) == 1 }),
          let current = loginWindow(application), CFEqual(current, window) else { return false }
    var settable = DarwinBoolean(false)
    guard AXUIElementIsAttributeSettable(button, kAXFocusedAttribute as CFString, &settable) == .success,
          settable.boolValue,
          attribute(application, kAXFocusedUIElementAttribute as CFString) == nil else { return false }
    let result = setGuardedAXAttribute(button, kAXFocusedAttribute as CFString, kCFBooleanTrue)
    selectionDiagnostic["remembered_login_focus_result"] = result.rawValue
    guard result == .success else { return false }
    Thread.sleep(forTimeInterval: 0.05)
    guard backgroundMutationAllowed(application),
          (attribute(button, kAXFocusedAttribute as CFString) as? Bool) == true,
          let focused = attribute(application, kAXFocusedUIElementAttribute as CFString),
          CFEqual(focused, button) else { return false }
    return true
}

/** WeChat can place one explicit signed-out notice above an otherwise valid
 * remembered account. Keep it distinct from ordinary remembered login so the
 * Hub can fail fast when this security confirmation cannot be pressed through
 * the app's semantic accessibility surface. */
func signedOutNoticeVisible(_ application: AXUIElement) -> Bool {
    guard let windows = attribute(
        application,
        kAXWindowsAttribute as CFString
    ) as? [AXUIElement] else { return false }
    let controls = windows.flatMap { descendants($0) }
    return controls.contains(where: {
        let text = stringAttribute($0, kAXValueAttribute as CFString)
        let title = stringAttribute($0, kAXTitleAttribute as CFString)
        return text == "You have signed out of WeChat"
            || title == "You have signed out of WeChat"
    })
}

/** Dismiss only that exact notice and its single semantic OK button; QR,
 * switch-account, and arbitrary alerts remain untouched. */
func dismissSignedOutNotice(_ application: AXUIElement) -> Bool {
    guard signedOutNoticeVisible(application) else { return false }
    guard let windows = attribute(
        application,
        kAXWindowsAttribute as CFString
    ) as? [AXUIElement] else { return false }
    let controls = windows.flatMap { descendants($0) }
    let buttons = controls.filter {
        stringAttribute($0, kAXRoleAttribute as CFString) == kAXButtonRole
            && stringAttribute($0, kAXTitleAttribute as CFString) == "OK"
            && actionNames($0).contains(kAXPressAction)
    }
    selectionDiagnostic["signed_out_ok_buttons"] = buttons.count
    guard buttons.count == 1 else { return false }
    let result = performGuardedAXAction(buttons[0], kAXPressAction as CFString)
    selectionDiagnostic["signed_out_ok_result"] = result.rawValue
    return result == .success
}

/** Read-only lifecycle state for the native writer while it keeps wechatd
 * detached after requesting remembered login. This deliberately does not
 * select a chat or press the login button: it lets one exact login request
 * settle without turning a readiness poll into repeated UI actions. */
func sessionState(_ application: AXUIElement) -> String {
    guard let windows = attribute(application, kAXWindowsAttribute as CFString) as? [AXUIElement]
    else { return "unavailable" }
    // The ordinary signed-in surface has one exact session list. Search by
    // depth, not depth-first: a long active conversation can otherwise consume
    // the entire bound before the shallow chat rail is visited.
    for window in windows {
        var queue = children(window)
        var index = 0
        var visited = 0
        while index < queue.count && visited < 3_000 {
            let element = queue[index]
            index += 1
            visited += 1
            if stringAttribute(element, kAXIdentifierAttribute as CFString)
                == "session_list" {
                return "signed_in"
            }
            queue.append(contentsOf: children(element))
        }
    }
    let controls = windows.flatMap { descendants($0) }
    if controls.contains(where: {
        let text = stringAttribute($0, kAXValueAttribute as CFString)
        let title = stringAttribute($0, kAXTitleAttribute as CFString)
        return text == "You have signed out of WeChat"
            || title == "You have signed out of WeChat"
    }) {
        return "signed_out"
    }
    let identifiers = controls.map {
        stringAttribute($0, kAXIdentifierAttribute as CFString)
    }
    if identifiers.contains("current_login_nick_name")
        && identifiers.contains("login_step_image_") {
        return "remembered_login"
    }
    if controls.contains(where: {
        let text = stringAttribute($0, kAXValueAttribute as CFString)
        let title = stringAttribute($0, kAXTitleAttribute as CFString)
        return text == "Scan to log in" || title == "Scan to log in"
    }) {
        return "interactive_login"
    }
    if identifiers.contains(where: {
        $0.hasPrefix("login_") || $0.hasPrefix("current_login_")
    }) {
        return "interactive_login"
    }
    return "unavailable"
}

/** Accessibility can stop answering while macOS is locked even though
 * WeChat's QR/login window remains visible to the window server. Never let a
 * read-only readiness probe inherit that stall: give the semantic tree a
 * short chance to answer, then recognise only WeChat's exact compact login
 * surface and otherwise fail closed. */
func compactLoginWindowVisible(_ pid: pid_t) -> Bool {
    let options: CGWindowListOption = [
        .optionOnScreenOnly,
        .excludeDesktopElements,
    ]
    guard let windows = CGWindowListCopyWindowInfo(
        options,
        kCGNullWindowID
    ) as? [[String: Any]] else { return false }
    let owned = windows.filter { window in
        guard let owner = window[kCGWindowOwnerPID as String] as? NSNumber,
              owner.int32Value == pid,
              let layer = window[kCGWindowLayer as String] as? NSNumber,
              layer.intValue == 0,
              let bounds = window[kCGWindowBounds as String] as? NSDictionary,
              let frame = CGRect(dictionaryRepresentation: bounds)
        else { return false }
        return frame.width >= 260 && frame.width <= 320
            && frame.height >= 350 && frame.height <= 430
    }
    return owned.count == 1
}

final class SessionStateBox: @unchecked Sendable {
    private let lock = NSLock()
    private var value: String?

    func store(_ state: String) {
        lock.lock()
        value = state
        lock.unlock()
    }

    func load() -> String? {
        lock.lock()
        defer { lock.unlock() }
        return value
    }
}

func boundedSessionState(
    _ application: AXUIElement,
    pid: pid_t,
    timeout: DispatchTimeInterval = .milliseconds(1_000)
) -> String {
    let result = SessionStateBox()
    let finished = DispatchSemaphore(value: 0)
    DispatchQueue.global(qos: .userInitiated).async {
        result.store(sessionState(application))
        finished.signal()
    }
    if finished.wait(timeout: .now() + timeout) == .success {
        return result.load() ?? "unavailable"
    }
    return compactLoginWindowVisible(pid) ? "interactive_login" : "unavailable"
}

func macSessionIsLocked() -> Bool {
    !desktopSessionAllowsAutomation(CGSessionCopyCurrentDictionary() as? [String: Any])
}

func primeAvailableSession(_ application: AXUIElement) -> String? {
    guard let windows = attribute(application, kAXWindowsAttribute as CFString) as? [AXUIElement]
    else { return nil }

    for window in windows {
        let controls = descendants(window)
        guard let sessionList = controls.first(where: {
            stringAttribute($0, kAXIdentifierAttribute as CFString) == "session_list"
        }) else { continue }

        let ordinaryRows = controls.filter { element in
            let identifier = stringAttribute(element, kAXIdentifierAttribute as CFString)
            guard identifier.hasPrefix("session_item_") else { return false }
            return ![
                "session_item_Minimized Groups",
                "session_item_Service Accounts",
                "session_item_Official Accounts",
            ].contains(identifier)
        }
        guard let row = ordinaryRows.first else { continue }
        let restorePrevious = hasOpenConversation(application)
        if cycleSession(application, restorePrevious: restorePrevious) {
            return restorePrevious ? "chat_menu" : "chat_menu_opened"
        }
        if selectRow(sessionList, row) {
            Thread.sleep(forTimeInterval: 0.25)
            if hasOpenConversation(application) { return "selected_children" }
        }
        if pressSessionRow(application, row) { return "pressed_row" }
    }
    return nil
}

/** Preserve the exact foreground owner around the semantic action. Recovery
 * now fails closed when WeChat has no accessible session list; reopening the
 * app can activate it briefly even when AppKit is asked not to. */
func containFocus(
    _ candidates: [NSRunningApplication],
    previous: NSRunningApplication?,
    previousPID: pid_t?
) -> Bool {
    // Observation only. Never activate another app to conceal a focus failure
    // or undo a foreground change made by the user during the operation.
    guard let current = NSWorkspace.shared.frontmostApplication else { return false }
    return !candidates.contains(where: { $0.processIdentifier == current.processIdentifier })
}

let bundleID = "com.tencent.xinWeChat"
let frontmostApplicationBefore = NSWorkspace.shared.frontmostApplication
let frontmostBefore = frontmostApplicationBefore?.processIdentifier
let requestedPID: pid_t? = {
    guard let index = CommandLine.arguments.firstIndex(of: "--pid"),
          CommandLine.arguments.indices.contains(index + 1),
          let value = Int32(CommandLine.arguments[index + 1]), value > 1
    else { return nil }
    return value
}()
if CommandLine.arguments.contains("--expected-birth") {
    guard let pid = requestedPID, requestedProcessBirthMatches(pid) else {
        emit(["ok": false, "reason": "wechat_process_changed", "state": "unavailable"])
    }
}
let candidates = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID)
    .filter { !$0.isTerminated }
    .filter { requestedPID == nil || $0.processIdentifier == requestedPID }
let statusOnly = CommandLine.arguments.contains("--status-only")
let loginSnapshot = CommandLine.arguments.contains("--login-snapshot")
let loginOptionsOnly = CommandLine.arguments.contains("--login-options")

guard !candidates.isEmpty else {
    emit(["ok": false, "reason": "wechat_not_running"])
}
// A cached accessibility tree can remain readable behind the lock screen.
// It is not permission to prepare a sender or change login options. Check
// before any AX traversal or mutation, including read-only readiness polls.
guard !macSessionIsLocked() else {
    emit(["ok": true, "ready": false, "state": "locked", "reason": "wechat_session_locked"])
}
// Both helpers use this process-scoped lock so simultaneous QR polling and
// remembered-login preparation cannot press the same unchecked box twice.
var loginLockDescriptor: Int32? = nil
if !statusOnly && candidates.count != 1 { emit(["ok": false, "state": "unavailable"]) }
if !statusOnly, candidates.count == 1, let running = candidates.first {
    loginLockDescriptor = acquireLoginLock(running.processIdentifier)
    guard loginLockDescriptor != nil else { emit(["ok": false, "state": "unavailable"]) }
}
if loginSnapshot || loginOptionsOnly {
    guard candidates.count == 1, let running = candidates.first, !macSessionIsLocked() else {
        emit(["ok": false, "state": "unavailable"])
    }
    let application = AXUIElementCreateApplication(running.processIdentifier)
    let state = boundedSessionState(application, pid: running.processIdentifier)
    guard ["interactive_login", "remembered_login"].contains(state), loginWindow(application) != nil else {
        emit(["ok": true, "state": state, "optionsReady": false])
    }
    guard verifiedBackgroundGuard(running.processIdentifier), !macSessionIsLocked() else {
        emit(["ok": true, "state": state, "optionsReady": false, "issue": "background-guard", "reason": "background_guard_unavailable"])
    }
    let optionsReady = enableLoginCheckboxes(application)
    if loginOptionsOnly { emit(["ok": true, "state": state, "optionsReady": optionsReady]) }
    if state == "interactive_login", loginQRExpired(application) {
        refreshExpiredLoginQR(application)
        emit(["ok": true, "state": state, "optionsReady": optionsReady, "issue": "qr-expired"])
    }
    if state == "interactive_login" && !CGPreflightScreenCaptureAccess() {
        emit(["ok": true, "state": state, "optionsReady": optionsReady, "issue": "screen-recording"])
    }
    if #available(macOS 14.0, *), state == "interactive_login", optionsReady {
        Task {
            let qr = await captureLoginQR(running, application)
            let current = boundedSessionState(application, pid: running.processIdentifier)
            var result: [String: Any] = ["ok": true, "state": current, "optionsReady": optionsReady]
            if let qr, current == "interactive_login" { result["qrDataUrl"] = qr }
            emit(result)
        }
        // ScreenCaptureKit delivers on the main run loop. The parent has a
        // bounded timeout; it clears any previously displayed image on failure.
        RunLoop.main.run()
    }
    emit(["ok": true, "state": state, "optionsReady": optionsReady])
}
if statusOnly {
    let observations = candidates.map { running in
        let observed = running.isFinishedLaunching
            ? boundedSessionState(
                AXUIElementCreateApplication(running.processIdentifier),
                pid: running.processIdentifier
            )
            : "launching"
        return (
            running: running,
            state: observed
        )
    }
    // The session can lock while the bounded AX request is in flight.
    guard !macSessionIsLocked() else {
        emit(["ok": true, "ready": false, "state": "locked", "reason": "wechat_session_locked"])
    }
    let signedIn = observations.filter { $0.state == "signed_in" }
    if signedIn.count == 1, let selected = signedIn.first {
        emit([
            "ok": true,
            "ready": true,
            "state": selected.state,
            "pid": selected.running.processIdentifier,
        ])
    }
    if signedIn.count > 1 {
        emit([
            "ok": false,
            "ready": false,
            "reason": "wechat_multiple_signed_in_processes",
            "state": "unavailable",
            "processes": signedIn.map { observation in
                ["pid": observation.running.processIdentifier]
            },
        ])
    }
    let priority = [
        "signed_out",
        "remembered_login",
        "interactive_login",
        "locked",
        "launching",
        "unavailable",
    ]
    let selected = priority.compactMap { expected in
        observations.first(where: { $0.state == expected })
    }.first ?? observations[0]
    emit([
        "ok": true,
        "ready": false,
        "state": selected.state,
        "pid": selected.running.processIdentifier,
        "processes": observations.map { observation in
            [
                "pid": observation.running.processIdentifier,
                "state": observation.state,
            ]
        },
    ])
}

// Mutating primer actions must never run while the user is actively using
// WeChat. The read-only status path above is deliberately allowed to inspect
// that same frontmost process, however: a healthy foreground session is still
// a valid sender and must not be misclassified as a cold/disconnected wake.
guard !candidates.contains(where: { $0.processIdentifier == frontmostBefore }) else {
    emit(["ok": false, "reason": "wechat_frontmost"])
}

for running in candidates {
    // Launch Services may have created the process while the macOS session is
    // locked, before WeChat has even constructed NSApplication. Attaching the
    // native primer at this point cannot create a window and can hold startup
    // behind a debugger timeout, so expose the real pending state instead.
    if !running.isFinishedLaunching { continue }
    guard verifiedBackgroundGuard(running.processIdentifier), !macSessionIsLocked() else {
        emit(["ok": false, "reason": "background_guard_unavailable"])
    }
    let application = AXUIElementCreateApplication(running.processIdentifier)
    if dismissSignedOutNotice(application) {
        Thread.sleep(forTimeInterval: 0.1)
    }
    if signedOutNoticeVisible(application) {
        emit([
            "ok": false,
            "reason": "wechat_signed_out_confirmation_required",
            "state": "signed_out",
            "pid": running.processIdentifier,
        ])
    }
    let currentSessionState = sessionState(application)
    if currentSessionState == "interactive_login" {
        emit([
            "ok": false,
            "reason": "wechat_interactive_sign_in_required",
            "state": "interactive_login",
            "pid": running.processIdentifier,
        ])
    }
    // A remembered-account window can still expose stale chat-menu semantics.
    // Treating those as a prepared conversation skips the one login action
    // this state actually needs and leaves an automatic cold wake pending
    // forever. Prefer the exact remembered account before any chat cycling.
    let method = currentSessionState == "remembered_login"
        ? (requestRememberedLogin(application) ? "remembered_login" : nil)
        : (primeAvailableSession(application)
            ?? (requestRememberedLogin(application) ? "remembered_login" : nil))
    if let method {
        guard containFocus(
            candidates,
            previous: frontmostApplicationBefore,
            previousPID: frontmostBefore
        ) else {
            emit(["ok": false, "reason": "wechat_took_focus"])
        }
        emit([
            "ok": true,
            "primed": true,
            "method": method,
            "preparedWindow": false,
            "pid": running.processIdentifier,
        ])
    }
}

if candidates.allSatisfy({ !$0.isFinishedLaunching }) {
    let locked = macSessionIsLocked()
    emit([
        "ok": false,
        "reason": locked ? "wechat_session_locked" : "wechat_launch_pending",
        "state": locked ? "locked" : "launching",
        "pid": candidates[0].processIdentifier,
    ])
}

emit([
    "ok": false,
    "reason": "wechat_chat_list_unavailable",
    "pid": candidates[0].processIdentifier,
    "diagnostic": selectionDiagnostic,
])
