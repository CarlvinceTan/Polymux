import AVFoundation
import CoreMedia
import Foundation
import ImageIO
import UniformTypeIdentifiers

enum PrepareError: Error, CustomStringConvertible {
    case invalidArguments
    case missingTrack(String)
    case readerFailed(String)
    case thumbnailFailed

    var description: String {
        switch self {
        case .invalidArguments:
            return "usage: wechat-media-prepare <voice|video> <input> <output>"
        case .missingTrack(let kind):
            return "the input has no \(kind) track"
        case .readerFailed(let reason):
            return "media decoding failed: \(reason)"
        case .thumbnailFailed:
            return "video thumbnail encoding failed"
        }
    }
}

func durationSeconds(_ asset: AVAsset) -> Double {
    let seconds = CMTimeGetSeconds(asset.duration)
    return seconds.isFinite && seconds > 0 ? seconds : 0
}

func emit(_ payload: [String: Any]) throws {
    let data = try JSONSerialization.data(withJSONObject: payload, options: [])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0a]))
}

func prepareVoice(input: URL, output: URL) throws {
    let asset = AVURLAsset(url: input)
    guard let track = asset.tracks(withMediaType: .audio).first else {
        throw PrepareError.missingTrack("audio")
    }
    let reader = try AVAssetReader(asset: asset)
    let settings: [String: Any] = [
        AVFormatIDKey: kAudioFormatLinearPCM,
        AVSampleRateKey: 24_000.0,
        AVNumberOfChannelsKey: 1,
        AVLinearPCMBitDepthKey: 16,
        AVLinearPCMIsFloatKey: false,
        AVLinearPCMIsBigEndianKey: false,
        AVLinearPCMIsNonInterleaved: false,
    ]
    let decoded = AVAssetReaderTrackOutput(track: track, outputSettings: settings)
    decoded.alwaysCopiesSampleData = false
    guard reader.canAdd(decoded) else {
        throw PrepareError.readerFailed("audio output is unsupported")
    }
    reader.add(decoded)
    FileManager.default.createFile(atPath: output.path, contents: nil)
    let handle = try FileHandle(forWritingTo: output)
    defer { try? handle.close() }
    guard reader.startReading() else {
        throw PrepareError.readerFailed(reader.error?.localizedDescription ?? "reader did not start")
    }
    while let sample = decoded.copyNextSampleBuffer() {
        guard let block = CMSampleBufferGetDataBuffer(sample) else { continue }
        let length = CMBlockBufferGetDataLength(block)
        if length == 0 { continue }
        var bytes = Data(count: length)
        let result = bytes.withUnsafeMutableBytes { storage in
            CMBlockBufferCopyDataBytes(
                block,
                atOffset: 0,
                dataLength: length,
                destination: storage.baseAddress!
            )
        }
        guard result == kCMBlockBufferNoErr else {
            throw PrepareError.readerFailed("audio buffer copy returned \(result)")
        }
        try handle.write(contentsOf: bytes)
    }
    guard reader.status == .completed else {
        throw PrepareError.readerFailed(reader.error?.localizedDescription ?? "reader stopped early")
    }
    try emit([
        "durationMs": max(1, Int((durationSeconds(asset) * 1_000).rounded())),
        "sampleRate": 24_000,
    ])
}

func prepareVideo(input: URL, output: URL) throws {
    let asset = AVURLAsset(url: input)
    guard !asset.tracks(withMediaType: .video).isEmpty else {
        throw PrepareError.missingTrack("video")
    }
    let duration = durationSeconds(asset)
    let generator = AVAssetImageGenerator(asset: asset)
    generator.appliesPreferredTrackTransform = true
    generator.maximumSize = CGSize(width: 320, height: 320)
    let requested = CMTime(seconds: min(0.1, max(0, duration / 2)), preferredTimescale: 600)
    let image = try generator.copyCGImage(at: requested, actualTime: nil)
    guard let destination = CGImageDestinationCreateWithURL(
        output as CFURL,
        UTType.jpeg.identifier as CFString,
        1,
        nil
    ) else {
        throw PrepareError.thumbnailFailed
    }
    CGImageDestinationAddImage(
        destination,
        image,
        [kCGImageDestinationLossyCompressionQuality: 0.82] as CFDictionary
    )
    guard CGImageDestinationFinalize(destination) else {
        throw PrepareError.thumbnailFailed
    }
    try emit(["durationSeconds": max(1, Int(ceil(duration)))])
}

do {
    guard CommandLine.arguments.count == 4 else { throw PrepareError.invalidArguments }
    let action = CommandLine.arguments[1]
    let input = URL(fileURLWithPath: CommandLine.arguments[2])
    let output = URL(fileURLWithPath: CommandLine.arguments[3])
    switch action {
    case "voice": try prepareVoice(input: input, output: output)
    case "video": try prepareVideo(input: input, output: output)
    default: throw PrepareError.invalidArguments
    }
} catch {
    FileHandle.standardError.write(Data("\(error)\n".utf8))
    exit(1)
}
