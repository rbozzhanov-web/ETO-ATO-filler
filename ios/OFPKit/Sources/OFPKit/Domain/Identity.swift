import Foundation

/// A line of the document as flat text, with the page it came from.
struct TextLine {
    let page: Int
    let base: Double
    let text: String
}

enum OFPHeaders {
    private static let brief = Pattern("^AIR ASTANA BRIEF", caseInsensitive: true)
    private static let pageNumber = Pattern("^PAGE \\d+ OF \\d+$", caseInsensitive: true)

    /// The running header and footer, which appear on every page and belong to none of the
    /// content. Stripped before anything is read, or they land in the middle of a NOTAM or
    /// a flight plan reassembled across a page break.
    static func isChrome(_ text: String) -> Bool {
        brief.matches(text) || pageNumber.matches(text)
    }
}

enum Identity {

    private static let routeID = Pattern("\\bROUTE\\s*ID\\s*:\\s*(\\S+)", caseInsensitive: true)
    private static let request = Pattern("\\bREQUEST\\s*#?\\s*(\\d+)", caseInsensitive: true)
    private static let generated = Pattern("\\bGENERATED\\s*:\\s*(\\S+)\\s+(\\d{1,2}:\\d{2})",
                                           caseInsensitive: true)
    private static let fallbacks = [
        Pattern("\\bOFP\\s*(?:NO|NR|NUM(?:BER)?|#)?\\.?\\s*:?\\s*([A-Z0-9][A-Z0-9\\-/]{0,14})\\b",
                caseInsensitive: true),
        Pattern("\\bFLIGHT\\s+PLAN\\s+(?:NO|NR|NUMBER)\\.?\\s*:?\\s*([A-Z0-9][A-Z0-9\\-/]{0,14})\\b",
                caseInsensitive: true)
    ]

    /// The identity strip under the title, so the document on screen can be checked
    /// against the one the crew was handed. Air Astana prints it as
    /// `ROUTE ID: ALAICN01  GENERATED: 13/08/2026 15:26 GMT  --- REQUEST # 83104 ---`.
    static func ofpIdentity(_ lines: [TextLine]) -> OFPIdentity? {
        var result = OFPIdentity()
        for line in lines where line.page == 0 {
            let t = line.text.trimmingCharacters(in: .whitespaces)
            if OFPHeaders.isChrome(t) { continue }

            if result.route == nil, let m = routeID.first(t) { result.route = m[1] ?? nil }
            if result.request == nil, let m = request.first(t) { result.request = m[1] ?? nil }
            if result.issued == nil, let m = generated.first(t),
               let date = m[1], let time = m[2] {
                result.issued = "\(date) \(time)Z"
            }
            if result.request == nil {
                for pattern in fallbacks {
                    if let m = pattern.first(t), let value = m[1] {
                        result.request = value
                        break
                    }
                }
            }
        }
        let empty = result.route == nil && result.request == nil && result.issued == nil
        return empty ? nil : result
    }

    private static let costIndex = Pattern("\\bCI(\\d{2,3})\\b")

    /// The weights the crew checks at a glance. Each label is anchored to a word boundary,
    /// so the MTOW / MLW / MPLD limits printed on the line above cannot be picked up in
    /// place of the planned figures.
    static func keyFigures(_ lines: [TextLine]) -> KeyFigures? {
        var out = KeyFigures()
        let patterns: [(String, WritableKeyPath<KeyFigures, String?>)] = [
            ("TOW", \.tow), ("LW", \.lw), ("ZFW", \.zfw), ("PLD", \.pld)
        ]
        let compiled = patterns.map { ($0.1, Pattern("(?:^|\\s)\($0.0)\\s+(\\d{3,7})(?:\\s|$)")) }

        for line in lines where line.page == 0 {
            let t = line.text.trimmingCharacters(in: .whitespaces)
            if OFPHeaders.isChrome(t) { continue }

            for (keyPath, pattern) in compiled where out[keyPath: keyPath] == nil {
                if let m = pattern.first(t), let value = m[1] { out[keyPath: keyPath] = value }
            }
            if out.ci == nil, let m = costIndex.first(t), let n = m[1] { out.ci = "CI\(n)" }
        }
        return out.isEmpty ? nil : out
    }
}

enum IcaoPlanReader {

    private static let start = Pattern("START OF ICAO FLIGHT PLAN", caseInsensitive: true)
    private static let end = Pattern("END OF ICAO FLIGHT PLAN", caseInsensitive: true)

    /// The ICAO plan is printed between two markers and often breaks across a page, which
    /// drops the page header and footer into the middle of it. Stitched back into one text
    /// with the chrome removed; a line starting with `-` opens a new ICAO field, anything
    /// else continues the one above.
    static func read(_ lines: [TextLine]) -> IcaoFlightPlan? {
        guard let s = lines.firstIndex(where: { start.matches($0.text) }) else { return nil }
        guard let e = lines.firstIndex(where: { end.matches($0.text) }), e > s else { return nil }

        let slice = lines[(s + 1)..<e]
        var pages: [Int] = []
        for line in slice where !pages.contains(line.page + 1) { pages.append(line.page + 1) }

        let body = slice
            .map { $0.text.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty && !OFPHeaders.isChrome($0) }
        guard !body.isEmpty else { return nil }

        var fields: [String] = []
        for t in body {
            if !fields.isEmpty && !t.hasPrefix("-") {
                fields[fields.count - 1] += " " + t
            } else {
                fields.append(t)
            }
        }
        return IcaoFlightPlan(lines: fields, oneLine: fields.joined(),
                              pages: pages, split: pages.count > 1)
    }

    /// Aerodromes and areas the plan names: field 13 is departure, field 16 destination and
    /// its alternates, field 18 carries `EET/` — the FIRs crossed — and `RALT/`, the
    /// en-route alternates.
    static func routeAirports(_ icao: IcaoFlightPlan?) -> (roles: [String: String], firs: Set<String>) {
        var roles: [String: String] = [:]
        var firs = Set<String>()
        guard let icao else { return (roles, firs) }

        let departurePattern = Pattern("^-[A-Z]{4}\\d{4}$")
        let destinationPattern = Pattern("^-[A-Z]{4}\\d{4}(\\s+[A-Z]{4})*\\s*$")

        let departure = icao.lines.first {
            departurePattern.matches($0.trimmingCharacters(in: .whitespaces))
        }
        if let departure {
            let code = String(departure.trimmingCharacters(in: .whitespaces).dropFirst().prefix(4))
            roles[code] = "departure"
        }
        let destination = icao.lines.first {
            destinationPattern.matches($0) && $0 != departure
        }
        if let destination {
            let codes = destination.trimmingCharacters(in: .whitespaces)
                .dropFirst()
                .split(separator: " ")
                .map(String.init)
            if let first = codes.first {
                roles[String(first.prefix(4))] = "destination"
            }
            for code in codes.dropFirst() where code.count == 4 && roles[code] == nil {
                if Pattern("^[A-Z]{4}$").matches(code) { roles[code] = "alternate" }
            }
        }

        let all = icao.lines.joined(separator: " ")
        if let m = Pattern("\\bEET/((?:[A-Z]{4}\\d{4}\\s*)+)").first(all), let group = m[1] {
            for match in Pattern("([A-Z]{4})\\d{4}").all(group) {
                if let code = match[1] { firs.insert(code) }
            }
        }
        if let m = Pattern("\\bRALT/([A-Z]{4}(?:\\s+[A-Z]{4})*)").first(all), let group = m[1] {
            for code in group.split(separator: " ").map(String.init) where roles[code] == nil {
                roles[code] = "en-route alternate"
            }
        }
        return (roles, firs)
    }
}
