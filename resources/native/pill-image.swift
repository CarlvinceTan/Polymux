// Draws Polymux's Computer Use pill and writes it as a PNG.
//
// Usage: pill-image --out <path> [--dark|--light] <bundleId> [<bundleId> ...]
//
// This is AppKit rather than a hand-rolled compositor in the main process for
// one reason: it has to be the *same* picture as the mac-use / Hermes status
// item, which is itself the ChatGPT-desktop pill. Reproducing it in JavaScript
// meant reproducing NSWorkspace's icon representations, their shadows, and
// AppKit's antialiasing — three things that are free here and approximations
// there. The geometry and the drawing below are ported from mac-use's
// `StatusArtwork.compositeImage` and `MacUseStatusItemView.draw`.
//
// Electron's Tray takes an image and nothing else, so the capsule that AppKit
// draws in a custom NSView behind the status item is painted into the image.
//
// The cursor's defaults are *fitted*, not ported — the shipping Agent Surface
// build differs from the source it was read from. Each was chosen by rendering
// a grid of candidates and scoring every one against a live screenshot of the
// real pill, pixel by pixel: the glyph is flipped vertically rather than
// horizontally (the path is written in SwiftUI's y-down space and this context
// is y-up), drawn at 0.85 of the nominal 16pt, and nudged a point. The icons
// beside it score 6.4 out of 255 against the real pill. A smaller glyph scores
// lower still, but only because residual position error rewards covering less
// ground — so the size was taken from the picture rather than the number. Its
// opacity and vertical nudge were fitted the same way once `fraction:` made
// opacity reachable at all; both have a true minimum, brighter and higher both
// score worse. The cursor lands at 8.5 against the icons' 6.4. The flags remain
// so the fit can be redone if the pill changes.

import AppKit
import Foundation

struct Options {
    var out: String = ""
    var dark: Bool = true
    var bundleIds: [String] = []
    var mirror: Bool = false
    var flipV: Bool = true
    var cursorScale: CGFloat = 0.85
    var cursorAlpha: CGFloat = 1.0
    /// Grey level of the glyph, 0-1. Measured off the shipping pill.
    var cursorLevel: CGFloat = 0.898
    var cursorDX: CGFloat = -1
    var cursorDY: CGFloat = 1
    /// Measured off the shipping pill; the ported source says 0.34.
    var capsuleAlpha: CGFloat = 0.29
}

func parseOptions() -> Options {
    var options = Options()
    var arguments = CommandLine.arguments.dropFirst().makeIterator()
    while let argument = arguments.next() {
        switch argument {
        case "--out": options.out = arguments.next() ?? ""
        case "--dark": options.dark = true
        case "--light": options.dark = false
        case "--mirror": options.mirror = true
        case "--no-mirror": options.mirror = false
        case "--flip-v": options.flipV = true
        case "--no-flip-v": options.flipV = false
        case "--cursor-scale": options.cursorScale = CGFloat(Double(arguments.next() ?? "1") ?? 1)
        case "--cursor-alpha": options.cursorAlpha = CGFloat(Double(arguments.next() ?? "1") ?? 1)
        case "--cursor-level": options.cursorLevel = CGFloat(Double(arguments.next() ?? "0.898") ?? 0.898)
        case "--cursor-dx": options.cursorDX = CGFloat(Double(arguments.next() ?? "0") ?? 0)
        case "--cursor-dy": options.cursorDY = CGFloat(Double(arguments.next() ?? "0") ?? 0)
        case "--capsule-alpha": options.capsuleAlpha = CGFloat(Double(arguments.next() ?? "0.29") ?? 0.29)
        default: options.bundleIds.append(argument)
        }
    }
    return options
}

// MARK: - Geometry (StatusArtwork.compositeImage)

let iconSize: CGFloat = 17
let iconAdvance: CGFloat = 12
let leadingPadding: CGFloat = 8
let cursorGap: CGFloat = 4
let cursorSize: CGFloat = 16
let trailingPadding: CGFloat = 6
/// MacUseStatusItemView caps the capsule at 24pt; the bar gives it 22.
let capsuleHeight: CGFloat = 22

/// The agent cursor as a solid silhouette in `tint`.
///
/// `StatusArtwork` draws it black-filled and white-stroked and then repaints
/// the result with a `sourceAtop` fill. That works there, but it also puts the
/// glyph's opacity out of reach: `sourceAtop` keeps the destination's alpha,
/// and `CGContext.setAlpha` does not reach `NSImage.draw(in:)` at all — so the
/// brightness could not be dialled down, which left the cursor too white.
/// Filling *and* stroking in the tint gives the same union shape while leaving
/// opacity to `fraction:` at draw time.
func cursorImage(tint: NSColor) -> NSImage {
    NSImage(size: NSSize(width: 16, height: 16), flipped: false) { _ in
        let path = NSBezierPath()
        path.move(to: NSPoint(x: 3.04536, y: 4.45259))
        path.curve(
            to: NSPoint(x: 4.45259, y: 3.04536),
            controlPoint1: NSPoint(x: 2.75820, y: 3.60299),
            controlPoint2: NSPoint(x: 3.60299, y: 2.75820)
        )
        path.line(to: NSPoint(x: 14.1828, y: 6.33403))
        path.curve(
            to: NSPoint(x: 14.0715, y: 8.39045),
            controlPoint1: NSPoint(x: 15.1637, y: 6.66558),
            controlPoint2: NSPoint(x: 15.0872, y: 8.08006)
        )
        path.line(to: NSPoint(x: 10.2994, y: 9.54319))
        path.curve(
            to: NSPoint(x: 9.54319, y: 10.2994),
            controlPoint1: NSPoint(x: 9.93919, y: 9.65327),
            controlPoint2: NSPoint(x: 9.65327, y: 9.93919)
        )
        path.line(to: NSPoint(x: 8.39046, y: 14.0715))
        path.curve(
            to: NSPoint(x: 6.33404, y: 14.1828),
            controlPoint1: NSPoint(x: 8.08007, y: 15.0872),
            controlPoint2: NSPoint(x: 6.66558, y: 15.1637)
        )
        path.line(to: NSPoint(x: 3.04536, y: 4.45259))
        path.close()
        tint.setFill()
        path.fill()
        tint.setStroke()
        path.lineWidth = 1.25
        path.lineJoinStyle = .round
        path.stroke()
        return true
    }
}

/// The application's own icon. `NSWorkspace` carries the representation macOS
/// would draw itself, shadow and all — which is the detail a converted .icns
/// loses.
func appIcon(bundleId: String, size: CGFloat) -> NSImage? {
    let workspace = NSWorkspace.shared
    let installed = workspace.urlForApplication(withBundleIdentifier: bundleId)
    let running = workspace.runningApplications.first { $0.bundleIdentifier == bundleId }
    let source: NSImage? = installed.map { workspace.icon(forFile: $0.path) } ?? running?.icon
    guard let source else { return nil }
    let image = source.copy() as? NSImage
    image?.size = NSSize(width: size, height: size)
    return image
}

func draw(options: Options) -> NSImage {
    let apps = options.bundleIds
    let stackWidth = iconSize + (iconAdvance * CGFloat(max(0, apps.count - 1)))
    let cursorX = leadingPadding + stackWidth + cursorGap
    let width = cursorX + cursorSize + trailingPadding

    return NSImage(size: NSSize(width: width, height: capsuleHeight), flipped: false) { rect in
        NSGraphicsContext.current?.imageInterpolation = .high

        // The capsule, from MacUseStatusItemView.draw.
        if options.dark {
            NSColor.white.withAlphaComponent(options.capsuleAlpha).setFill()
        } else {
            NSColor.black.withAlphaComponent(options.capsuleAlpha * 0.44).setFill()
        }
        NSBezierPath(
            roundedRect: rect,
            xRadius: capsuleHeight / 2,
            yRadius: capsuleHeight / 2
        ).fill()

        // Back to front, so the leftmost icon ends up on top of its neighbour.
        let iconY = rect.minY + ((capsuleHeight - iconSize) / 2)
        for index in apps.indices.reversed() {
            let iconRect = NSRect(
                x: rect.minX + leadingPadding + (CGFloat(index) * iconAdvance),
                y: iconY,
                width: iconSize,
                height: iconSize
            )
            appIcon(bundleId: apps[index], size: iconSize)?.draw(
                in: iconRect,
                from: .zero,
                operation: .sourceOver,
                fraction: 1,
                respectFlipped: true,
                hints: nil
            )
        }

        let drawnCursor = cursorSize * options.cursorScale
        let cursorRect = NSRect(
            x: rect.minX + cursorX + ((cursorSize - drawnCursor) / 2) + options.cursorDX,
            y: rect.minY + ((capsuleHeight - drawnCursor) / 2) + options.cursorDY,
            width: drawnCursor,
            height: drawnCursor
        )
        // Measured, not assumed: the shipping pill's glyph core reads as a flat
        // neutral grey. A translucent white over the bluish capsule would carry
        // that blue through, and it does not — so the glyph is opaque and the
        // colour is the thing to match.
        let tint = options.dark
            ? NSColor(white: options.cursorLevel, alpha: 1)
            : NSColor(white: 1 - options.cursorLevel, alpha: 1)
        if let context = NSGraphicsContext.current?.cgContext {
            context.saveGState()
            if options.mirror || options.flipV {
                context.translateBy(x: cursorRect.midX, y: cursorRect.midY)
                context.scaleBy(x: options.mirror ? -1 : 1, y: options.flipV ? -1 : 1)
                context.translateBy(x: -cursorRect.midX, y: -cursorRect.midY)
            }
            cursorImage(tint: tint).draw(
                in: cursorRect,
                from: .zero,
                operation: .sourceOver,
                fraction: options.cursorAlpha,
                respectFlipped: true,
                hints: nil
            )
            context.restoreGState()
        }
        return true
    }
}

let options = parseOptions()
guard !options.out.isEmpty, !options.bundleIds.isEmpty else {
    FileHandle.standardError.write(
        Data("usage: pill-image --out <path> [--dark|--light] <bundleId>...\n".utf8)
    )
    exit(2)
}

let image = draw(options: options)
// Rendered at 2x so the menu bar has a retina representation to pick from.
let scale: CGFloat = 2
guard
    let representation = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: Int(image.size.width * scale),
        pixelsHigh: Int(image.size.height * scale),
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0,
        bitsPerPixel: 0
    )
else {
    FileHandle.standardError.write(Data("could not allocate bitmap\n".utf8))
    exit(1)
}
representation.size = image.size
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: representation)
image.draw(
    in: NSRect(origin: .zero, size: image.size),
    from: .zero,
    operation: .sourceOver,
    fraction: 1
)
NSGraphicsContext.restoreGraphicsState()

guard let png = representation.representation(using: .png, properties: [:]) else {
    FileHandle.standardError.write(Data("could not encode png\n".utf8))
    exit(1)
}
do {
    try png.write(to: URL(fileURLWithPath: options.out))
    // The point size, so the caller can build a NativeImage at the right scale.
    print("{\"width\":\(Int(image.size.width)),\"height\":\(Int(image.size.height))}")
} catch {
    FileHandle.standardError.write(Data("could not write \(options.out): \(error)\n".utf8))
    exit(1)
}
