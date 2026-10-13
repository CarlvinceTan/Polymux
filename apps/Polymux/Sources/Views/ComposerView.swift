import SwiftUI
import PhotosUI
import UniformTypeIdentifiers
import PolymuxKit

struct DraftFile: Identifiable {
    let id = UUID()
    let url: URL
    let kind: UTType
}

struct ComposerView: View {
    let client: APIClient
    let isVoiceActive: Bool
    let send: (String, [LocalFile], ReplyContext?, [String], ContinuousClock.Instant) async -> Void
    var reply: ReplyContext? = nil
    var agentName = ""
    var clearReply: () -> Void = {}
    var drops: Binding<[URL]> = .constant([])
    var members: [Agent] = []
    var trace = SignpostTrace()
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.openURL) private var openURL
    @State private var dictation = DictationInput()
    @State private var dictationDraft = DictationDraft()
    @State private var permissionBanner = false
    @State private var sending = false
    @State private var mentions: [MentionToken] = []
    @State private var text = ""
    @State private var selection: TextSelection?
    @State private var files: [DraftFile] = []
    @State private var photos: [PhotosPickerItem] = []
    @State private var attachments = false
    @State private var importing = false
    @State private var pickingPhotos = false
    @State private var camera = false
    @State private var loadingPhotos = false
    @State private var ignoresDictation = false
    @State private var error: String?
    @State private var unsent = false
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            controls
            if permissionBanner {
                HStack {
                    Text("Enable microphone & speech recognition in Settings")
                    Button("Settings") { openSettings() }
                }
                .font(.caption).padding(.leading, controlSize + 12)
            }
            if unsent {
                Button("Unsent", systemImage: "arrow.clockwise", action: submit)
                    .font(.caption).buttonStyle(.plain).foregroundStyle(.secondary)
                    .accessibilityLabel("Unsent. Resend message")
                    .padding(.leading, controlSize + 12)
            } else if let error {
                Text(error).font(.caption2).foregroundStyle(.primary).padding(.leading, controlSize + 12)
            }
        }
        .background {
            if dictation.active {
                Button("Stop dictation") { Task { await stopDictation() } }
                    .keyboardShortcut(.cancelAction)
                    .hidden().accessibilityHidden(true)
            }
        }
        .onChange(of: isVoiceActive) { _, active in
            focused = !active
            if active {
                attachments = false
                Task { await stopDictation() }
            }
        }
        .onChange(of: reply?.messageID) { _, value in
            if value != nil { focused = true }
        }
        .onChange(of: drops.wrappedValue) { _, urls in
            guard !urls.isEmpty else { return }
            drops.wrappedValue = []
            error = nil
            for url in urls {
                do { try addFile(url) }
                catch { self.error = error.localizedDescription }
            }
            focused = true
        }
        .onDisappear { Task { await stopDictation() } }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { Task { await stopDictation() } }
            if phase == .active, !dictation.denied { permissionBanner = false }
        }
        .onChange(of: dictation.active) { _, active in
            if !active { dictationDraft.stop() }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            do {
                for url in try result.get() { try addFile(url) }
            } catch { self.error = error.localizedDescription }
        }
        .photosPicker(isPresented: $pickingPhotos, selection: $photos, maxSelectionCount: 8, matching: .any(of: [.images, .videos]))
        .onChange(of: photos) { _, items in
            guard !items.isEmpty else { return }
            loadingPhotos = true
            Task {
                do {
                    for item in items {
                        let type = item.supportedContentTypes.first ?? .data
                        if let data = try await item.loadTransferable(type: Data.self) {
                            let suffix = type.preferredFilenameExtension ?? "bin"
                            let name = "Photo-\(UUID().uuidString.prefix(8)).\(suffix)"
                            let file = FileManager.default.temporaryDirectory.appending(path: name)
                            try data.write(to: file, options: .atomic)
                            withAnimation { files.append(DraftFile(url: file, kind: type)) }
                        }
                    }
                    photos = []
                } catch { self.error = error.localizedDescription }
                loadingPhotos = false
            }
        }
        #if os(macOS)
        .panel(isPresented: $camera) {
            CameraView { url in
                withAnimation { files.append(DraftFile(url: url, kind: .jpeg)) }
                camera = false
            }
        }
        #else
        .sheet(isPresented: $camera) {
            CameraView { url in
                withAnimation { files.append(DraftFile(url: url, kind: .jpeg)) }
                camera = false
            }
            .ignoresSafeArea()
        }
        #endif
        #if DICTATION_CHECK
        .onChange(of: text) { _, value in Self.renderedDraft.text = value }
        .onChange(of: files.count) { _, count in Self.renderedDraft.files = count }
        #endif
    }

    private var controls: some View {
        HStack(alignment: .bottom, spacing: 12) {
            Button { attachments.toggle() } label: {
                Image(systemName: "plus").font(.system(size: 17, weight: .regular))
                    .foregroundStyle(controlInk)
                    .frame(width: controlSize, height: controlSize)
                    .contentShape(Circle())
            }
            .buttonStyle(.plain).frame(width: controlSize, height: controlSize)
            .glassEffect(.regular.interactive(), in: Circle())
            .accessibilityLabel("Add attachment")
            .popover(isPresented: $attachments, attachmentAnchor: .rect(.bounds), arrowEdge: .bottom) {
                VStack(alignment: .leading, spacing: 0) {
                    attachmentButton("Files", icon: "doc") { importing = true }
                    attachmentButton("Photos", icon: "photo") { pickingPhotos = true }
                    attachmentButton("Camera", icon: "camera") { camera = true }
                        #if os(iOS)
                        .disabled(!UIImagePickerController.isSourceTypeAvailable(.camera))
                        #endif
                }
                .padding(6).frame(minWidth: 190)
                .presentationCompactAdaptation(.popover)
            }
            VStack(alignment: .leading, spacing: 10) {
                if let reply {
                    HStack(alignment: .top, spacing: 8) {
                        ReplyPreview(reply: reply, agentName: agentName, client: client)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Button("Cancel reply", systemImage: "xmark") { clearReply() }
                            .labelStyle(.iconOnly).buttonStyle(.plain)
                            .foregroundStyle(.secondary)
                    }
                }
                if !files.isEmpty {
                    ScrollView(.horizontal) {
                        HStack(alignment: .center, spacing: 10) {
                            ForEach(files) { file in
                                DraftPreview(file: file) {
                                    withAnimation { files.removeAll { $0.id == file.id } }
                                }
                            }
                        }
                    }
                    .scrollIndicators(.hidden)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }
                TextField("Message", text: draftText, selection: $selection, axis: .vertical)
                    .lineLimit(1...7).textFieldStyle(.plain)
                    .scrollIndicators(.hidden).focused($focused)
                    .onSubmit {
                        if let first = mentionChoices.first { mention(first) }
                        else { submit() }
                    }
                    .onKeyPress(.escape) {
                        guard dictation.active else { return .ignored }
                        Task { await stopDictation() }
                        return .handled
                    }
                    .accessibilityLabel("Message")
                    .anchorPreference(key: MentionAnchor.self, value: .bounds) { $0 }
            }
            .padding(.horizontal, 15).padding(.vertical, isExpanded ? 12 : 7)
            .frame(minHeight: controlSize)
            .glassEffect(.regular, in: RoundedRectangle(cornerRadius: isExpanded ? 24 : controlSize / 2))
            .overlayPreferenceValue(MentionAnchor.self) { anchor in
                GeometryReader { geometry in
                    if let anchor, !mentionChoices.isEmpty {
                        let field = geometry[anchor]
                        mentionList(width: min(320, field.width))
                            .offset(x: field.minX, y: field.minY - mentionHeight - 8)
                    }
                }
            }
            .zIndex(1)
            Button { toggleDictation() } label: {
                Image(systemName: dictation.denied ? "mic.slash.fill" : "mic.fill")
                    .font(.system(size: 15))
                    .foregroundStyle(dictation.active ? (colorScheme == .dark ? Color.black : Color.white) : controlInk)
                    .frame(width: controlSize, height: controlSize)
                    .background(dictation.active ? Color.accentColor : .clear, in: Circle())
                    .overlay {
                        if dictation.active {
                            Circle().stroke(controlInk, lineWidth: 2)
                                .scaleEffect(reduceMotion ? 1 : 1 + CGFloat(dictation.level) * 0.18)
                        }
                    }
            }
            .buttonStyle(.plain)
            .glassEffect(.regular.interactive(), in: Circle())
            .accessibilityLabel(dictation.active ? "Stop dictation" : "Start dictation")
            .accessibilityValue(dictation.denied ? "Permission denied" : dictation.active ? "Listening" : "")
            .disabled(dictation.stopping || sending || isVoiceActive)
            if hasContent {
                Button { submit() } label: {
                    Image(systemName: "arrow.up").font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(controlInk)
                        .frame(width: controlSize, height: controlSize)
                }
                .buttonStyle(.plain)
                .glassEffect(.regular.interactive(), in: Circle())
                .accessibilityLabel("Send message")
                .disabled(sending || loadingPhotos)
            }
        }
    }

    private var mentionQuery: (start: String.Index, term: String)? {
        guard members.count > 1, let start = text.lastIndex(of: "@") else { return nil }
        if start > text.startIndex {
            let previous = text[text.index(before: start)]
            guard previous.isWhitespace || "([{".contains(previous) else { return nil }
        }
        let offset = start.utf16Offset(in: text)
        if mentions.contains(where: { token in
            guard token.range.location == offset, let bounds = Range(token.range, in: text) else { return false }
            return text[bounds.upperBound...].first?.isWhitespace == true
        }) { return nil }
        let term = String(text[text.index(after: start)...])
        guard !term.contains("\n"), term.count <= 40 else { return nil }
        return (start, term)
    }

    private var mentionChoices: [Agent] {
        guard focused, let query = mentionQuery else { return [] }
        let everyone = Agent(id: "everyone", name: "everyone", role: "All members")
        return ([everyone] + members).enumerated().compactMap { index, agent -> (agent: Agent, rank: Int, index: Int)? in
            guard let rank = MentionRank.value(agent.name, term: query.term) else { return nil }
            return (agent, rank, index)
        }.sorted {
            $0.rank == $1.rank ? $0.index < $1.index : $0.rank < $1.rank
        }.map(\.agent)
    }

    private var mentionHeight: CGFloat { min(160, CGFloat(mentionChoices.count) * 40 + 6) }

    private func mentionList(width: CGFloat) -> some View {
        MentionSize(width: width, height: mentionHeight) {
            VStack(alignment: .leading, spacing: 2) {
                ForEach(mentionChoices) { member in
                    mentionLabel(member, fill: false)
                }
            }
            .padding(4).hidden().accessibilityHidden(true).allowsHitTesting(false)
            ScrollView {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(mentionChoices) { member in
                        Button { mention(member) } label: {
                            mentionLabel(member, fill: true)
                                .background(member.id == mentionChoices.first?.id ? Color.primary.opacity(0.1) : .clear,
                                            in: .rect(cornerRadius: 10))
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(members.filter({ $0.name == member.name }).count > 1
                                                ? "Mention \(member.name), \(member.role), \(member.id.prefix(6))"
                                                : "Mention \(member.name)")
                        .accessibilityValue(member.id == mentionChoices.first?.id ? "Top match" : "")
                        .accessibilityHint(member.id == mentionChoices.first?.id ? "Press Return to select" : "")
                    }
                }
                .padding(4)
            }
            .scrollIndicators(.hidden)
        }
        .glassEffect(.regular, in: .rect(cornerRadius: 16))
        .inputAccessory()
    }

    private func mentionLabel(_ member: Agent, fill: Bool) -> some View {
        let first = member.id == mentionChoices.first?.id
        return HStack(spacing: 0) {
            Text("@\(member.name)").lineLimit(1).layoutPriority(1)
            if member.id == "everyone" || first {
                if fill { Spacer(minLength: 8) }
                else { Color.clear.frame(width: 8) }
                HStack(spacing: 8) {
                    if member.id == "everyone" {
                        Text("All members").font(.caption).foregroundStyle(.secondary)
                            .lineLimit(1).layoutPriority(-1)
                    }
                    if first {
                        Image(systemName: "return").font(.caption).foregroundStyle(.secondary)
                            .fixedSize().accessibilityHidden(true)
                    }
                }
            } else if fill { Spacer(minLength: 0) }
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .frame(minHeight: 38)
    }

    private func mention(_ agent: Agent) {
        guard let query = mentionQuery else { return }
        let replaced = NSRange(query.start..., in: text)
        mentions = MentionToken.removing(mentions, range: replaced)
        let token = "@\(agent.name)"
        var updated = text
        updated.replaceSubrange(query.start..., with: token + " ")
        dictationDraft.edit(from: text, to: updated)
        editText(updated, range: replaced)
        if agent.id != "everyone" {
            mentions.append(MentionToken(id: agent.id, text: token,
                                         range: NSRange(location: replaced.location, length: token.utf16.count)))
        }
        selection = TextSelection(insertionPoint: text.endIndex)
        focused = true
    }

    private var draftText: Binding<String> {
        Binding(get: { text }, set: {
            dictationDraft.edit(from: text, to: $0)
            editText($0)
        })
    }

    private func editText(_ updated: String, range: NSRange? = nil) {
        let selected: NSRange?
        if let range { selected = range }
        else if case let .selection(bounds) = selection?.indices,
                bounds.lowerBound >= text.startIndex, bounds.upperBound <= text.endIndex {
            selected = NSRange(bounds, in: text)
        } else { selected = nil }
        mentions = MentionToken.updated(mentions, from: text, to: updated, selection: selected)
        text = updated
    }

    private func attachmentButton(_ title: String, icon: String, action: @escaping () -> Void) -> some View {
        Button {
            attachments = false
            action()
        } label: {
            HStack(spacing: 10) {
                Image(systemName: icon).frame(width: 24, alignment: .center)
                Text(title)
            }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 10).padding(.vertical, 9)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var hasContent: Bool { !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !files.isEmpty }
    private var isExpanded: Bool { !files.isEmpty || reply != nil }
    private var controlInk: Color { colorScheme == .dark ? .white : .black }

    private var controlSize: CGFloat {
        #if os(macOS)
        32
        #else
        44
        #endif
    }

    private func addFile(_ url: URL) throws {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let source = (url as NSURL).filePathURL ?? url
        guard try source.resourceValues(forKeys: [.isDirectoryKey]).isDirectory != true else {
            throw CocoaError(.fileReadUnsupportedScheme)
        }
        let folder = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString, directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let copy = folder.appending(path: source.lastPathComponent)
        try FileManager.default.copyItem(at: source, to: copy)
        let kind = UTType(filenameExtension: source.pathExtension) ?? .data
        withAnimation { files.append(DraftFile(url: copy, kind: kind)) }
    }

    private func toggleDictation() {
        if dictation.active {
            Task { await stopDictation() }
            return
        }
        guard !dictation.denied else { permissionBanner = true; return }
        permissionBanner = false
        error = nil
        focused = true
        ignoresDictation = false
        dictationDraft.stop()
        dictation.start { value in
            guard !ignoresDictation else { return }
            let range: NSRange
            if case let .selection(bounds) = selection?.indices,
               bounds.lowerBound >= text.startIndex, bounds.upperBound <= text.endIndex {
                range = NSRange(bounds, in: text)
            } else { range = NSRange(location: text.utf16.count, length: 0) }
            if let result = dictationDraft.update(value.text, start: value.start, final: value.final,
                                                  text: text, selection: range) {
                editText(result.text, range: result.range)
                let cursor = String.Index(utf16Offset: result.cursor, in: text)
                selection = TextSelection(insertionPoint: cursor)
            }
        } failure: { failure in
            if dictation.denied { permissionBanner = true }
            else { error = failure.localizedDescription }
        }
    }

    private func stopDictation() async {
        await dictation.stop()
        dictationDraft.stop()
    }

    private func openSettings() {
        #if os(macOS)
        let pane = dictation.microphoneDenied ? "Privacy_Microphone" : "Privacy_SpeechRecognition"
        let path = "x-apple.systempreferences:com.apple.preference.security?\(pane)"
        #else
        let path = UIApplication.openSettingsURLString
        #endif
        if let url = URL(string: path) { openURL(url) }
    }

    private func submit() {
        guard !sending else { return }
        sending = true
        let tap = ContinuousClock().now
        if dictation.active { Task { await stopDictation() } }
        sendDraft(at: tap)
    }

    /// Clears the composer in the same frame, then hands the files to `send` to upload behind the bubble.
    private func sendDraft(at tap: ContinuousClock.Instant) {
        guard hasContent, !loadingPhotos else { sending = false; return }
        let draft = text
        let pending = files
        let quote = reply
        guard let targets = MentionToken.targets(mentions, in: draft, members: Set(members.map(\.id))) else {
            error = "A mentioned agent left this chat. Remove or reselect the mention before sending."
            sending = false
            return
        }
        error = nil
        unsent = false
        let send = self.send
        InstantUI.interval("composer.cleared", budget: InstantUI.stateBudget, trace: trace, from: tap) {
            ignoresDictation = true
            dictationDraft.stop()
            text = ""
            selection = nil
            mentions = []
            files = []
            photos = []
        }
        Task {
            await send(draft, pending.map(\.localFile), quote, targets, tap)
            sending = false
            focused = true
        }
    }

    #if DICTATION_CHECK
    /// What the composer last rendered, so the snapshot harness can prove it cleared for real.
    /// A harness-made view cannot observe its own State writes, so `onChange` reports them here.
    nonisolated(unsafe) static var renderedDraft: (text: String, files: Int) = ("", 0)

    static func fixture(input: DictationInput, text: String = "", banner: Bool = false,
                        issue: String? = nil, focus: Bool = false, files: [DraftFile] = [],
                        trace: SignpostTrace = SignpostTrace()) -> some View {
        var view = ComposerView(client: APIClient(baseURL: URL(string: "http://127.0.0.1:1")!),
                                isVoiceActive: false, send: { _, _, _, _, _ in }, trace: trace)
        view._dictation = State(initialValue: input)
        view._text = State(initialValue: text)
        view._permissionBanner = State(initialValue: banner)
        view._error = State(initialValue: issue)
        view._files = State(initialValue: files)
        return view.onAppear { view.focused = focus }
    }

    /// A composer that submits its draft on appear, so the harness watches the real handoff.
    static func checkSubmitView(text: String, files: [DraftFile], reply: ReplyContext? = nil,
                                trace: SignpostTrace,
                                send: @escaping (String, [LocalFile], ReplyContext?, [String], ContinuousClock.Instant) async -> Void) -> some View {
        var view = ComposerView(client: APIClient(baseURL: URL(string: "http://127.0.0.1:1")!),
                                isVoiceActive: false, send: send, reply: reply, trace: trace)
        view._text = State(initialValue: text)
        view._files = State(initialValue: files)
        return view.onAppear { view.submit() }
    }

    /// A filled composer the harness can drive with a real click and Return, like a user would.
    static func checkReadyView(text: String, files: [DraftFile], reply: ReplyContext? = nil,
                               trace: SignpostTrace,
                               send: @escaping (String, [LocalFile], ReplyContext?, [String], ContinuousClock.Instant) async -> Void) -> some View {
        var view = ComposerView(client: APIClient(baseURL: URL(string: "http://127.0.0.1:1")!),
                                isVoiceActive: false, send: send, reply: reply, trace: trace)
        view._text = State(initialValue: text)
        view._files = State(initialValue: files)
        return view
    }
    #endif
}

extension DraftFile {
    var localFile: LocalFile {
        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        return LocalFile(id: id.uuidString, url: url, name: url.lastPathComponent,
                         kind: DraftFile.kindName(kind), mimeType: kind.preferredMIMEType ?? "",
                         size: Int64(size))
    }

    static func kindName(_ kind: UTType) -> String {
        if kind.conforms(to: .image) { return "image" }
        if kind.conforms(to: .movie) { return "video" }
        if kind.conforms(to: .audio) { return "audio" }
        if kind.conforms(to: .html) { return "html" }
        return ""
    }
}

private struct MentionSize: Layout {
    let width: CGFloat
    let height: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        guard let labels = subviews.first else { return .zero }
        let ideal = labels.sizeThatFits(.unspecified)
        return CGSize(width: max(0, min(ideal.width, min(width, proposal.width ?? width))), height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        guard subviews.count > 1 else { return }
        subviews[1].place(at: bounds.origin, anchor: .topLeading, proposal: ProposedViewSize(bounds.size))
    }
}

private struct MentionAnchor: PreferenceKey {
    static var defaultValue: Anchor<CGRect>? { nil }

    static func reduce(value: inout Anchor<CGRect>?, nextValue: () -> Anchor<CGRect>?) {
        value = nextValue() ?? value
    }
}

private enum MentionRank {
    static func value(_ name: String, term: String) -> Int? {
        let options: String.CompareOptions = [.caseInsensitive, .diacriticInsensitive, .widthInsensitive]
        let candidate = name.folding(options: options, locale: .current)
        let query = term.folding(options: options, locale: .current)
        if query.isEmpty || candidate == query { return 0 }
        if candidate.hasPrefix(query) { return 1 }
        return candidate.contains(query) ? 2 : nil
    }
}

private struct MentionToken {
    let id: String
    let text: String
    var range: NSRange

    static func removing(_ tokens: [Self], range: NSRange) -> [Self] {
        tokens.filter { NSIntersectionRange($0.range, range).length == 0 }
    }

    static func updated(_ tokens: [Self], from old: String, to new: String, selection: NSRange? = nil) -> [Self] {
        let before = Array(old.utf16)
        let after = Array(new.utf16)
        guard before != after else { return tokens }
        let changed: NSRange
        let inserted: Int
        var ambiguous: NSRange?
        if let edit = nativeEdit(before, after, selection: selection) {
            changed = edit.range
            inserted = edit.inserted
        } else {
            let shared = min(before.count, after.count)
            var prefix = 0
            while prefix < shared, before[prefix] == after[prefix] { prefix += 1 }
            var suffix = 0
            while suffix < shared, before[before.count - suffix - 1] == after[after.count - suffix - 1] { suffix += 1 }
            let bounded = min(suffix, shared - prefix)
            changed = NSRange(location: prefix, length: before.count - prefix - bounded)
            inserted = after.count - prefix - bounded
            let overlap = max(0, prefix + suffix - shared)
            if overlap > 0 {
                ambiguous = NSRange(location: prefix - overlap, length: changed.length + overlap)
            }
        }
        let shift = inserted - changed.length
        return tokens.compactMap { token in
            if let ambiguous, NSIntersectionRange(token.range, ambiguous).length > 0 { return nil }
            if NSIntersectionRange(token.range, changed).length > 0 { return nil }
            if changed.length == 0, inserted > 0,
               changed.location > token.range.location, changed.location < NSMaxRange(token.range) { return nil }
            var token = token
            if NSMaxRange(changed) <= token.range.location { token.range.location += shift }
            return token.valid(in: new) ? token : nil
        }
    }

    private static func nativeEdit(_ before: [UInt16], _ after: [UInt16], selection: NSRange?) -> (range: NSRange, inserted: Int)? {
        guard let selection, selection.location != NSNotFound else { return nil }
        let delta = after.count - before.count
        var candidates = [selection]
        if selection.length == 0, delta < 0 {
            candidates = [NSRange(location: selection.location + delta, length: -delta),
                          NSRange(location: selection.location, length: -delta)]
        }
        var matches: [(range: NSRange, inserted: Int)] = []
        for range in candidates {
            let inserted = delta + range.length
            guard range.location >= 0, range.length >= 0, inserted >= 0,
                  NSMaxRange(range) <= before.count, range.location + inserted <= after.count,
                  before[..<range.location].elementsEqual(after[..<range.location]),
                  before[NSMaxRange(range)...].elementsEqual(after[(range.location + inserted)...]) else { continue }
            if !matches.contains(where: { $0.range == range }) { matches.append((range, inserted)) }
        }
        return matches.count == 1 ? matches[0] : nil
    }

    static func targets(_ tokens: [Self], in draft: String, members: Set<String>) -> [String]? {
        var ids: [String] = []
        for token in tokens where token.valid(in: draft) {
            guard members.contains(token.id) else { return nil }
            if !ids.contains(token.id) { ids.append(token.id) }
        }
        return ids
    }

    private func valid(in draft: String) -> Bool {
        guard let bounds = Range(range, in: draft), draft[bounds] == text else { return false }
        return !Self.word(draft[..<bounds.lowerBound].unicodeScalars.last)
            && !Self.word(draft[bounds.upperBound...].unicodeScalars.first)
    }

    private static func word(_ scalar: Unicode.Scalar?) -> Bool {
        guard let scalar else { return false }
        switch scalar.properties.generalCategory {
        case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter,
             .decimalNumber, .letterNumber, .otherNumber: return true
        default: return scalar == "_" || scalar == "-"
        }
    }
}

#if os(iOS)
struct CameraView: UIViewControllerRepresentable {
    let capture: (URL) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraView
        init(parent: CameraView) { self.parent = parent }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            guard let image = info[.originalImage] as? UIImage, let data = image.jpegData(compressionQuality: 0.85) else { return }
            let url = FileManager.default.temporaryDirectory.appending(path: "Camera-\(UUID().uuidString.prefix(8)).jpg")
            do {
                try data.write(to: url)
                parent.capture(url)
            } catch { parent.dismiss() }
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { parent.dismiss() }
    }
}
#endif
