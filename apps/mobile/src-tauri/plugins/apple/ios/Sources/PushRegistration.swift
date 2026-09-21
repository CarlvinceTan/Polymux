import Foundation
import UIKit
import UserNotifications
import ObjectiveC.runtime
import Tauri

enum PushRegistration {
    static var pending: Invoke?
    static var installed = false
    static var timer: Timer?
    static func register(_ invoke: Invoke) {
        DispatchQueue.main.async {
            guard pending == nil else { invoke.reject("Notification setup is already in progress."); return }
            guard let delegate = UIApplication.shared.delegate, let type = object_getClass(delegate) else {
                invoke.reject("Notification registration is unavailable."); return
            }
            if !installed {
                let success = #selector(UIApplicationDelegate.application(_:didRegisterForRemoteNotificationsWithDeviceToken:))
                let failure = #selector(UIApplicationDelegate.application(_:didFailToRegisterForRemoteNotificationsWithError:))
                // Do not replace an existing framework or plugin's delegate handler.
                guard class_getInstanceMethod(type, success) == nil && class_getInstanceMethod(type, failure) == nil else {
                    invoke.reject("Another notification handler is already installed."); return
                }
                let successBlock: @convention(block) (AnyObject, UIApplication, Data) -> Void = { _, _, data in
                    finish(token: data.map { String(format: "%02x", $0) }.joined(), error: nil)
                }
                let failureBlock: @convention(block) (AnyObject, UIApplication, NSError) -> Void = { _, _, _ in
                    finish(token: nil, error: "Apple could not register this device for notifications.")
                }
                guard class_addMethod(type, success, imp_implementationWithBlock(successBlock), "v@:@@"),
                      class_addMethod(type, failure, imp_implementationWithBlock(failureBlock), "v@:@@") else {
                    invoke.reject("Notification registration could not be installed."); return
                }
                installed = true
            }
            pending = invoke
            timer = Timer.scheduledTimer(withTimeInterval: 30, repeats: false) { _ in
                finish(token: nil, error: "Notification setup timed out. Try again.")
            }
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in
                DispatchQueue.main.async {
                    if granted { UIApplication.shared.registerForRemoteNotifications() }
                    else { finish(token: nil, error: "Allow notifications for Polymux in Settings.") }
                }
            }
        }
    }
    private static func finish(token: String?, error: String?) {
        timer?.invalidate(); timer = nil
        if let token { pending?.resolve(["token": token, "environment": Bundle.main.object(forInfoDictionaryKey: "PolymuxAPNSEnvironment") as? String ?? "production"]) }
        else { pending?.reject(error ?? "Notification setup failed.") }
        pending = nil
    }
}
