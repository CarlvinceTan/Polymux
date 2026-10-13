import SwiftUI
import QuickLookThumbnailing
import UniformTypeIdentifiers
import PolymuxKit

struct AttachmentPreview: View {
    let attachment: Attachment
    let client: APIClient
    var showsName = true
    var square: CGFloat? = nil
    /// The composer's file while the upload is in flight; rendered without a server round trip.
    var localURL: URL? = nil
    /// 0...1 while uploading. Shows the per-file ring; nil hides it.
    var progress: Double? = nil
    @Environment(\.displayScale) private var displayScale
    @State private var thumbnail: CGImage?
    @State private var loading = false

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Group {
                if localURL != nil {
                    if let thumbnail {
                        Image(decorative: thumbnail, scale: displayScale)
                            .resizable().aspectRatio(contentMode: square == nil ? .fit : .fill)
                    } else {
                        fallback
                    }
                } else if let imageURL {
                    LocalImage(url: imageURL) { phase in
                        switch phase {
                        case .success(let image): image.resizable().aspectRatio(contentMode: square == nil ? .fit : .fill)
                        case .empty: placeholder
                        case .failure: fallback
                        @unknown default: fallback
                        }
                    }
                } else if let thumbnail {
                    Image(decorative: thumbnail, scale: displayScale)
                        .resizable().aspectRatio(contentMode: square == nil ? .fit : .fill)
                } else if loading {
                    placeholder
                } else {
                    fallback
                }
            }
            .frame(width: square, height: square)
            .frame(maxWidth: square ?? 160, maxHeight: square ?? 140)
            .clipShape(.rect(cornerRadius: 8))
            .overlay(alignment: .bottomTrailing) {
                if let progress { UploadRing(progress: progress) }
            }
            if showsName {
                Text(attachment.name)
                    .font(.caption2).foregroundStyle(.secondary)
                    .lineLimit(1).truncationMode(.middle)
                    .frame(maxWidth: 160, alignment: .leading)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(attachment.name)
        .task(id: attachment.id) { await loadThumbnail() }
    }

    private var imageURL: URL? {
        if attachment.kind == "image" {
            return client.resolve(attachment.thumbnailURL ?? attachment.url)
        }
        if attachment.kind == "video", let poster = attachment.thumbnailURL, !poster.isEmpty {
            return client.resolve(poster)
        }
        return nil
    }

    private var placeholder: some View {
        ProgressView().controlSize(.small).frame(width: square ?? 100, height: square ?? 100)
    }

    private var fallback: some View {
        Image(systemName: symbol)
            .font(.system(size: 32, weight: .light)).foregroundStyle(.secondary)
            .frame(width: square ?? 100, height: square ?? 100)
            .background(.quaternary.opacity(0.45))
    }

    private var symbol: String {
        if attachment.kind == "image" { return "photo" }
        if attachment.kind == "video" { return "film" }
        if attachment.kind == "audio" { return "waveform" }
        let kind = UTType(mimeType: attachment.mimeType) ?? UTType(filenameExtension: (attachment.name as NSString).pathExtension)
        if kind?.conforms(to: .pdf) == true { return "doc.richtext" }
        if kind?.conforms(to: .html) == true { return "globe" }
        if ["ics", "ical"].contains((attachment.name as NSString).pathExtension.lowercased()) { return "calendar" }
        return "doc"
    }

    private func loadThumbnail() async {
        guard !Task.isCancelled else { return }
        thumbnail = nil
        loading = false
        let file: URL
        if let localURL {
            file = localURL
        } else {
            guard imageURL == nil, let url = client.resolve(attachment.url) else { return }
            guard let cached = try? await MediaCache.shared.file(url: url, name: attachment.name) else { return }
            file = cached
        }
        guard !Task.isCancelled else { return }
        loading = true
        do {
            let request = QLThumbnailGenerator.Request(fileAt: file, size: CGSize(width: 160, height: 140), scale: displayScale, representationTypes: .all)
            let representation = try await QLThumbnailGenerator.shared.generateBestRepresentation(for: request)
            try Task.checkCancellation()
            thumbnail = representation.cgImage
            loading = false
        } catch {
            guard !Task.isCancelled else { return }
            loading = false
        }
    }
}

/// The small per-file upload ring the composer's bubble shows.
private struct UploadRing: View {
    let progress: Double

    var body: some View {
        ZStack {
            Circle().stroke(.quaternary, lineWidth: 2.5)
            Circle()
                .trim(from: 0, to: max(0.06, min(1, progress)))
                .stroke(Color.accentColor, style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
                .rotationEffect(.degrees(-90))
        }
        .frame(width: 18, height: 18)
        .padding(4)
        .background(.thinMaterial, in: Circle())
        .padding(5)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Uploading")
        .accessibilityValue("\(Int((min(1, max(0, progress)) * 100).rounded())) percent")
    }
}

struct LocalImage<Content: View>: View {
    let url: URL?
    @ViewBuilder let content: (AsyncImagePhase) -> Content
    @State private var phase = AsyncImagePhase.empty

    var body: some View {
        content(phase).task(id: url) {
            phase = .empty
            guard let url else { return }
            do {
                let file = try await MediaCache.shared.file(url: url, name: "preview")
                #if os(macOS)
                guard let image = NSImage(contentsOf: file) else { throw URLError(.cannotDecodeContentData) }
                phase = .success(Image(nsImage: image))
                #else
                guard let image = UIImage(contentsOfFile: file.path) else { throw URLError(.cannotDecodeContentData) }
                phase = .success(Image(uiImage: image))
                #endif
            } catch { phase = .failure(error) }
        }
    }
}
