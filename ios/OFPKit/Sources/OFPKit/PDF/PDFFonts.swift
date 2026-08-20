import Foundation

/// What a page's fonts say about the bytes drawn through them.
///
/// The flight plan is set in Courier and its bytes are its characters, so the OFP side of
/// the app never needed this. The Journey Log is not: it is set in Calibri, embedded as a
/// Type0 font, where two bytes address a glyph and only the font's `ToUnicode` map says
/// which character that glyph was. Without it the form reads as mojibake.
public struct PDFFont {
    /// Type0: two bytes to the glyph. A simple font is its bytes.
    public let twoByte: Bool
    /// Glyph code to the text it stands for.
    public let toUnicode: [Int: String]

    public init(twoByte: Bool, toUnicode: [Int: String]) {
        self.twoByte = twoByte
        self.toUnicode = toUnicode
    }

    /// A string as drawn, turned back into the text it represents.
    public func decode(_ raw: [UInt8]) -> String {
        guard twoByte else { return Latin1.string(raw) }
        var out = ""
        var i = 0
        while i + 1 < raw.count {
            let code = Int(raw[i]) << 8 | Int(raw[i + 1])
            // An unmapped glyph becomes a space rather than nothing: it keeps the cell's
            // other characters where they were.
            out += toUnicode[code] ?? " "
            i += 2
        }
        return out
    }
}

public enum PDFFontReader {

    /// Every font named in a page's resources.
    public static func fonts(of page: PDFPage, in document: PDFMiniDocument) -> [String: PDFFont] {
        guard let dictionary = document.resolve(page.resources?["Font"])?.dictValue else {
            return [:]
        }
        var out: [String: PDFFont] = [:]
        for (name, reference) in dictionary {
            guard let font = document.resolve(reference)?.dictValue else { continue }
            let twoByte = document.resolve(font["Subtype"])?.nameValue == "Type0"
            var map: [Int: String] = [:]
            if let stream = document.resolve(font["ToUnicode"])?.streamValue,
               let bytes = try? document.streamData(stream) {
                map = parseCMap(Latin1.string(bytes))
            }
            out[name] = PDFFont(twoByte: twoByte, toUnicode: map)
        }
        return out
    }

    /// Four hex digits to one UTF-16 unit, which is how a CMap spells its destinations —
    /// so a character outside the basic plane arrives as its surrogate pair and joins up.
    static func hexToString(_ hex: String) -> String {
        var units: [UInt16] = []
        let digits = Array(hex)
        var i = 0
        while i + 3 < digits.count {
            if let value = UInt16(String(digits[i..<(i + 4)]), radix: 16) { units.append(value) }
            i += 4
        }
        return String(utf16CodeUnits: units, count: units.count)
    }

    /// The `bfchar` and `bfrange` sections of a ToUnicode CMap.
    static func parseCMap(_ text: String) -> [Int: String] {
        var map: [Int: String] = [:]

        let pair = Pattern("<([0-9A-Fa-f]+)>\\s*<([0-9A-Fa-f]+)>")
        for block in Pattern("beginbfchar([\\s\\S]*?)endbfchar").all(text) {
            guard let body = block[1] else { continue }
            for m in pair.all(body) {
                guard let from = m[1], let to = m[2], let code = Int(from, radix: 16) else { continue }
                map[code] = hexToString(to)
            }
        }

        // `<lo> <hi> <dst>` counts up from the destination; `<lo> <hi> [ … ]` lists them.
        let range = Pattern("<([0-9A-Fa-f]+)>\\s*<([0-9A-Fa-f]+)>\\s*(?:<([0-9A-Fa-f]+)>|\\[([\\s\\S]*?)\\])")
        let single = Pattern("<([0-9A-Fa-f]+)>")
        for block in Pattern("beginbfrange([\\s\\S]*?)endbfrange").all(text) {
            guard let body = block[1] else { continue }
            for m in range.all(body) {
                guard let a = m[1], let b = m[2],
                      let lo = Int(a, radix: 16), let hi = Int(b, radix: 16), hi >= lo else { continue }

                if let destination = m[3] {
                    // Only the last unit counts up; anything before it is a fixed prefix.
                    let whole = hexToString(destination)
                    let prefix = String(whole.dropLast())
                    guard let base = Int(String(destination.suffix(4)), radix: 16) else { continue }
                    var code = lo
                    while code <= hi, code - lo < 65536 {
                        let unit = UInt16(truncatingIfNeeded: base + code - lo)
                        map[code] = prefix + String(utf16CodeUnits: [unit], count: 1)
                        code += 1
                    }
                } else if let list = m[4] {
                    for (k, item) in single.all(list).enumerated() {
                        guard let hex = item[1] else { continue }
                        map[lo + k] = hexToString(hex)
                    }
                }
            }
        }
        return map
    }
}
