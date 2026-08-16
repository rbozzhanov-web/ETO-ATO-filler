import Foundation

public enum PDFError: Error, CustomStringConvertible {
    case noStartxref
    case notClassicXref
    case noRoot
    case unsupportedFilter(String)
    case notAStream
    case message(String)

    public var description: String {
        switch self {
        case .noStartxref:            return "startxref not found"
        case .notClassicXref:         return "only a classic xref table is supported"
        case .noRoot:                 return "the document catalogue is missing"
        case .unsupportedFilter(let f): return "unsupported stream filter: \(f)"
        case .notAStream:             return "expected a stream object"
        case .message(let m):         return m
        }
    }
}

/// One page, with the values a page inherits from its parents already resolved.
public struct PDFPage {
    public let ref: Int
    public let dict: [String: PDFObject]
    public let resources: [String: PDFObject]?
    public let mediaBox: [Double]?
}

/// A minimal PDF reader: enough of the format to find the text on a page and to append to
/// the file, and no more. Built for Air Astana flight plans — unencrypted, a classic xref
/// table, uncompressed objects — and it says so plainly rather than guessing when it meets
/// something else.
public final class PDFMiniDocument {

    public let bytes: [UInt8]
    public private(set) var xref: [Int: Int] = [:]
    public private(set) var trailer: [String: PDFObject] = [:]

    private var pageCache: [PDFPage]?

    public init(bytes: [UInt8]) throws {
        self.bytes = bytes
        try readXref()
    }

    // MARK: - Cross-reference table

    /// The byte offset named by the last `startxref` in the file.
    private func lastStartxrefOffset() throws -> Int {
        let needle = Array("startxref".utf8)
        var at = -1
        if bytes.count >= needle.count {
            var k = bytes.count - needle.count
            while k >= 0 {
                if bytes.matches("startxref", at: k) { at = k; break }
                k -= 1
            }
        }
        guard at >= 0 else { throw PDFError.noStartxref }
        var lx = PDFLexer(bytes, at: at + needle.count)
        lx.skip()
        guard let n = lx.object()?.intValue else { throw PDFError.noStartxref }
        return n
    }

    /// The offset of the xref this file already ends with, matched strictly against the
    /// tail. The incremental update quotes it as `/Prev`, so a file that does not end in
    /// the canonical way simply gets no `/Prev` rather than a wrong one.
    func trailingStartxref() -> Int? {
        let tail = max(0, bytes.count - 2048)
        var end = bytes.count
        // Trailing whitespace.
        while end > tail, PDFLexer.isWhitespace(bytes[end - 1]) { end -= 1 }
        guard end >= 5, bytes.matches("%%EOF", at: end - 5) else { return nil }
        end -= 5
        while end > tail, PDFLexer.isWhitespace(bytes[end - 1]) { end -= 1 }
        var digitsEnd = end
        while end > tail, bytes[end - 1] >= UInt8(ascii: "0"), bytes[end - 1] <= UInt8(ascii: "9") {
            end -= 1
        }
        guard digitsEnd > end else { return nil }
        let digits = Latin1.string(bytes[end..<digitsEnd])
        digitsEnd = end
        while end > tail, PDFLexer.isWhitespace(bytes[end - 1]) { end -= 1 }
        guard digitsEnd > end, end >= 9, bytes.matches("startxref", at: end - 9) else { return nil }
        return Int(digits)
    }

    private func readXref() throws {
        var offset: Int? = try lastStartxrefOffset()
        var seen = Set<Int>()

        while let off = offset, !seen.contains(off), off >= 0, off < bytes.count {
            seen.insert(off)
            var lx = PDFLexer(bytes, at: off)
            lx.skip()
            guard bytes.matches("xref", at: lx.i) else { throw PDFError.notClassicXref }
            lx.i += 4

            while true {
                lx.skip()
                if bytes.matches("trailer", at: lx.i) { lx.i += 7; break }
                guard let start = lx.object()?.intValue,
                      let count = lx.object()?.intValue, count >= 0 else { break }
                lx.skip()
                for k in 0..<count {
                    guard lx.i + 18 < bytes.count else { break }
                    let entry = Array(bytes[lx.i..<min(lx.i + 20, bytes.count)])
                    if let parsed = Self.parseXrefEntry(entry) {
                        let number = start + k
                        if parsed.inUse && xref[number] == nil { xref[number] = parsed.offset }
                        let c = entry.count > 18 ? entry[18] : 0
                        lx.i += (c == 0x0D || c == 0x0A || c == 0x20) ? 20 : 19
                    } else {
                        lx.i += 20
                    }
                }
            }

            var trailerLexer = PDFLexer(bytes, at: lx.i)
            let tr = trailerLexer.object()?.dictValue ?? [:]
            for (k, v) in tr where trailer[k] == nil { trailer[k] = v }
            offset = tr["Prev"]?.intValue
        }
    }

    /// `0000000016 00000 n` — ten digits, five digits, then `n` or `f`.
    private static func parseXrefEntry(_ e: [UInt8]) -> (offset: Int, inUse: Bool)? {
        guard e.count >= 18 else { return nil }
        func digits(_ range: Range<Int>) -> Int? {
            var v = 0
            for k in range {
                guard e[k] >= UInt8(ascii: "0"), e[k] <= UInt8(ascii: "9") else { return nil }
                v = v * 10 + Int(e[k] - UInt8(ascii: "0"))
            }
            return v
        }
        guard let offset = digits(0..<10), PDFLexer.isWhitespace(e[10]),
              digits(11..<16) != nil, PDFLexer.isWhitespace(e[16]) else { return nil }
        let kind = e[17]
        guard kind == UInt8(ascii: "n") || kind == UInt8(ascii: "f") else { return nil }
        return (offset, kind == UInt8(ascii: "n"))
    }

    // MARK: - Objects

    /// Follows one indirect reference. Anything else is returned unchanged.
    public func resolve(_ object: PDFObject?) -> PDFObject? {
        guard let object else { return nil }
        guard case .ref(let number) = object else { return object }
        guard let offset = xref[number], offset >= 0, offset < bytes.count else { return nil }

        var lx = PDFLexer(bytes, at: offset)
        _ = lx.object()                                     // object number
        _ = lx.object()                                     // generation
        lx.skip()
        if bytes.matches("obj", at: lx.i) { lx.i += 3 }
        guard let value = lx.object() else { return nil }
        lx.skip()

        if bytes.matches("stream", at: lx.i) {
            var p = lx.i + 6
            if p < bytes.count, bytes[p] == 0x0D { p += 1 }
            if p < bytes.count, bytes[p] == 0x0A { p += 1 }
            let declared = resolve(value.dictValue?["Length"])?.intValue ?? 0
            // A wrong /Length would otherwise read off the end of the file.
            let length = max(0, min(declared, bytes.count - p))
            return .stream(PDFStream(dict: value.dictValue ?? [:], start: p, length: length))
        }
        return value
    }

    /// The decoded bytes of a stream. Only `FlateDecode` is supported, which is what these
    /// packages use; anything else is named in the error rather than silently mangled.
    public func streamData(_ stream: PDFStream) throws -> [UInt8] {
        let raw = Array(bytes[stream.start..<min(stream.start + stream.length, bytes.count)])
        let filter = resolve(stream.dict["Filter"])
        var names: [String] = []
        if let array = filter?.arrayValue {
            names = array.compactMap { resolve($0)?.nameValue }
        } else if let single = filter?.nameValue {
            names = [single]
        }
        if names.isEmpty { return raw }
        guard names.count == 1, names[0] == "FlateDecode" || names[0] == "Fl" else {
            throw PDFError.unsupportedFilter(names.joined(separator: ","))
        }
        return try Inflate.decode(raw)
    }

    /// A page's content operators. `/Contents` may be one stream or an array of them, in
    /// which case they are concatenated — a single operator can straddle the join, so the
    /// pieces are separated by a newline exactly as the specification requires.
    public func content(of page: PDFPage) throws -> [UInt8] {
        let contents = resolve(page.dict["Contents"])
        let list: [PDFObject]
        if let array = contents?.arrayValue {
            list = array.compactMap { resolve($0) }
        } else if let contents {
            list = [contents]
        } else {
            list = []
        }
        var out = [UInt8]()
        for object in list {
            guard let stream = object.streamValue else { continue }
            out.append(contentsOf: try streamData(stream))
            out.append(0x0A)
        }
        return out
    }

    // MARK: - Page tree

    public func pages() -> [PDFPage] {
        if let pageCache { return pageCache }
        var out = [PDFPage]()
        guard let root = resolve(trailer["Root"])?.dictValue else {
            pageCache = []
            return []
        }

        var visited = Set<Int>()
        func walk(_ nodeRef: PDFObject, inheritedResources: PDFObject?, inheritedBox: PDFObject?) {
            // A malformed page tree must not spin the app; each object is entered once.
            if let r = nodeRef.refValue {
                if visited.contains(r) { return }
                visited.insert(r)
            }
            guard let node = resolve(nodeRef)?.dictValue else { return }
            let resources = node["Resources"] ?? inheritedResources
            let box = node["MediaBox"] ?? inheritedBox

            if node["Type"]?.nameValue == "Page" {
                out.append(PDFPage(
                    ref: nodeRef.refValue ?? -1,
                    dict: node,
                    resources: resolve(resources)?.dictValue,
                    mediaBox: resolve(box)?.arrayValue?.compactMap { resolve($0)?.numberValue }
                ))
                return
            }
            for kid in resolve(node["Kids"])?.arrayValue ?? [] {
                walk(kid, inheritedResources: resources, inheritedBox: box)
            }
        }

        if let pagesRef = root["Pages"] {
            walk(pagesRef, inheritedResources: nil, inheritedBox: nil)
        }
        pageCache = out
        return out
    }
}
