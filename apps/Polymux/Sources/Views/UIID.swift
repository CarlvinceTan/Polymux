import Foundation

/// Accessibility identifiers verify-polymux queries. Dynamic segments are model ids.
enum UIID {
    static let chatsList = "chats.list"
    static let sidebarNewChat = "sidebar.newChat"
    static let sidebarSearch = "sidebar.search"
    static let sidebarSettings = "sidebar.settings"
    static let sidebarFilter = "sidebar.filter"
    static let settingsOpen = "settings.open"
    static let composerField = "composer.field"
    static let composerSend = "composer.send"
    static let composerAttach = "composer.attach"
    static let composerDictation = "composer.dictation"
    static let chatTranscript = "chat.transcript"
    static let chatThinking = "chat.thinking"
    static let chatHeaderEdit = "chat.header.edit"
    static let chatSearchField = "chat.search.field"
    static let focusSkip = "focus.skip"
    static let focusAnswered = "focus.answered"
    static let focusError = "focus.error"
    static let newChatTo = "newchat.to"
    static let newChatCreate = "newchat.create"
    static let newChatAgent = "newchat.newAgent"
    static let alertDeleteConfirm = "alert.deleteAgent.confirm"
    static let notificationsToggle = "settings.notifications.toggle"
    static let reviewsToggle = "agent.reviews.toggle"
    static let backgroundToggle = "control.background.toggle"
    static let profileName = "profile.name"
    static let profileRole = "profile.role"
    static let profileSave = "profile.save"
    static let profileAvatar = "profile.avatar"
    static let avatarDone = "avatar.done"
    static let appStatus = "app.status"
    static let avatarReady = "ready"

    static func sidebarRow(_ id: String) -> String { "sidebar.row.\(id)" }
    static func rowUnread(_ id: String) -> String { "sidebar.row.\(id).unread" }
    static func rowAvatars(_ id: String) -> String { "sidebar.row.\(id).avatarStack" }
    static func rowDelete(_ id: String) -> String { "sidebar.row.\(id).menu.delete" }
    static func draftName(_ name: String) -> String { "composer.draft.\(name)" }
    static func chatMessage(_ id: String) -> String { "chat.message.\(id)" }
    static func messageStatus(_ id: String) -> String { "chat.message.\(id).status" }
    static func senderName(_ id: String) -> String { "chat.message.\(id).senderName" }
    static func searchResult(_ id: String) -> String { "search.result.\(id)" }
    static func focusOption(_ id: String) -> String { "focus.option.\(id)" }
    static func toggleError(_ toggle: String) -> String { "\(toggle).error" }
    static func avatarColor(_ id: String) -> String { "avatar.color.\(id)" }
    static func avatar(_ id: String) -> String { "avatar.\(id)" }
    static func routine(_ id: String) -> String { "agent.routine.\(id)" }
    static func routineCancel(_ id: String) -> String { "agent.routine.\(id).cancel" }

    /// Warm means `SidebarStore.refresh` has set `isConnected`. Cold is the disk cache before that.
    static func statusValue(connected: Bool) -> String {
        "connected=\(connected ? 1 : 0);cache=\(connected ? "warm" : "cold")"
    }
}
