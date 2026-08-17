import Foundation

/// The PDF tokenizer, working straight on the file's bytes.
///
/// A deliberate port of the browser version rather than a fresh implementation: the two
/// have to agree on where every glyph sits, or the overlay lands in the wrong place, so
/// the quirks are kept — including reading `N G R` by lookahead and treating an unknown
/// keyword as a content-stream operator.
public struct PDFLexer {
    public let src: [UInt8]
    public var i: Int

    public init(_ src: [UInt8], at index: Int = 0) {
        self.src = src
        self.i = index
    }

    @inline(__always) static func isWhitespace(_ c: UInt8) -> Bool {
        c == 0x20 || c == 0x09 || c == 0x0D || c == 0x0A || c == 0x0C || c == 0x00
    }
    @inline(__always) static func isDelimiter(_ c: UInt8) -> Bool {
        switch c {
        case UInt8(ascii: "("), UInt8(ascii: ")"), UInt8(ascii: "<"), UInt8(ascii: ">"),
             UInt8(ascii: "["), UInt8(ascii: "]"), UInt8(ascii: "{"), UInt8(ascii: "}"),
             UInt8(ascii: "/"), UInt8(ascii: "%"):
            return true
        default:
            return false
        }
    }
    @inline(__always) private static func isDigit(_ c: UInt8) -> Bool {
        c >= UInt8(ascii: "0") && c <= UInt8(ascii: "9")
    }

    @inline(__always) private func byte(_ at: Int) -> UInt8? {
        at >= 0 && at < src.count ? src[at] : nil
    }

    /// Whitespace and `%` comments.
    public mutating func skip() {
        while true {
            while i < src.count && Self.isWhitespace(src[i]) { i += 1 }
            if i < src.count && src[i] == UInt8(ascii: "%") {
                while i < src.count && src[i] != 0x0A && src[i] != 0x0D { i += 1 }
            } else {
                return
            }
        }
    }

    /// Reads one object. `nil` at end of input or for the `null` keyword; `.endMarker`
    /// when the next byte closes an array or dictionary.
    public mutating func object() -> PDFObject? {
        skip()
        guard let c = byte(i) else { return nil }
        switch c {
        case UInt8(ascii: "<"):
            return byte(i + 1) == UInt8(ascii: "<") ? dictionary() : hexString()
        case UInt8(ascii: "("):
            return literalString()
        case UInt8(ascii: "["):
            return array()
        case UInt8(ascii: "/"):
            return .name(name())
        case UInt8(ascii: "]"), UInt8(ascii: ">"):
            i += 1
            return .endMarker
        default:
            return token()
        }
    }

    public mutating func name() -> String {
        i += 1
        var out = [UInt8]()
        while i < src.count, !Self.isWhitespace(src[i]), !Self.isDelimiter(src[i]) {
            var ch = src[i]
            i += 1
            if ch == UInt8(ascii: "#"), i + 1 < src.count,
               let hi = hexDigit(src[i]), let lo = hexDigit(src[i + 1]) {
                ch = UInt8(hi << 4 | lo)
                i += 2
            }
            out.append(ch)
        }
        return Latin1.string(out)
    }

    private func hexDigit(_ c: UInt8) -> Int? {
        switch c {
        case UInt8(ascii: "0")...UInt8(ascii: "9"): return Int(c - UInt8(ascii: "0"))
        case UInt8(ascii: "a")...UInt8(ascii: "f"): return Int(c - UInt8(ascii: "a")) + 10
        case UInt8(ascii: "A")...UInt8(ascii: "F"): return Int(c - UInt8(ascii: "A")) + 10
        default: return nil
        }
    }

    public mutating func dictionary() -> PDFObject {
        i += 2
        var d = [String: PDFObject]()
        while true {
            skip()
            guard i < src.count else { break }
            if src[i] == UInt8(ascii: ">"), byte(i + 1) == UInt8(ascii: ">") {
                i += 2
                break
            }
            guard src[i] == UInt8(ascii: "/") else { i += 1; continue }
            let key = name()
            d[key] = object() ?? .null
        }
        return .dict(d)
    }

    public mutating func array() -> PDFObject {
        i += 1
        var a = [PDFObject]()
        while true {
            skip()
            guard i < src.count else { break }
            if src[i] == UInt8(ascii: "]") { i += 1; break }
            guard let v = object() else { a.append(.null); continue }
            if case .endMarker = v { break }
            a.append(v)
        }
        return .array(a)
    }

    /// `( … )` with balanced inner parentheses and backslash escapes.
    public mutating func literalString() -> PDFObject {
        i += 1
        var depth = 1
        var out = [UInt8]()
        while i < src.count {
            let ch = src[i]
            i += 1
            if ch == UInt8(ascii: "\\") {
                guard i < src.count else { break }
                let n = src[i]
                i += 1
                switch n {
                case UInt8(ascii: "n"): out.append(0x0A)
                case UInt8(ascii: "r"): out.append(0x0D)
                case UInt8(ascii: "t"): out.append(0x09)
                case UInt8(ascii: "b"): out.append(0x08)
                case UInt8(ascii: "f"): out.append(0x0C)
                case UInt8(ascii: "0")...UInt8(ascii: "7"):
                    var value = Int(n - UInt8(ascii: "0"))
                    var k = 0
                    while k < 2, i < src.count,
                          src[i] >= UInt8(ascii: "0"), src[i] <= UInt8(ascii: "7") {
                        value = value * 8 + Int(src[i] - UInt8(ascii: "0"))
                        i += 1
                        k += 1
                    }
                    out.append(UInt8(value & 0xFF))
                case 0x0A:
                    break                                    // line continuation
                case 0x0D:
                    if i < src.count && src[i] == 0x0A { i += 1 }
                default:
                    out.append(n)
                }
            } else if ch == UInt8(ascii: "(") {
                depth += 1
                out.append(ch)
            } else if ch == UInt8(ascii: ")") {
                depth -= 1
                if depth == 0 { break }
                out.append(ch)
            } else {
                out.append(ch)
            }
        }
        return .string(out)
    }

    public mutating func hexString() -> PDFObject {
        i += 1
        var digits = [Int]()
        while i < src.count, src[i] != UInt8(ascii: ">") {
            if let d = hexDigit(src[i]) { digits.append(d) }
            i += 1
        }
        i += 1
        if digits.count % 2 == 1 { digits.append(0) }
        var out = [UInt8]()
        out.reserveCapacity(digits.count / 2)
        for k in stride(from: 0, to: digits.count, by: 2) {
            out.append(UInt8(digits[k] << 4 | digits[k + 1]))
        }
        return .string(out)
    }

    /// A bare keyword: a number, `true`/`false`/`null`, or an operator. A plain integer
    /// may open an `N G R` reference, so it is read with lookahead that rewinds when the
    /// `R` does not follow.
    public mutating func token() -> PDFObject? {
        var raw = [UInt8]()
        while i < src.count, !Self.isWhitespace(src[i]), !Self.isDelimiter(src[i]) {
            raw.append(src[i])
            i += 1
        }
        let text = Latin1.string(raw)

        if let first = raw.first,
           first == UInt8(ascii: "-") || first == UInt8(ascii: "+")
            || first == UInt8(ascii: ".") || Self.isDigit(first) {

            let allDigits = raw.allSatisfy { Self.isDigit($0) }
            if allDigits && !raw.isEmpty {
                let save = i
                skip()
                var generation = 0
                while i < src.count, Self.isDigit(src[i]) {
                    generation += 1
                    i += 1
                }
                if generation > 0 {
                    skip()
                    if i < src.count, src[i] == UInt8(ascii: "R") {
                        let after = byte(i + 1)
                        if after == nil || Self.isWhitespace(after!) || Self.isDelimiter(after!) {
                            i += 1
                            return .ref(Int(text) ?? 0)
                        }
                    }
                }
                i = save
            }
            return .number(Double(text) ?? Double.nan)
        }

        switch text {
        case "true":  return .bool(true)
        case "false": return .bool(false)
        case "null":  return nil
        default:
            if text.isEmpty {
                // A delimiter that reached here is consumed so the caller cannot spin.
                guard i < src.count else { return nil }
                let c = src[i]
                i += 1
                return .op(Latin1.string([c]))
            }
            return .op(text)
        }
    }
}
