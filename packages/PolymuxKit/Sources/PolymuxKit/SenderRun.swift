extension Message {
    public func startsRun(after previous: Message?) -> Bool {
        guard role == "assistant" else { return false }
        guard let previous, let agentID else { return true }
        return previous.role != role || previous.agentID != agentID
    }
}
