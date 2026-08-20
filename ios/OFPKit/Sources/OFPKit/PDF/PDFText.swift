import Foundation

/// One run of text with the position the page puts it at.
public struct PDFTextItem {
    /// The raw bytes as they appear in the PDF string. Kept as bytes because the parser
    /// walks them by index to place each glyph, and a byte is exactly one Courier cell.
    public let bytes: [UInt8]
    public let x: Double
    public let y: Double
    public let size: Double
    /// Character width in points: the advance from one glyph to the next.
    public let cw: Double

    public var text: String { Latin1.string(bytes) }
    public var count: Int { bytes.count }
}

public enum PDFText {

    private typealias Matrix = (Double, Double, Double, Double, Double, Double)

    @inline(__always)
    private static func multiply(_ a: Matrix, _ b: Matrix) -> Matrix {
        (a.0 * b.0 + a.1 * b.2,
         a.0 * b.1 + a.1 * b.3,
         a.2 * b.0 + a.3 * b.2,
         a.2 * b.1 + a.3 * b.3,
         a.4 * b.0 + a.5 * b.2 + b.4,
         a.4 * b.1 + a.5 * b.3 + b.5)
    }

    /// Walks a content stream and returns every string it draws, with its position.
    ///
    /// These plans are set in Courier throughout, so the advance is taken as a flat
    /// 600/1000 em rather than read from a font's width array. That is what makes the
    /// column arithmetic elsewhere work: with a monospaced face, an x coordinate and a
    /// character index are the same thing.
    public static func items(in content: [UInt8]) -> [PDFTextItem] {
        var lx = PDFLexer(content, at: 0)
        var stack = [PDFObject]()
        var out = [PDFTextItem]()

        var size = 0.0, charSpacing = 0.0, horizontalScale = 100.0, leading = 0.0
        let identity: Matrix = (1, 0, 0, 1, 0, 0)
        var tm = identity
        var tlm = identity

        func nextLine() {
            tlm = multiply((1, 0, 0, 1, 0, -leading), tlm)
            tm = tlm
        }

        func show(_ bytes: [UInt8]?) {
            guard let bytes, !bytes.isEmpty else { return }
            let scale = (tm.0 * tm.0 + tm.1 * tm.1).squareRoot()
            let cw = size * 0.6 * (horizontalScale / 100) + charSpacing
            out.append(PDFTextItem(bytes: bytes, x: tm.4, y: tm.5,
                                   size: size * (scale == 0 ? 1 : scale), cw: cw))
            tm = multiply((1, 0, 0, 1, Double(bytes.count) * cw, 0), tm)
        }

        func last() -> PDFObject? { stack.last }

        while true {
            guard let object = lx.object() else { break }
            if case .endMarker = object { continue }

            guard case .op(let op) = object else {
                stack.append(object)
                continue
            }

            switch op {
            case "BT":
                tm = identity
                tlm = identity
                stack.removeAll(keepingCapacity: true)
            case "Tf":
                size = last()?.numberValue ?? 0
            case "TL":
                leading = last()?.numberValue ?? 0
            case "Tc":
                charSpacing = last()?.numberValue ?? 0
            case "Tz":
                horizontalScale = last()?.numberValue ?? 100
            case "Td", "TD":
                let y = stack.popLast()?.numberValue ?? 0
                let x = stack.popLast()?.numberValue ?? 0
                if op == "TD" { leading = -y }
                tlm = multiply((1, 0, 0, 1, x, y), tlm)
                tm = tlm
            case "Tm":
                let operands = stack.suffix(6).compactMap { $0.numberValue }
                if operands.count == 6 {
                    tm = (operands[0], operands[1], operands[2],
                          operands[3], operands[4], operands[5])
                    tlm = tm
                }
            case "T*":
                nextLine()
            case "Tj":
                show(last()?.stringBytes)
            case "'", "\"":
                nextLine()
                show(last()?.stringBytes)
            case "TJ":
                if let array = last()?.arrayValue {
                    for element in array {
                        if let bytes = element.stringBytes {
                            show(bytes)
                        } else if let adjust = element.numberValue {
                            let dx = -adjust / 1000 * size * (horizontalScale / 100)
                            tm = multiply((1, 0, 0, 1, dx, 0), tm)
                        }
                    }
                }
            default:
                break
            }
            stack.removeAll(keepingCapacity: true)
        }
        return out
    }
}

/// One whole text block, positioned by the matrix that opened it.
public struct PDFBlockItem {
    public let text: String
    public let x: Double
    public let y: Double
    public let size: Double
}

public extension PDFText {

    /// Text a block at a time, rather than a run at a time.
    ///
    /// The Journey Log puts every cell of the form in its own `BT … ET` block, positioned by
    /// its own `Tm`. Read that way the form needs no glyph widths at all — the position of a
    /// cell is the position of its block — which is what makes a document set in an embedded
    /// font readable without implementing its metrics.
    static func blockItems(in content: [UInt8], fonts: [String: PDFFont]) -> [PDFBlockItem] {
        var lx = PDFLexer(content, at: 0)
        var stack = [PDFObject]()
        var out = [PDFBlockItem]()

        var font: PDFFont?
        var current: (x: Double, y: Double, size: Double, text: String)?

        func flush() {
            if let c = current, !c.text.trimmingCharacters(in: .whitespaces).isEmpty {
                out.append(PDFBlockItem(text: c.text, x: c.x, y: c.y, size: c.size))
            }
            current = nil
        }

        while true {
            guard let object = lx.object() else { break }
            if case .endMarker = object { continue }

            guard case .op(let op) = object else {
                stack.append(object)
                continue
            }

            switch op {
            case "BT":
                flush()
                font = nil
            case "ET":
                flush()
            case "Tf":
                // The operands are the resource name and the size, so the name is the one
                // before last.
                let name = stack.count >= 2 ? stack[stack.count - 2].nameValue : nil
                font = name.flatMap { fonts[$0] }
            case "Tm":
                let v = stack.suffix(6).compactMap { $0.numberValue }
                if v.count == 6 {
                    flush()
                    let size = abs(v[0]) != 0 ? abs(v[0]) : abs(v[1])
                    current = (x: v[4], y: v[5], size: size, text: "")
                }
            case "Tj", "'", "\"":
                if current != nil, let bytes = stack.last?.stringBytes {
                    current?.text += (font?.decode(bytes) ?? Latin1.string(bytes))
                }
            case "TJ":
                if current != nil, let array = stack.last?.arrayValue {
                    for element in array {
                        guard let bytes = element.stringBytes else { continue }
                        current?.text += (font?.decode(bytes) ?? Latin1.string(bytes))
                    }
                }
            default:
                break
            }
            stack.removeAll(keepingCapacity: true)
        }
        flush()
        return out
    }
}
