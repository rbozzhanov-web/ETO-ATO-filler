import Foundation

/// DEFLATE (RFC 1951) and its zlib wrapper (RFC 1950).
///
/// The browser version handed this to `DecompressionStream('deflate')`. Apple ships an
/// equivalent in the Compression framework, but writing it out keeps OFPKit free of any
/// platform framework, which is what lets the whole parsing half of the app be built and
/// tested away from a Mac. It is also the same "no dependencies" bargain the original
/// made: the PDF engine owes nothing to anything.
public enum InflateError: Error, CustomStringConvertible {
    case truncated
    case badBlockType
    case badStoredLength
    case incompleteCode
    case badSymbol
    case badDistance

    public var description: String {
        switch self {
        case .truncated:       return "compressed stream ended early"
        case .badBlockType:    return "invalid deflate block type"
        case .badStoredLength: return "corrupt stored block"
        case .incompleteCode:  return "incomplete Huffman code"
        case .badSymbol:       return "invalid Huffman symbol"
        case .badDistance:     return "distance runs before the start of the output"
        }
    }
}

public enum Inflate {

    /// Inflate a PDF `FlateDecode` stream. The wrapper is detected rather than assumed:
    /// the format says zlib, but producers do emit bare deflate, and sniffing costs two
    /// bytes.
    public static func decode(_ src: [UInt8]) throws -> [UInt8] {
        var start = 0
        if src.count >= 2 {
            let cmf = UInt16(src[0]), flg = UInt16(src[1])
            let looksZlib = (cmf & 0x0F) == 8 && (cmf << 8 | flg) % 31 == 0
            if looksZlib { start = 2 }
        }
        do {
            return try raw(src, from: start)
        } catch where start == 2 {
            // A stream whose first two bytes happen to pass the zlib check but which is
            // really raw deflate: rare, cheap to rule out, and a hard failure otherwise.
            return try raw(src, from: 0)
        }
    }

    // MARK: - Canonical Huffman decoding

    /// A decoding table in the shape puff.c uses — the count of codes at each bit length
    /// plus the symbols in canonical order — with a 9-bit lookup in front of it. Nearly
    /// every code in a real stream is 9 bits or shorter, so the table answers first and
    /// the bit-at-a-time walk only handles the long tail.
    private struct Huffman {
        static let fastBits = 9

        var counts = [Int](repeating: 0, count: 16)
        var symbols: [Int]
        /// symbol << 4 | length, or 0 when no code of ≤ 9 bits matches this prefix.
        var fast = [UInt16](repeating: 0, count: 1 << Huffman.fastBits)

        init(lengths: [Int]) {
            for l in lengths where l > 0 { counts[l] += 1 }

            var offsets = [Int](repeating: 0, count: 16)
            for l in 1..<15 { offsets[l + 1] = offsets[l] + counts[l] }
            symbols = [Int](repeating: 0, count: lengths.count)
            for (sym, l) in lengths.enumerated() where l > 0 {
                symbols[offsets[l]] = sym
                offsets[l] += 1
            }

            // Walk the canonical codes and spread each short one over every fast-table
            // slot that starts with it. Codes are MSB-first; the bit reader delivers
            // LSB-first, so the index is the code reversed.
            var code = 0, index = 0
            for len in 1...Huffman.fastBits {
                for k in 0..<counts[len] {
                    let sym = symbols[index + k]
                    let rev = Self.reverse(code + k, bits: len)
                    var slot = rev
                    while slot < (1 << Huffman.fastBits) {
                        fast[slot] = UInt16(sym << 4 | len)
                        slot += 1 << len
                    }
                }
                index += counts[len]
                code = (code + counts[len]) << 1
            }
        }

        private static func reverse(_ value: Int, bits: Int) -> Int {
            var v = value, r = 0
            for _ in 0..<bits { r = r << 1 | (v & 1); v >>= 1 }
            return r
        }
    }

    // MARK: - Bit reader

    private struct BitReader {
        let src: [UInt8]
        var pos: Int
        var bitBuf: UInt32 = 0
        var bitCount: Int = 0

        init(_ src: [UInt8], from: Int) { self.src = src; self.pos = from }

        @inline(__always)
        mutating func fill(_ want: Int) {
            while bitCount < want {
                let byte: UInt32 = pos < src.count ? UInt32(src[pos]) : 0
                pos += 1
                bitBuf |= byte << UInt32(bitCount)
                bitCount += 8
            }
        }

        /// True once the reader has run past the end and is feeding zeroes. Checked at
        /// block boundaries so a truncated stream fails instead of looping.
        @inline(__always)
        var exhausted: Bool { pos > src.count }

        @inline(__always)
        mutating func bits(_ n: Int) -> Int {
            guard n > 0 else { return 0 }
            fill(n)
            let v = Int(bitBuf & ((1 << UInt32(n)) - 1))
            bitBuf >>= UInt32(n)
            bitCount -= n
            return v
        }

        @inline(__always)
        mutating func alignToByte() {
            let drop = bitCount % 8
            bitBuf >>= UInt32(drop)
            bitCount -= drop
        }

        @inline(__always)
        mutating func decode(_ h: Huffman) throws -> Int {
            fill(Huffman.fastBits)
            let entry = h.fast[Int(bitBuf) & ((1 << Huffman.fastBits) - 1)]
            if entry != 0 {
                let len = Int(entry & 0xF)
                bitBuf >>= UInt32(len)
                bitCount -= len
                return Int(entry >> 4)
            }
            // Longer than the fast table: walk it a bit at a time.
            var code = 0, first = 0, index = 0
            for len in 1...15 {
                code |= bits(1)
                let count = h.counts[len]
                let slot = code - first
                // `slot` is only meaningful when it is inside this length's run of
                // canonical codes. Corrupt input reaches here with `first` past `code`,
                // and taking that as a hit indexes the symbol table backwards.
                if slot >= 0 && slot < count {
                    let at = index + slot
                    guard at < h.symbols.count else { throw InflateError.badSymbol }
                    return h.symbols[at]
                }
                index += count
                first = (first + count) << 1
                code <<= 1
            }
            throw InflateError.incompleteCode
        }
    }

    // MARK: - Length / distance tables (RFC 1951 §3.2.5)

    private static let lengthBase = [
        3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31,
        35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258
    ]
    private static let lengthExtra = [
        0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2,
        3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0
    ]
    private static let distBase = [
        1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193,
        257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577
    ]
    private static let distExtra = [
        0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6,
        7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13
    ]
    private static let codeLengthOrder = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]

    private static let fixedLiteral: Huffman = {
        var lengths = [Int](repeating: 8, count: 288)
        for i in 144..<256 { lengths[i] = 9 }
        for i in 256..<280 { lengths[i] = 7 }
        return Huffman(lengths: lengths)
    }()
    private static let fixedDistance = Huffman(lengths: [Int](repeating: 5, count: 30))

    // MARK: - Main loop

    static func raw(_ src: [UInt8], from: Int) throws -> [UInt8] {
        var r = BitReader(src, from: from)
        var out = [UInt8]()
        out.reserveCapacity(max(1024, (src.count - from) * 4))

        while true {
            if r.exhausted { throw InflateError.truncated }
            let final = r.bits(1)
            let type = r.bits(2)

            switch type {
            case 0:
                r.alignToByte()
                let len = r.bits(16)
                let nlen = r.bits(16)
                guard len == (~nlen & 0xFFFF) else { throw InflateError.badStoredLength }
                guard r.pos - (r.bitCount / 8) + len <= src.count else { throw InflateError.truncated }
                // Whatever the bit buffer still holds is whole bytes after the align.
                for _ in 0..<len { out.append(UInt8(r.bits(8))) }

            case 1:
                try block(&r, &out, literal: fixedLiteral, distance: fixedDistance)

            case 2:
                let hlit = r.bits(5) + 257
                let hdist = r.bits(5) + 1
                let hclen = r.bits(4) + 4

                var clLengths = [Int](repeating: 0, count: 19)
                for i in 0..<hclen { clLengths[codeLengthOrder[i]] = r.bits(3) }
                let clTree = Huffman(lengths: clLengths)

                var lengths = [Int]()
                lengths.reserveCapacity(hlit + hdist)
                while lengths.count < hlit + hdist {
                    let sym = try r.decode(clTree)
                    switch sym {
                    case 0..<16:
                        lengths.append(sym)
                    case 16:
                        guard let prev = lengths.last else { throw InflateError.badSymbol }
                        for _ in 0..<(r.bits(2) + 3) { lengths.append(prev) }
                    case 17:
                        for _ in 0..<(r.bits(3) + 3) { lengths.append(0) }
                    case 18:
                        for _ in 0..<(r.bits(7) + 11) { lengths.append(0) }
                    default:
                        throw InflateError.badSymbol
                    }
                }
                guard lengths.count == hlit + hdist else { throw InflateError.badSymbol }

                let lit = Huffman(lengths: Array(lengths[0..<hlit]))
                let dist = Huffman(lengths: Array(lengths[hlit...]))
                try block(&r, &out, literal: lit, distance: dist)

            default:
                throw InflateError.badBlockType
            }

            if final == 1 { break }
        }

        // Past the end, the reader invents zero bits, and those can happen to decode to a
        // valid end-of-block — which would hand back a silently truncated plan instead of
        // an error. So the finished stream is checked against how much input really
        // existed. Bytes pulled into the bit buffer but never consumed do not count: a
        // nine-bit lookahead legitimately reads ahead of the last code.
        let consumed = r.pos - (r.bitCount / 8)
        guard consumed <= src.count else { throw InflateError.truncated }

        return out
    }

    /// A corrupt stream can otherwise describe an output far larger than any flight plan,
    /// and the iPad would be killed for the memory rather than shown the error. The
    /// largest thing a package legitimately holds is a full-page chart bitmap — about
    /// 8 MB at 1800×1451 RGB — so 64 MB leaves generous room and still fails quickly.
    static let outputLimit = 64 << 20

    private static func block(_ r: inout BitReader, _ out: inout [UInt8],
                              literal: Huffman, distance: Huffman) throws {
        while true {
            // Once the reader is past the end it invents zero bits, which for some trees
            // decodes to a literal for ever. Truncation has to end the loop, not fill it.
            if r.exhausted && r.bitCount <= 0 { throw InflateError.truncated }
            if out.count > outputLimit { throw InflateError.badSymbol }

            let sym = try r.decode(literal)
            if sym < 256 {
                out.append(UInt8(sym))
                continue
            }
            if sym == 256 { return }

            let li = sym - 257
            guard li < lengthBase.count else { throw InflateError.badSymbol }
            let length = lengthBase[li] + r.bits(lengthExtra[li])

            let di = try r.decode(distance)
            guard di < distBase.count else { throw InflateError.badSymbol }
            let dist = distBase[di] + r.bits(distExtra[di])
            guard dist <= out.count else { throw InflateError.badDistance }

            // Overlapping copies are legal and common — byte at a time, not memcpy.
            var from = out.count - dist
            for _ in 0..<length {
                out.append(out[from])
                from += 1
            }
        }
    }
}
