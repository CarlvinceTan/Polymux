public enum UnreadAccess {
    public static func value(count: Int64, activity: String = "") -> String {
        guard count > 0 else { return activity }
        return activity.isEmpty ? "Unread" : "Unread, \(activity)"
    }
}
