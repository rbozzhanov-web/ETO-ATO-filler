import Foundation

/// An RGB colour for the print palette, 0…1 per channel.
public struct PDFColor: Equatable {
    public let r: Double, g: Double, b: Double
    public init(r: Double, g: Double, b: Double) { self.r = r; self.g = g; self.b = b }

    /// `#rrggbb`, rounded to four decimals the way the browser version wrote them, so the
    /// operators emitted here are byte-identical to the ones it produced.
    public init(hex: String) {
        let s = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        let n = UInt32(s, radix: 16) ?? 0
        func round4(_ v: Double) -> Double { (v * 10000).rounded() / 10000 }
        r = round4(Double((n >> 16) & 255) / 255)
        g = round4(Double((n >> 8) & 255) / 255)
        b = round4(Double(n & 255) / 255)
    }
}

/// Builds the drawing operators for one page.
public struct PDFOps {
    private var out: [UInt8]

    public init() { out = Array("q\n".utf8) }

    /// JavaScript's number formatting, reproduced: three decimals at most, trailing zeros
    /// dropped, and `Math.round`'s round-half-up rather than Swift's round-half-away.
    static func num(_ n: Double) -> String {
        guard n.isFinite else { return "0" }
        let scaled = (n * 1000 + 0.5).rounded(.down)
        let value = scaled / 1000
        if value == value.rounded(.towardZero), abs(value) < 1e15 {
            return String(Int(value))
        }
        var s = String(format: "%.3f", value)
        while s.hasSuffix("0") { s.removeLast() }
        if s.hasSuffix(".") { s.removeLast() }
        return s
    }

    /// `(` `)` and `\` are the only characters a PDF literal string must escape.
    static func escape(_ text: String) -> [UInt8] {
        var out = [UInt8]()
        for byte in Latin1.bytes(text) {
            if byte == UInt8(ascii: "(") || byte == UInt8(ascii: ")") || byte == UInt8(ascii: "\\") {
                out.append(UInt8(ascii: "\\"))
            }
            out.append(byte)
        }
        return out
    }

    private mutating func write(_ s: String) { out.append(contentsOf: Latin1.bytes(s)) }

    /// A filled rectangle. Used to white out the form's dotted rule before writing over it.
    @discardableResult
    public mutating func rect(x: Double, y: Double, width: Double, height: Double,
                              color: PDFColor) -> PDFOps {
        write("\(Self.num(color.r)) \(Self.num(color.g)) \(Self.num(color.b)) rg\n")
        write("\(Self.num(x)) \(Self.num(y)) \(Self.num(width)) \(Self.num(height)) re f\n")
        return self
    }

    @discardableResult
    public mutating func text(font: String, size: Double, x: Double, y: Double,
                              _ string: String, color: PDFColor) -> PDFOps {
        write("\(Self.num(color.r)) \(Self.num(color.g)) \(Self.num(color.b)) rg\n")
        write("BT /\(font) \(Self.num(size)) Tf \(Self.num(x)) \(Self.num(y)) Td (")
        out.append(contentsOf: Self.escape(string))
        write(") Tj ET\n")
        return self
    }

    public func finish() -> [UInt8] { out + Array("Q\n".utf8) }
}

/// A font to add to the resources of every page the overlay touches.
public struct PDFFontResource {
    public let name: String
    public let dictionary: String
    public init(name: String, dictionary: String) {
        self.name = name
        self.dictionary = dictionary
    }
}

public enum PDFWriter {

    /// Appends an overlay to `document` as an incremental update.
    ///
    /// The original bytes are never touched: new objects, a new cross-reference table and
    /// a new trailer are added at the end, and the trailer's `/Prev` points back at what
    /// was already there. A reader that fails on the new part still has an intact
    /// document, which is the whole reason for doing it this way rather than rewriting.
    public static func append(to document: PDFMiniDocument,
                              perPage: [Int: [UInt8]],
                              fonts: [PDFFontResource]) throws -> [UInt8] {

        let pages = document.pages()
        var next = document.resolve(document.trailer["Size"])?.intValue
            ?? ((document.xref.keys.max() ?? 0) + 1)

        // Everything new goes into `tail`, which is concatenated onto the untouched
        // original at the end. Offsets are therefore always measured from `here()`.
        var tail = [UInt8]()
        if let lastByte = document.bytes.last, lastByte != 0x0A, lastByte != 0x0D {
            tail.append(0x0A)
        }

        var newXref = [Int: Int]()

        func emit(_ s: String) { tail.append(contentsOf: Latin1.bytes(s)) }
        func emit(_ b: [UInt8]) { tail.append(contentsOf: b) }
        /// Where the next byte will land in the finished file.
        func here() -> Int { document.bytes.count + tail.count }

        var fontNumbers = [String: Int]()
        for font in fonts {
            let number = next
            next += 1
            fontNumbers[font.name] = number
            newXref[number] = here()
            emit("\(number) 0 obj\n\(font.dictionary)\nendobj\n")
        }

        // Deterministic order, so the same input always produces the same bytes.
        for pageIndex in perPage.keys.sorted() {
            guard let ops = perPage[pageIndex], !ops.isEmpty,
                  pageIndex >= 0, pageIndex < pages.count else { continue }
            let page = pages[pageIndex]

            let contentNumber = next
            next += 1
            newXref[contentNumber] = here()
            emit("\(contentNumber) 0 obj\n<</Length \(ops.count)>>\nstream\n")
            emit(ops)
            emit("\nendstream\nendobj\n")

            guard let offset = document.xref[page.ref] else {
                throw PDFError.message("page \(pageIndex + 1) is not in the xref table")
            }
            var lx = PDFLexer(document.bytes, at: offset)
            _ = lx.object()
            _ = lx.object()
            lx.skip()
            if document.bytes.matches("obj", at: lx.i) { lx.i += 3 }
            let dictStart = lx.i
            _ = lx.object()
            let raw = Latin1.string(document.bytes[dictStart..<lx.i])

            let isArray = document.resolve(page.dict["Contents"])?.arrayValue != nil
            var patched = try patchContents(raw, contentNumber: contentNumber, isArray: isArray)
            guard patched != raw else {
                throw PDFError.message("could not update /Contents of page \(pageIndex + 1)")
            }
            for font in fonts where !mentionsFont(patched, named: font.name) {
                patched = try addFont(patched, name: font.name, number: fontNumbers[font.name]!)
            }

            newXref[page.ref] = here()
            emit("\(page.ref) 0 obj\n\(patched)\nendobj\n")
        }

        // The cross-reference table, in runs of consecutive object numbers.
        let numbers = newXref.keys.sorted()
        var runs = [(start: Int, list: [Int])]()
        for n in numbers {
            if var last = runs.last, n == last.start + last.list.count {
                last.list.append(n)
                runs[runs.count - 1] = last
            } else {
                runs.append((start: n, list: [n]))
            }
        }

        let xrefPosition = here()
        var table = "xref\n"
        for run in runs {
            table += "\(run.start) \(run.list.count)\n"
            for n in run.list {
                table += String(format: "%010d 00000 n \n", newXref[n]!)
            }
        }

        var identifier = ""
        if let ids = document.trailer["ID"]?.arrayValue {
            let parts = ids.compactMap { $0.stringBytes }.map { bytes -> String in
                "<" + bytes.map { String(format: "%02X", $0) }.joined() + ">"
            }
            if !parts.isEmpty { identifier = "/ID[" + parts.joined() + "]" }
        }

        guard let rootRef = document.trailer["Root"]?.refValue else { throw PDFError.noRoot }
        table += "trailer\n<</Size \(next)/Root \(rootRef) 0 R"
        if let info = document.trailer["Info"]?.refValue { table += "/Info \(info) 0 R" }
        table += identifier
        if let prev = document.trailingStartxref() { table += "/Prev \(prev)" }
        table += ">>\nstartxref\n\(xrefPosition)\n%%EOF\n"
        emit(table)

        return document.bytes + tail
    }

    /// `/Contents 5 0 R` becomes `/Contents[5 0 R 42 0 R]`; an existing array gains the new
    /// object at the end. Done textually on the object as it stands so that everything else
    /// about the page dictionary is preserved exactly.
    private static func patchContents(_ raw: String, contentNumber: Int, isArray: Bool) throws -> String {
        let pattern = isArray ? #"/Contents\s*\[([\s\S]*?)\]"# : #"/Contents\s+(\d+)\s+(\d+)\s+R"#
        let regex = try NSRegularExpression(pattern: pattern)
        let range = NSRange(raw.startIndex..., in: raw)
        guard let match = regex.firstMatch(in: raw, range: range) else { return raw }

        func group(_ n: Int) -> String {
            guard let r = Range(match.range(at: n), in: raw) else { return "" }
            return String(raw[r])
        }
        let replacement = isArray
            ? "/Contents[\(group(1)) \(contentNumber) 0 R]"
            : "/Contents[\(group(1)) \(group(2)) R \(contentNumber) 0 R]"

        guard let whole = Range(match.range, in: raw) else { return raw }
        return raw.replacingCharacters(in: whole, with: replacement)
    }

    /// True when the page already lists a resource under this name, in which case adding it
    /// again would shadow the original.
    private static func mentionsFont(_ raw: String, named name: String) -> Bool {
        guard let regex = try? NSRegularExpression(pattern: "/" + NSRegularExpression.escapedPattern(for: name) + #"[\s/>]"#) else {
            return false
        }
        return regex.firstMatch(in: raw, range: NSRange(raw.startIndex..., in: raw)) != nil
    }

    /// Inserts `/Name N 0 R` just before the closing `>>` of the page's `/Font` dictionary.
    private static func addFont(_ raw: String, name: String, number: Int) throws -> String {
        let chars = Array(raw.unicodeScalars)
        guard let fontRange = raw.range(of: "/Font") else {
            throw PDFError.message("page /Resources has no /Font")
        }
        var p = raw.unicodeScalars.distance(from: raw.unicodeScalars.startIndex,
                                            to: fontRange.upperBound)
        while p < chars.count, PDFLexer.isWhitespace(UInt8(chars[p].value & 0xFF)),
              chars[p].value < 128 { p += 1 }
        guard p + 1 < chars.count, chars[p] == "<", chars[p + 1] == "<" else {
            throw PDFError.message("/Font given as a reference is not supported")
        }

        var depth = 0
        var q = p
        while q < chars.count {
            if chars[q] == "<", q + 1 < chars.count, chars[q + 1] == "<" {
                depth += 1
                q += 1
            } else if chars[q] == ">", q + 1 < chars.count, chars[q + 1] == ">" {
                depth -= 1
                if depth == 0 { break }
                q += 1
            }
            q += 1
        }
        guard depth == 0, q < chars.count else { throw PDFError.message("could not parse /Font") }

        let head = String(String.UnicodeScalarView(chars[0..<q]))
        let rest = String(String.UnicodeScalarView(chars[q...]))
        return head + "/\(name) \(number) 0 R" + rest
    }
}
