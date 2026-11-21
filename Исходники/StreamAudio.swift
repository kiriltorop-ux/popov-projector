import AVFoundation

/// A hot output engine and a bounded queue on one PCM sample clock.
final class StreamAudio {
    private let engine = AVAudioEngine()
    private let node = AVAudioPlayerNode()
    private let format = AVAudioFormat(standardFormatWithSampleRate:22050,channels:1)!
    private var generation = 0
    private var nextSample: Int64 = 0
    private(set) var underruns = 0
    private var segments: [(index:Int, start:Int64, end:Int64, track:SpeechTrack)] = []
    var completed: ((Int, Bool) -> Void)?

    init() {
        engine.attach(node)
        engine.connect(node,to:engine.mainMixerNode,format:format)
        if ProcessInfo.processInfo.environment["POPOV_QA_MUTE"] == "1" { node.volume = 0 }
    }

    func warm() throws {
        if !engine.isRunning { engine.prepare(); try engine.start() }
    }

    func clear() {
        generation += 1
        node.stop()
        segments.removeAll(keepingCapacity:true)
        nextSample = 0
        underruns = 0
    }

    private var clock: Int64 {
        guard let stamp = node.lastRenderTime, let time = node.playerTime(forNodeTime:stamp) else { return 0 }
        return max(0,time.sampleTime)
    }

    func face() -> (Int,SpeechTrack,Double)? {
        let now = clock
        guard let s = segments.first(where: { $0.start <= now && now < $0.end }) else { return nil }
        return (s.index,s.track,Double(now-s.start)/format.sampleRate)
    }

    func append(_ pcm:Data, track:SpeechTrack, index:Int, last:Bool) throws {
        try warm()
        let frames = pcm.count/2
        guard frames > 0, pcm.count == frames*2,
              let buffer = AVAudioPCMBuffer(pcmFormat:format,frameCapacity:AVAudioFrameCount(frames)),
              let channel = buffer.floatChannelData?[0] else { throw CocoaError(.fileReadCorruptFile) }
        pcm.withUnsafeBytes { data in
            let input = data.bindMemory(to:Int16.self)
            for i in 0..<frames { channel[i] = Float(input[i])/32768 }
        }
        buffer.frameLength = AVAudioFrameCount(frames)
        let now = clock
        if index > 0 && now > nextSample { underruns += 1; nextSample = now }
        segments.append((index,nextSample,nextSample+Int64(frames),track))
        nextSample += Int64(frames)
        let epoch = generation
        node.scheduleBuffer(buffer,completionCallbackType:.dataPlayedBack) { [weak self] _ in
            DispatchQueue.main.async {
                guard let self = self, self.generation == epoch else { return }
                self.segments.removeAll { $0.index <= index }
                self.completed?(index,last)
            }
        }
        if !node.isPlaying { node.play() }
    }
}
