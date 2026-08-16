import Foundation

/// The print palette. Fixed and not configurable, so every document comes out the same.
public enum PrintPalette {
    public static let eto = PDFColor(hex: "#0033cc")
    public static let ato = PDFColor(hex: "#00762e")
    public static let fuel = PDFColor(hex: "#000000")
    public static let above = PDFColor(hex: "#00762e")
    public static let below = PDFColor(hex: "#cc0000")
    public static let field = PDFColor(hex: "#0033cc")
    public static let white = PDFColor(r: 1, g: 1, b: 1)
}

/// Builds the overlay and appends it to the document.
///
/// Everything written goes on in bold Courier-Bold so it stands apart from the form's own
/// type, and every value is written over a white patch first — the form prints a dotted
/// rule in these boxes, and text laid straight on top of it is unreadable.
public enum OverlayBuilder {

    /// The resource name used for Courier-Bold on every page the overlay touches.
    public static let boldFont = "FB"

    private static let fontResource = PDFFontResource(
        name: boldFont,
        dictionary: "<</Type/Font/BaseFont/Courier-Bold/Encoding/StandardEncoding/Subtype/Type1>>")

    /// Right-aligns `text` inside a field `width` characters wide starting at `x`.
    private static func rightAligned(_ x: Double, _ cw: Double, _ width: Int, _ text: String) -> Double {
        x + Double(width - text.count) * cw
    }

    public struct Input {
        public var plan: ParsedPlan
        public var rows: [PlannedRow]
        public var actuals: [Int: Actual]
        public var fieldText: [Int: String]
        public var altimeterChecks: [AltimeterCheck]
        public var readings: [Int: AltimeterReading]

        public init(plan: ParsedPlan, rows: [PlannedRow], actuals: [Int: Actual],
                    fieldText: [Int: String], altimeterChecks: [AltimeterCheck],
                    readings: [Int: AltimeterReading]) {
            self.plan = plan
            self.rows = rows
            self.actuals = actuals
            self.fieldText = fieldText
            self.altimeterChecks = altimeterChecks
            self.readings = readings
        }
    }

    public static func build(_ input: Input, document: PDFMiniDocument) throws -> [UInt8] {
        var perPage: [Int: PDFOps] = [:]
        func ops(_ page: Int) -> PDFOps {
            perPage[page] ?? PDFOps()
        }

        let anchor = input.plan.anchor

        // The FUEL / DIFF column heading, but only on pages that actually carry a figure —
        // an empty column with a title on it would suggest something was missed.
        let fuelPages = Set(input.rows
            .filter { input.actuals[$0.index]?.fuel.isEmpty == false }
            .map { $0.waypoint.page })

        for header in input.plan.headers where fuelPages.contains(header.page) {
            var o = ops(header.page)
            let a = anchor + header.cw
            o.text(font: boldFont, size: header.size,
                   x: rightAligned(a, header.cw, 5, "DIFF"), y: header.base + 12,
                   "DIFF", color: PrintPalette.fuel)
            o.text(font: boldFont, size: header.size,
                   x: rightAligned(a, header.cw, 5, "FUEL"), y: header.base,
                   "FUEL", color: PrintPalette.fuel)
            o.text(font: boldFont, size: header.size, x: a, y: header.base - 12,
                   "-----", color: PrintPalette.fuel)
            perPage[header.page] = o
        }

        for row in input.rows {
            let waypoint = row.waypoint
            var o = ops(waypoint.page)
            let cw = waypoint.cw
            let entry = input.actuals[row.index] ?? Actual()

            o.rect(x: waypoint.etoX - 1, y: waypoint.etoY - 2.6,
                   width: cw * 4 + 1.5, height: waypoint.size + 0.5, color: PrintPalette.white)
            o.text(font: boldFont, size: waypoint.size, x: waypoint.etoX, y: waypoint.etoY,
                   TimeMath.fmt(row.t), color: PrintPalette.eto)

            if entry.ato.count == 4 {
                o.rect(x: waypoint.atoX - 1, y: waypoint.atoY - 2.6,
                       width: cw * 4 + 1.5, height: waypoint.size + 0.5, color: PrintPalette.white)
                o.text(font: boldFont, size: waypoint.size, x: waypoint.atoX, y: waypoint.atoY,
                       entry.ato, color: PrintPalette.ato)
            }

            if !entry.fuel.isEmpty {
                let a = anchor + cw
                o.text(font: boldFont, size: waypoint.size,
                       x: rightAligned(a, cw, 5, entry.fuel), y: waypoint.atoY,
                       entry.fuel, color: PrintPalette.fuel)
                if let planned = waypoint.remaining, let actual = Int(entry.fuel) {
                    let difference = actual - planned
                    let text = (difference > 0 ? "+" : "") + String(difference)
                    let colour = difference == 0 ? PrintPalette.fuel
                        : difference > 0 ? PrintPalette.above : PrintPalette.below
                    o.text(font: boldFont, size: waypoint.size,
                           x: rightAligned(a, cw, 5, text), y: waypoint.etoY,
                           text, color: colour)
                }
            }
            perPage[waypoint.page] = o
        }

        // The hourly cross-check goes on the blank line directly under its waypoint, so the
        // time it was taken is read off the ETO/ATO right above it.
        let pages = document.pages()
        for check in input.altimeterChecks {
            guard let reading = input.readings[check.mark], !reading.isEmpty else { continue }
            let waypoint = check.row.waypoint
            var o = ops(waypoint.page)
            let cw = waypoint.cw
            let lineHeight = waypoint.etoY - waypoint.atoY

            func pad(_ s: String) -> String {
                s.isEmpty ? "...." : String(repeating: " ", count: max(0, 4 - s.count)) + s
            }
            let line = "ALTM CHK   ALTM1 \(pad(reading.altimeter1))"
                + "   STBY \(pad(reading.standby))"
                + "   ALTM2 \(pad(reading.altimeter2))"

            let box = (waypoint.page < pages.count ? pages[waypoint.page].mediaBox : nil)
                ?? [0, 0, 612, 792]
            let x = box[0] + ((box[2] - box[0]) - Double(line.count) * cw) / 2

            o.rect(x: x - 1, y: waypoint.atoY - lineHeight - 2.6,
                   width: cw * Double(line.count) + 2, height: waypoint.size + 0.5,
                   color: PrintPalette.white)
            o.text(font: boldFont, size: waypoint.size, x: x, y: waypoint.atoY - lineHeight,
                   line, color: PrintPalette.field)
            perPage[waypoint.page] = o
        }

        for field in input.plan.fields {
            let value = input.fieldText[field.index] ?? ""
            guard !value.isEmpty else { continue }
            for (k, part) in FormGeometry.layout(value, over: field.segments).enumerated() {
                guard !part.isEmpty, k < field.segments.count else { continue }
                let segment = field.segments[k]
                var o = ops(segment.page)
                o.rect(x: segment.x - 1, y: segment.base - 2.6,
                       width: segment.cw * Double(segment.n) + 1.5,
                       height: segment.size + 0.5, color: PrintPalette.white)
                o.text(font: boldFont, size: segment.size, x: segment.x, y: segment.base,
                       part, color: PrintPalette.field)
                perPage[segment.page] = o
            }
        }

        let finished = perPage.mapValues { $0.finish() }
        return try PDFWriter.append(to: document, perPage: finished, fonts: [fontResource])
    }
}
