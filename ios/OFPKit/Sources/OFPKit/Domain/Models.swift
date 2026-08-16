import Foundation

/// One glyph of the form, with where it sits on the page. The parser works in these
/// because the plan is set in Courier: an x coordinate and a character position are
/// interchangeable, which is what makes the columns findable at all.
struct Glyph {
    let ch: UInt8
    let x: Double
    let base: Double
    let size: Double
    let cw: Double
}

/// A line of the form: its glyphs, its baseline, and how far right it reaches.
struct FormLine {
    let base: Double
    let glyphs: [Glyph]
    let cw: Double
    let maxX: Double
    let size: Double
}

/// One waypoint of the printed plan, and the two boxes on the form that belong to it —
/// the ETO line and the ATO line directly beneath it.
public struct Waypoint: Equatable {
    public let index: Int
    public let name: String
    /// Leg time in minutes.
    public let et: Int
    /// Minutes from takeoff, accumulated down the section.
    public let cum: Int
    /// 1 for the main route, 2 upwards for the alternate.
    public let section: Int
    public let page: Int

    public let etoX: Double, etoY: Double
    public let atoX: Double, atoY: Double
    public let size: Double, cw: Double
    public let font: String?

    /// Planned fuel remaining, when the form prints one.
    public let remaining: Int?
    /// True when the accumulated leg times disagree with the printed total — a sign the
    /// column was misread, and worth telling the crew about rather than hiding.
    public let drift: Bool
}

/// A stretch of blank on the form that a document field can be written into. A field may
/// own more than one: the dots themselves, the empty space to their right, and a spare
/// line underneath.
public struct FieldSegment: Equatable {
    public var page: Int
    public var base: Double
    public var x: Double
    public var n: Int
    public var size: Double
    public var cw: Double
    public var font: String?
}

/// A named blank on the form — ATIS, ATC CLRNC, PIC BLOCK and the rest.
public struct DocumentField: Equatable {
    public let index: Int
    public let label: String
    /// The label of the row when several fields share one line, so the group can be titled.
    public let rowLabel: String
    /// Total characters the field can hold across all its segments.
    public var capacity: Int
    /// A figure the form prints next to the blank for reference — the planned block fuel
    /// beside PIC BLOCK. Shown to the crew, never written into the document.
    public let reference: String?
    public var segments: [FieldSegment]
}

/// The `ATO` column heading, so the overlay can title the fuel column it adds beside it.
public struct ColumnHeader: Equatable {
    public let page: Int
    public let base: Double
    public let size: Double
    public let cw: Double
    public let font: String?
}

/// Scheduled and estimated times as the document prints them.
public struct FlightTimes: Equatable {
    public var std: String?
    public var etd: String?
    public var sta: String?
    public var eta: String?
    public var trip: String?
}

public struct OFPIdentity: Equatable {
    public var route: String?
    public var request: String?
    public var issued: String?

    /// The strip under the title: `ALAICN01 · REQ 83104 · 13/08/2026 15:26Z`, so the
    /// document on screen can be checked against the one the crew was handed.
    public var summary: String {
        [route, request.map { "REQ \($0)" }, issued]
            .compactMap { $0 }
            .joined(separator: "  ·  ")
    }
}

public struct KeyFigures: Equatable {
    public var tow: String?
    public var lw: String?
    public var zfw: String?
    public var pld: String?
    public var ci: String?

    /// The one-line summary shown under the route: `TOW 145979 · LW 122928 · … · CI027`.
    public var summary: String {
        var parts: [String] = []
        if let tow { parts.append("TOW \(tow)") }
        if let lw { parts.append("LW \(lw)") }
        if let zfw { parts.append("ZFW \(zfw)") }
        if let pld { parts.append("PLD \(pld)") }
        if let ci { parts.append(ci) }
        return parts.joined(separator: "   ·   ")
    }

    var isEmpty: Bool { tow == nil && lw == nil && zfw == nil && pld == nil && ci == nil }
}

public struct IcaoFlightPlan: Equatable {
    public let lines: [String]
    /// The whole plan as one string, which is what gets copied to the clipboard.
    public let oneLine: String
    /// 1-based page numbers the plan was printed across.
    public let pages: [Int]
    public let split: Bool
}

/// A page whose entire content is one large picture — the wind-component and significant
/// weather sheets.
public struct ChartPage: Equatable {
    public let page: Int
    public let key: String
    public let width: Int
    public let height: Int
}

public struct Notam: Equatable {
    public let id: String
    public let from: String?
    public let to: String?
    public let estimated: Bool
    public let subject: String?
    public let text: String

    /// `30JUN 0500Z → 30SEP 0500Z`, with EST appended where the end is only estimated.
    /// Nil when the item carries no validity at all.
    public var validityText: String? {
        guard let from else { return nil }
        return "\(Notam.stamp(from)) → \(Notam.stamp(to ?? "?"))" + (estimated ? " EST" : "")
    }

    /// Validity is `DDMMMHHMM`, sometimes with a spanning year, or a word such as PERM /
    /// WIE / UFN. Only the first shape is reformatted; the rest pass through untouched.
    static func stamp(_ s: String) -> String {
        guard let m = Pattern("^(\\d{2}[A-Z]{3})(\\d{4})(?:\\s+(\\d{4}))?$").first(s),
              let day = m[1], let time = m[2] else { return s }
        return "\(day) \(time)Z" + (m[3].map { " \($0)" } ?? "")
    }
}

public enum AirportGroup: String, Equatable, CaseIterable {
    case flight, fir, other

    public var title: String {
        switch self {
        case .flight: return "This flight"
        case .fir:    return "Areas along the route"
        case .other:  return "Other aerodromes"
        }
    }
}

public struct Airport: Equatable {
    public var icao: String
    public var iata: String?
    public var name: String?
    public var role: String?
    public var group: AirportGroup = .other
    public var metar: [String] = []
    public var taf: [String] = []
    public var notams: [Notam] = []
    public var company: [Notam] = []

    public var isEmpty: Bool {
        metar.isEmpty && taf.isEmpty && notams.isEmpty && company.isEmpty
    }

    /// `UAAA — departure`, or the aerodrome's name when it has no part in this flight.
    public var listTitle: String {
        if let role { return "\(icao) — \(role)" }
        if let name { return "\(icao) — \(name)" }
        return icao
    }

    public var counts: String {
        [(metar.count, "METAR"), (taf.count, "TAF"),
         (notams.count, "NOTAM"), (company.count, "COMPANY")]
            .filter { $0.0 > 0 }
            .map { "\($0.0) \($0.1)" }
            .joined(separator: "  ·  ")
    }
}

/// Everything read out of one flight plan package.
public struct ParsedPlan {
    public let waypoints: [Waypoint]
    public let headers: [ColumnHeader]
    /// The right-hand edge the fuel column is written against.
    public let anchor: Double
    public let fields: [DocumentField]
    public let times: FlightTimes?
    public let icao: IcaoFlightPlan?
    public let charts: [ChartPage]
    public let identity: OFPIdentity?
    public let figures: KeyFigures?
    public let airports: [Airport]
}

public enum ParseError: Error, CustomStringConvertible {
    case noEtoColumn
    case noCourierFont

    public var description: String {
        switch self {
        case .noEtoColumn:   return "ETO column not found — unexpected plan format"
        case .noCourierFont: return "no Courier font on the page"
        }
    }
}
