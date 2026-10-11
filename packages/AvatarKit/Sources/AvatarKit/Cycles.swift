import Foundation

public struct Block: Codable, Equatable, Sendable {
    public var state: StateID
    public var duration: Double
    public init(state: StateID, duration: Double) { self.state = state; self.duration = duration }
}

public struct Cycle: Codable, Equatable, Identifiable, Sendable {
    public var id, name: String
    public var blocks: [Block]
    public init(id: String, name: String, blocks: [Block]) { self.id = id; self.name = name; self.blocks = blocks }
}

public struct BlockPosition: Equatable, Sendable {
    public var index: Int
    public var elapsed: Double
}

public let MIN_BLOCK = STATES.map(\.morph).max()!
public let MAX_BLOCK = 10.0
public let MAX_BLOCS = 200
public let MAX_CYCLES = 50
public let STEP = 0.1

public func minDurationOf(_ state: StateID) -> Double {
    max(MIN_BLOCK, STATE_BY_ID[state]?.minDuration ?? MIN_BLOCK)
}

public func clampDuration(_ state: StateID, _ seconds: Double) -> Double {
    let snapped = floor(seconds / STEP + 0.5) * STEP
    let bounded = min(MAX_BLOCK, max(minDurationOf(state), snapped))
    return floor(bounded * 100 + 0.5) / 100
}

public func makeBlock(_ state: StateID) -> Block {
    Block(state: state, duration: clampDuration(state, STATE_BY_ID[state]?.duration ?? 2))
}

public func defaultCycle() -> Cycle { Cycle(id: "defaut", name: "", blocks: SEQUENCE.map(makeBlock)) }
public func totalDuration(_ blocks: [Block]) -> Double { blocks.reduce(0) { $0 + $1.duration } }
public func offsetOf(_ blocks: [Block], _ index: Int) -> Double {
    guard index > 0 else { return 0 }
    return blocks.prefix(index).reduce(0) { $0 + $1.duration }
}

public func blockAt(_ blocks: [Block], _ t: Double) -> BlockPosition {
    let total = totalDuration(blocks)
    guard !blocks.isEmpty, total > 0 else { return BlockPosition(index: 0, elapsed: 0) }
    let wrapped = t >= 0 && t < total ? t : ((t.truncatingRemainder(dividingBy: total)) + total).truncatingRemainder(dividingBy: total)
    var acc = 0.0
    for i in blocks.indices {
        let end = acc + blocks[i].duration
        if wrapped < end { return BlockPosition(index: i, elapsed: wrapped - acc) }
        acc = end
    }
    return BlockPosition(index: blocks.count - 1, elapsed: 0)
}

public func blocksWith(_ blocks: [Block], _ state: StateID) -> [Block] {
    blocks.count >= MAX_BLOCS ? blocks : blocks + [makeBlock(state)]
}

public func moveBlock(_ blocks: [Block], _ from: Int, _ to: Int) -> [Block] {
    guard blocks.indices.contains(from) else { return blocks }
    var next = blocks
    let moved = next.remove(at: from)
    next.insert(moved, at: min(max(to, 0), next.count))
    return next
}

public func uniqueName(_ base: String, _ cycles: [Cycle]) -> String {
    let taken = Set(cycles.map(\.name))
    if !taken.contains(base) { return base }
    var n = 2
    while taken.contains("\(base) \(n)") { n += 1 }
    return "\(base) \(n)"
}

public func nextCycleId(_ cycles: [Cycle]) -> String {
    let taken = Set(cycles.map(\.id))
    var n = 1
    while taken.contains("c\(n)") { n += 1 }
    return "c\(n)"
}

public func parseCycles(_ raw: String?) -> [Cycle] {
    guard let raw, let data = raw.data(using: .utf8),
          let list = try? JSONSerialization.jsonObject(with: data) as? [Any] else { return [] }
    var out: [Cycle] = []
    for rawItem in list.prefix(MAX_CYCLES) {
        guard let item = rawItem as? [String: Any],
              let id = item["id"] as? String, !id.isEmpty,
              let name = item["name"] as? String,
              let blocks = item["blocks"] as? [Any], !out.contains(where: { $0.id == id }) else { continue }
        let kept = blocks.prefix(MAX_BLOCS).compactMap { raw -> Block? in
            guard let block = raw as? [String: Any], let key = block["state"] as? String,
                  let state = StateID(rawValue: key), SEQUENCE.contains(state),
                  let duration = block["duration"] as? NSNumber,
                  CFGetTypeID(duration) != CFBooleanGetTypeID(), duration.doubleValue.isFinite else { return nil }
            return Block(state: state, duration: clampDuration(state, duration.doubleValue))
        }
        if !kept.isEmpty { out.append(Cycle(id: id, name: name, blocks: kept)) }
    }
    return out
}

public let BASE_SCALE = 44.0
public let MIN_ZOOM = 0.45
public let MAX_ZOOM = 2.4
public func clampZoom(_ value: Double) -> Double { min(MAX_ZOOM, max(MIN_ZOOM, value)) }
public func mmss(_ t: Double) -> String {
    let seconds = max(0, Int(floor(t)))
    return String(format: "%d:%02d", seconds / 60, seconds % 60)
}
public struct TimelineTick: Equatable, Sendable { public var t: Double; public var major: Bool }
public func ticksFor(_ total: Double, _ scale: Double) -> [TimelineTick] {
    let options = [0.5, 1, 2, 5, 10, 15, 30, 60.0]
    let major = options.first { $0 * scale >= 52 } ?? options.last!
    let step = major / 5 * scale >= 7 ? major / 5 : major
    var out: [TimelineTick] = []
    var i = 0
    while Double(i) * step <= total + 1e-6 && out.count < 2000 {
        let t = Double(i) * step
        out.append(TimelineTick(t: t, major: abs(t / major - (t / major).rounded()) < 1e-6))
        i += 1
    }
    return out
}

public final class CyclePlayer {
    public let engine: BotEngine
    public private(set) var blocks: [Block]
    public private(set) var clock = 0.0
    public private(set) var block = 0
    public private(set) var elapsed = 0.0
    public private(set) var playing = false
    private var blockStart = 0.0
    private var nextAt = Double.infinity

    public init(engine: BotEngine, blocks: [Block] = defaultCycle().blocks) {
        self.engine = engine; self.blocks = blocks
        if let first = blocks.first { engine.reset(first.state, 0) }
    }

    public func play(_ enabled: Bool) {
        playing = enabled
        if enabled { apply(block, elapsed) } else { nextAt = .infinity }
    }

    private func apply(_ index: Int, _ from: Double = 0) {
        guard blocks.indices.contains(index) else { nextAt = .infinity; return }
        blockStart = clock - from; elapsed = from
        engine.setState(blocks[index].state, clock)
        nextAt = playing ? blockStart + blocks[index].duration : .infinity
    }

    public func seek(_ index: Int, _ offset: Double = 0) {
        guard blocks.indices.contains(index) else { return }
        block = index; apply(index, offset)
    }

    public func replace(_ next: [Block]) {
        blocks = next
        guard !next.isEmpty else { nextAt = .infinity; return }
        let i = min(block, next.count - 1)
        if i != block { seek(i) } else { nextAt = playing ? blockStart + next[i].duration : .infinity }
    }

    public func tick(_ delta: Double) -> BotFrame {
        clock += min(max(delta, 0), 0.064)
        if playing {
            if clock >= nextAt, !blocks.isEmpty { seek((block + 1) % blocks.count) }
            else { elapsed = clock - blockStart }
        }
        return engine.sample(clock)
    }

    // Replay boundaries from the first block, preserving transitions during arbitrary seeks.
    public func rendAt(_ t: Double) -> BotFrame {
        guard !blocks.isEmpty else { return engine.sample(t) }
        let position = blockAt(blocks, t)
        let wrapped = offsetOf(blocks, position.index) + position.elapsed
        let origin = t - wrapped
        engine.reset(blocks[0].state, origin)
        if position.index > 0 {
            for i in 1...position.index { engine.setState(blocks[i].state, origin + offsetOf(blocks, i)) }
        }
        return engine.sample(t)
    }
}
