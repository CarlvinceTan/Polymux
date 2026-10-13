import Foundation
import Testing
@testable import PolymuxKit

@Suite @MainActor struct ToolRowTests {
    private func tool(_ id: String, _ name: String, _ summary: String? = nil, status: String = "completed", output: String? = nil) -> ToolActivity {
        ToolActivity(id: id, runID: "r", name: name, status: status, summary: summary, output: output)
    }

    private func run(_ tools: [ToolActivity]) -> Run {
        Run(id: "r", conversationID: "a", trigger: "message", tools: tools, attempt: 1, seq: 1, createdAt: "2026-10-13T12:00:00Z",
            updatedAt: "2026-10-13T12:00:00Z", activity: "tool", agentID: "a", status: "running", summary: "Using tools")
    }

    @Test func activityToolRowsCollapseReads() {
        let rows = ActivityStore.toolRows(for: run([
            tool("1", "read", "/tmp/one.swift"), tool("2", "read", "/tmp/two.swift"), tool("3", "read", "/tmp/three.swift"),
            tool("4", "bash", "go test ./..."), tool("5", "read", "/tmp/failed.swift", status: "failed", output: "no such file"),
            tool("6", "read", "/tmp/after.swift")
        ]))
        #expect(rows.map(\.title) == ["Read 3 files", "Ran go test ./...", "Read failed.swift", "Read after.swift"])
        #expect(rows[0].output == "/tmp/one.swift\n/tmp/two.swift\n/tmp/three.swift")
        #expect(rows[2].failed && rows[2].output == "/tmp/failed.swift\nno such file")
    }

    @Test func activityToolRowsSurviveReplay() {
        let store = ActivityStore()
        var live = run([tool("1", "bash", "go test ./...", status: "running")])
        store.restore([live])
        #expect(store.toolRows(for: live.id).first?.running == true)
        live.tools = [tool("1", "bash", "go test ./...", output: "ok\tpolymux\t0.2s")]
        live.status = "completed"
        live.seq = 2
        store.receive(Event(seq: 2, conversationID: "a", type: "tool.done", createdAt: live.updatedAt, run: live), live: true)
        #expect(store.toolRows(for: live.id) == [ToolRow(id: "1", title: "Ran go test ./...",
                                                         output: "go test ./...\nok\tpolymux\t0.2s", failed: false, running: false)])
    }
}
