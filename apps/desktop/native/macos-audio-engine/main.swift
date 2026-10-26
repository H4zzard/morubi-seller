import AudioToolbox
import CoreMedia
import Foundation
import ScreenCaptureKit

private struct ProbeResult: Encodable {
    let type: String
    let method: String
    let sampleRate: Int
    let channels: Int
    let sampleBuffers: Int
    let sampleFrames: Int64
    let audioBytesObserved: Int64
    let nonSilentBuffers: Int
    let peakLevel: Double
    let averageRms: Double
    let videoBuffers: Int
    let elapsedMs: Int
}

private struct ProbeFailure: Encodable {
    let type: String
    let code: String
    let message: String
}

private struct HelperCommand: Decodable {
    let type: String
    let token: String
}

private struct HelperReady: Encodable {
    let type: String
    let method: String
    let sessionId: String
}

private struct AudioChunk: Encodable {
    let type: String
    let sessionId: String
    let sequence: Int
    let capturedAt: String
    let durationMs: Int
    let mimeType: String
    let signalLevel: Double
    let data: String
}

@available(macOS 13.0, *)
private final class AudioMetrics: NSObject, SCStreamOutput, SCStreamDelegate {
    private let lock = NSLock()
    private var startedAt = Date()
    private var sampleBuffers = 0
    private var sampleFrames: Int64 = 0
    private var audioBytesObserved: Int64 = 0
    private var nonSilentBuffers = 0
    private var peakLevel = 0.0
    private var rmsTotal = 0.0
    private var rmsCount = 0
    private var videoBuffers = 0
    private var streamFailure: Error?
    private var chunkData = Data()
    private var chunkFrames = 0
    private var chunkSequence = 0
    private let chunkSessionId: String?
    private let chunkHandler: ((AudioChunk) -> Void)?

    init(chunkSessionId: String? = nil, chunkHandler: ((AudioChunk) -> Void)? = nil) {
        self.chunkSessionId = chunkSessionId
        self.chunkHandler = chunkHandler
    }

    func begin() {
        lock.withLock {
            startedAt = Date()
        }
    }

    func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of outputType: SCStreamOutputType
    ) {
        guard sampleBuffer.isValid, CMSampleBufferDataIsReady(sampleBuffer) else { return }
        guard outputType == .audio else {
            lock.withLock { videoBuffers += 1 }
            return
        }

        let frames = CMSampleBufferGetNumSamples(sampleBuffer)
        guard frames > 0 else { return }

        var requiredSize = 0
        var blockBuffer: CMBlockBuffer?
        var status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer,
            bufferListSizeNeededOut: &requiredSize,
            bufferListOut: nil,
            bufferListSize: 0,
            blockBufferAllocator: nil,
            blockBufferMemoryAllocator: nil,
            flags: UInt32(kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment),
            blockBufferOut: &blockBuffer
        )
        guard status == noErr, requiredSize >= MemoryLayout<AudioBufferList>.size else { return }

        let rawList = UnsafeMutableRawPointer.allocate(
            byteCount: requiredSize,
            alignment: MemoryLayout<AudioBufferList>.alignment
        )
        defer { rawList.deallocate() }
        let list = rawList.assumingMemoryBound(to: AudioBufferList.self)
        status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer,
            bufferListSizeNeededOut: nil,
            bufferListOut: list,
            bufferListSize: requiredSize,
            blockBufferAllocator: nil,
            blockBufferMemoryAllocator: nil,
            flags: UInt32(kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment),
            blockBufferOut: &blockBuffer
        )
        guard status == noErr else { return }

        let format = CMSampleBufferGetFormatDescription(sampleBuffer)
            .flatMap { CMAudioFormatDescriptionGetStreamBasicDescription($0)?.pointee }
        var bytes = 0
        var squaredTotal = 0.0
        var valueCount = 0
        var localPeak = 0.0
        var observedData = Data()

        for buffer in UnsafeMutableAudioBufferListPointer(list) {
            bytes += Int(buffer.mDataByteSize)
            guard let data = buffer.mData, let format else { continue }
            let byteCount = Int(buffer.mDataByteSize)
            if chunkHandler != nil { observedData.append(data.assumingMemoryBound(to: UInt8.self), count: byteCount) }
            if format.mFormatID == kAudioFormatLinearPCM,
               format.mFormatFlags & kAudioFormatFlagIsFloat != 0,
               format.mBitsPerChannel == 32 {
                let samples = data.bindMemory(to: Float.self, capacity: byteCount / MemoryLayout<Float>.size)
                for index in 0..<(byteCount / MemoryLayout<Float>.size) {
                    let value = min(1.0, abs(Double(samples[index])))
                    localPeak = max(localPeak, value)
                    squaredTotal += value * value
                    valueCount += 1
                }
            } else if format.mFormatID == kAudioFormatLinearPCM,
                      format.mFormatFlags & kAudioFormatFlagIsSignedInteger != 0,
                      format.mBitsPerChannel == 16 {
                let samples = data.bindMemory(to: Int16.self, capacity: byteCount / MemoryLayout<Int16>.size)
                for index in 0..<(byteCount / MemoryLayout<Int16>.size) {
                    let value = min(1.0, abs(Double(samples[index])) / Double(Int16.max))
                    localPeak = max(localPeak, value)
                    squaredTotal += value * value
                    valueCount += 1
                }
            }
        }

        let rms = valueCount > 0 ? sqrt(squaredTotal / Double(valueCount)) : 0
        lock.withLock {
            sampleBuffers += 1
            sampleFrames += Int64(frames)
            audioBytesObserved += Int64(bytes)
            if localPeak > 0.000_1 { nonSilentBuffers += 1 }
            peakLevel = max(peakLevel, localPeak)
            rmsTotal += rms
            rmsCount += 1
            if chunkHandler != nil {
                chunkData.append(observedData)
                chunkFrames += frames
                emitChunkIfReady(signalLevel: localPeak, force: false)
            }
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        lock.withLock { streamFailure = error }
    }

    func failure() -> Error? {
        lock.withLock { streamFailure }
    }

    func result(sampleRate: Int, channels: Int) -> ProbeResult {
        lock.withLock {
            ProbeResult(
                type: "result",
                method: "MACOS_SCREEN_CAPTURE_KIT",
                sampleRate: sampleRate,
                channels: channels,
                sampleBuffers: sampleBuffers,
                sampleFrames: sampleFrames,
                audioBytesObserved: audioBytesObserved,
                nonSilentBuffers: nonSilentBuffers,
                peakLevel: peakLevel,
                averageRms: rmsCount > 0 ? rmsTotal / Double(rmsCount) : 0,
                videoBuffers: videoBuffers,
                elapsedMs: Int(Date().timeIntervalSince(startedAt) * 1_000)
            )
        }
    }

    func flushChunk() {
        lock.withLock { emitChunkIfReady(signalLevel: peakLevel, force: true) }
    }

    private func emitChunkIfReady(signalLevel: Double, force: Bool) {
        let sampleRate = 48_000
        guard let chunkHandler, let chunkSessionId else { return }
        guard chunkFrames >= sampleRate || (force && chunkFrames > 0) else { return }
        let durationMs = max(1, Int((Double(chunkFrames) / Double(sampleRate)) * 1_000))
        let formatter = ISO8601DateFormatter()
        let chunk = AudioChunk(
            type: "chunk",
            sessionId: chunkSessionId,
            sequence: chunkSequence,
            capturedAt: formatter.string(from: Date()),
            durationMs: durationMs,
            mimeType: "audio/x-morubi-pcm;format=f32le;rate=48000;channels=2",
            signalLevel: signalLevel,
            data: chunkData.base64EncodedString()
        )
        chunkSequence += 1
        chunkFrames = 0
        chunkData.removeAll(keepingCapacity: true)
        chunkHandler(chunk)
    }
}

private extension NSLock {
    func withLock<T>(_ operation: () -> T) -> T {
        lock()
        defer { unlock() }
        return operation()
    }
}

private func emit<T: Encodable>(_ value: T, to handle: FileHandle) {
    let encoder = JSONEncoder()
    guard let data = try? encoder.encode(value) else { return }
    handle.write(data)
    handle.write(Data([0x0A]))
}

private func decodeCommand(_ line: String) -> HelperCommand? {
    guard let data = line.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(HelperCommand.self, from: data)
}

@available(macOS 13.0, *)
private func makeStream(metrics: AudioMetrics) async throws -> SCStream {
    let content = try await SCShareableContent.excludingDesktopWindows(
        false,
        onScreenWindowsOnly: false
    )
    guard let display = content.displays.first else {
        throw NSError(
            domain: "com.morubi.audio-engine",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "Nenhum display capturável foi encontrado."]
        )
    }

    let currentApplication = content.applications.first { $0.processID == ProcessInfo.processInfo.processIdentifier }
    let filter = SCContentFilter(
        display: display,
        excludingApplications: currentApplication.map { [$0] } ?? [],
        exceptingWindows: []
    )
    let configuration = SCStreamConfiguration()
    configuration.width = 2
    configuration.height = 2
    configuration.minimumFrameInterval = CMTime(seconds: 1, preferredTimescale: 1)
    configuration.queueDepth = 3
    configuration.showsCursor = false
    configuration.capturesAudio = true
    configuration.sampleRate = 48_000
    configuration.channelCount = 2
    configuration.excludesCurrentProcessAudio = true

    let stream = SCStream(filter: filter, configuration: configuration, delegate: metrics)
    let queue = DispatchQueue(label: "com.morubi.audio-engine.system-audio", qos: .userInitiated)
    try stream.addStreamOutput(metrics, type: .audio, sampleHandlerQueue: queue)
    return stream
}

@available(macOS 13.0, *)
private func runProbe(durationSeconds: Double) async throws -> ProbeResult {
    let sampleRate = 48_000
    let channels = 2
    let metrics = AudioMetrics()
    let stream = try await makeStream(metrics: metrics)
    metrics.begin()
    try await stream.startCapture()
    try await Task.sleep(nanoseconds: UInt64(durationSeconds * 1_000_000_000))
    try await stream.stopCapture()
    if let failure = metrics.failure() { throw failure }
    return metrics.result(sampleRate: sampleRate, channels: channels)
}

@available(macOS 13.0, *)
private func runStream() async throws {
    let environment = ProcessInfo.processInfo.environment
    guard let expectedToken = environment["MORUBI_AUDIO_HELPER_TOKEN"],
          expectedToken.count == 64,
          let sessionId = environment["MORUBI_AUDIO_SESSION_ID"],
          !sessionId.isEmpty,
          sessionId.count <= 128,
          let firstLine = readLine(),
          let authentication = decodeCommand(firstLine),
          authentication.type == "authenticate",
          authentication.token == expectedToken else {
        throw NSError(
            domain: "com.morubi.audio-engine",
            code: 2,
            userInfo: [NSLocalizedDescriptionKey: "Falha de autenticação do processo pai."]
        )
    }

    let metrics = AudioMetrics(chunkSessionId: sessionId) { chunk in
        emit(chunk, to: .standardOutput)
    }
    let stream = try await makeStream(metrics: metrics)
    metrics.begin()
    try await stream.startCapture()
    emit(
        HelperReady(type: "ready", method: "MACOS_SCREEN_CAPTURE_KIT", sessionId: sessionId),
        to: .standardOutput
    )

    while let line = readLine() {
        guard let command = decodeCommand(line), command.token == expectedToken else { continue }
        if command.type == "stop" { break }
    }
    try await stream.stopCapture()
    metrics.flushChunk()
    if let failure = metrics.failure() { throw failure }
}

@main
private struct MorubiAudioEngine {
    static func main() async {
        let streamMode = CommandLine.arguments.contains("--stream")
        let durationIndex = CommandLine.arguments.firstIndex(of: "--duration")
        let duration = durationIndex
            .flatMap { index in CommandLine.arguments.indices.contains(index + 1) ? CommandLine.arguments[index + 1] : nil }
            .flatMap(Double.init) ?? 5
        guard duration >= 1, duration <= 30 else {
            emit(
                ProbeFailure(type: "error", code: "DURATION_INVALID", message: "A duração deve ficar entre 1 e 30 segundos."),
                to: .standardError
            )
            Foundation.exit(2)
        }
        guard #available(macOS 13.0, *) else {
            emit(
                ProbeFailure(
                    type: "error",
                    code: "MACOS_NATIVE_SYSTEM_AUDIO_UNSUPPORTED",
                    message: "A captura nativa de áudio exige macOS 13 ou superior."
                ),
                to: .standardError
            )
            Foundation.exit(3)
        }
        do {
            if streamMode { try await runStream() }
            else { emit(try await runProbe(durationSeconds: duration), to: .standardOutput) }
        } catch {
            let nsError = error as NSError
            emit(
                ProbeFailure(
                    type: "error",
                    code: "MACOS_NATIVE_SYSTEM_AUDIO_FAILED",
                    message: "\(nsError.domain):\(nsError.code): \(nsError.localizedDescription)"
                ),
                to: .standardError
            )
            Foundation.exit(1)
        }
    }
}
