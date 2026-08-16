import AVFoundation
import Foundation

/// The tone a cross-check sounds when it first falls due.
///
/// Two short 880 Hz pulses, the same as the browser version played through the Web Audio
/// API — and, like it, on the ambient category, so the ring/silent switch still governs it
/// and it mixes with anything else the crew is listening to rather than interrupting it.
/// Changing `.ambient` to `.playback` below would make it sound through the silent switch.
enum Alarm {

    private static var player: AVAudioPlayer?
    private static var sessionReady = false

    static func play() {
        prepareSession()
        do {
            let player = try AVAudioPlayer(data: tone)
            player.volume = 0.6
            player.prepareToPlay()
            player.play()
            // Held for the length of the sound, or it is deallocated mid-beep.
            self.player = player
        } catch {
            // A device that cannot sound the alert still shows it in red on the row.
        }
    }

    private static func prepareSession() {
        guard !sessionReady else { return }
        sessionReady = true
        try? AVAudioSession.sharedInstance().setCategory(.ambient, options: [.mixWithOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
    }

    /// A 16-bit mono WAV built once: two 300 ms pulses with a 50 ms gap, each shaped at
    /// the ends so it does not click.
    private static let tone: Data = {
        let rate = 44100.0
        let frequency = 880.0
        let pulse = 0.30
        let gap = 0.05
        let total = pulse * 2 + gap
        let frameCount = Int(rate * total)

        var samples = [Int16](repeating: 0, count: frameCount)
        for i in 0..<frameCount {
            let t = Double(i) / rate
            // Which pulse are we in, if any?
            var within: Double?
            if t < pulse { within = t }
            else if t >= pulse + gap { within = t - pulse - gap }
            guard let u = within, u < pulse else { continue }

            let attack = 0.03, release = 0.08
            var envelope = 1.0
            if u < attack { envelope = u / attack }
            else if u > pulse - release { envelope = max(0, (pulse - u) / release) }

            let value = sin(2 * .pi * frequency * t) * envelope * 0.8
            samples[i] = Int16(max(-1, min(1, value)) * 32767)
        }

        var data = Data()
        func append32(_ v: UInt32) { withUnsafeBytes(of: v.littleEndian) { data.append(contentsOf: $0) } }
        func append16(_ v: UInt16) { withUnsafeBytes(of: v.littleEndian) { data.append(contentsOf: $0) } }

        let payload = UInt32(samples.count * 2)
        data.append(contentsOf: Array("RIFF".utf8))
        append32(36 + payload)
        data.append(contentsOf: Array("WAVEfmt ".utf8))
        append32(16)                        // PCM header length
        append16(1)                         // PCM
        append16(1)                         // mono
        append32(UInt32(rate))
        append32(UInt32(rate) * 2)          // byte rate
        append16(2)                         // block align
        append16(16)                        // bits per sample
        data.append(contentsOf: Array("data".utf8))
        append32(payload)
        samples.withUnsafeBufferPointer { data.append(contentsOf: Data(buffer: $0)) }
        return data
    }()
}
