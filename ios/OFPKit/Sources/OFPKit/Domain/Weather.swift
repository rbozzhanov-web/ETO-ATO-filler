import Foundation

/// METAR, TAF and NOTAMs, read out of the package itself.
///
/// Every report and NOTAM item in these documents names its own aerodrome, so the grouping
/// keys off the item lines and never off the page headings. Headings are used only to end
/// the item above them and to give the aerodrome its name and its part in the flight.
enum WeatherReader {

    // The raw bulletin at the back of the package runs the keyword into the code
    // ("SPECIZLIC"), which is why the separator is `\s*` and not `\s+`.
    private static let metar = Pattern("^(?:METAR|SPECI)(?:\\s+(?:COR|AMD))?\\s*([A-Z]{4})\\s+\\d{6}Z")
    private static let taf = Pattern("^TAF(?:\\s+(?:AMD|COR))?\\s*([A-Z]{4})\\s+\\d{6}Z")
    // "- UAAA A3725/26 30JUN0500-30SEP0500" and the run-together "NOTAMUAAA A4947/26 …".
    // The validity comes in half a dozen shapes — PERM, a trailing EST, a spanning year
    // against either date — so it is captured whole and split on its first hyphen.
    private static let notam = Pattern(
        "^(?:-\\s*|NOTAM)([A-Z]{4})\\s+([A-Z]\\d{3,4}/\\d{2})\\s+((?:\\d{2}[A-Z]{3}\\d{4}|WIE)\\b[\\s\\S]*?)\\s*$")
    // "UAAA-00001 Oper: Y 28MAY25/0432" and the route form "UAAA-RKSI-00002 Oper: …".
    private static let companyNotam = Pattern("^([A-Z]{4})(?:-([A-Z]{4}))?-(\\d{4,6})\\s+Oper:")
    private static let validity = Pattern("^VALID FROM:\\s*(\\S+)\\s+TO:\\s*(\\S+)")
    private static let aerodrome = Pattern("^([A-Z]{4})\\s+([A-Z]{3})\\s+RWY")
    private static let roleHeading = Pattern("^(DEPARTURE|ARRIVAL|OTHER):\\s*(.+)$")
    private static let companyHeading = Pattern("\\bCOMPANY NOTAMS\\b")
    private static let endsWithPunctuation = Pattern("[.,:]$")
    private static let whitespaceRun = Pattern("\\s+")
    private static let bulletinTerminator = Pattern("\\s*=$")

    private struct Open {
        enum Kind { case metar, taf, notam, company }
        var kind: Kind
        var code: String = ""
        var codes: [String] = []
        var id: String = ""
        var from: String?
        var to: String?
        var estimated = false
        var subject: String?
        var buffer: [String] = []
    }

    /// Splits a NOTAM's validity on its first hyphen and lifts any `EST` marker out.
    private static func splitValidity(_ s: String) -> (from: String, to: String, est: Bool)? {
        guard let hyphen = s.firstIndex(of: "-") else { return nil }
        func cut(_ t: String) -> (String, Bool) {
            let est = Pattern("\\bEST\\b").matches(t)
            var cleaned = t
            if est {
                cleaned = NSRegularExpression.stringByReplacing(
                    pattern: "\\s*\\bEST\\b", in: t, with: "")
            }
            return (cleaned.trimmingCharacters(in: .whitespaces), est)
        }
        let (from, estA) = cut(String(s[s.startIndex..<hyphen]))
        let (to, estB) = cut(String(s[s.index(after: hyphen)...]))
        return (from, to, estA || estB)
    }

    static func read(_ lines: [TextLine], icao: IcaoFlightPlan?) -> [Airport] {
        let (roles, firs) = IcaoPlanReader.routeAirports(icao)
        var byCode: [String: Airport] = [:]
        var order: [String] = []
        var named = Set<String>()

        func at(_ code: String) -> Airport {
            if let existing = byCode[code] { return existing }
            let fresh = Airport(icao: code, iata: nil, name: nil, role: roles[code])
            byCode[code] = fresh
            order.append(code)
            return fresh
        }

        let source = lines
            .map { $0.text.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty && !OFPHeaders.isChrome($0) }

        var open: Open?
        var pendingName: (role: String?, name: String)?
        var subject: String?

        func close() {
            guard let item = open else { return }
            open = nil
            var body = NSRegularExpression.stringByReplacing(
                pattern: "\\s+", in: item.buffer.joined(separator: " "), with: " ")
            body = body.trimmingCharacters(in: .whitespaces)
            guard !body.isEmpty || item.kind == .notam || item.kind == .company else { return }

            switch item.kind {
            case .notam:
                for code in item.codes {
                    var airport = at(code)
                    airport.notams.append(Notam(id: item.id, from: item.from, to: item.to,
                                                estimated: item.estimated,
                                                subject: item.subject, text: body))
                    byCode[code] = airport
                }
            case .company:
                for code in item.codes {
                    var airport = at(code)
                    airport.company.append(Notam(id: item.id, from: item.from, to: item.to,
                                                 estimated: false, subject: nil, text: body))
                    byCode[code] = airport
                }
            case .metar, .taf:
                var text = NSRegularExpression.stringByReplacing(
                    pattern: "\\s*=$", in: body, with: "")
                text = spaced(text)
                var airport = at(item.code)
                if item.kind == .metar { airport.metar.append(text) } else { airport.taf.append(text) }
                byCode[item.code] = airport
            }
        }

        for (i, t) in source.enumerated() {

            // Headings close whatever is open and never become part of it.
            if let m = roleHeading.first(t) {
                close()
                subject = nil
                // "OTHER:" names an aerodrome without giving it a part in this flight.
                let role = m[1] == "OTHER" ? nil : m[1]?.lowercased()
                pendingName = (role, (m[2] ?? "").trimmingCharacters(in: .whitespaces))
                continue
            }
            if let m = aerodrome.first(t), let code = m[1] {
                close()
                subject = nil
                var airport = at(code)
                airport.iata = m[2]
                named.insert(code)
                if let pending = pendingName {
                    airport.name = pending.name
                    if airport.role == nil { airport.role = pending.role }
                    pendingName = nil
                }
                byCode[code] = airport
                continue
            }
            if companyHeading.matches(t) {
                close()
                subject = nil
                continue
            }

            if let m = metar.first(t), let code = m[1] {
                close()
                open = Open(kind: .metar, code: code, buffer: [t])
                continue
            }
            if let m = taf.first(t), let code = m[1] {
                close()
                open = Open(kind: .taf, code: code, buffer: [t])
                continue
            }

            if let m = notam.first(t), let code = m[1], let id = m[2], let raw = m[3],
               let v = splitValidity(raw) {
                close()
                open = Open(kind: .notam, codes: [code], id: id,
                            from: v.from, to: v.to, estimated: v.est, subject: subject)
                continue
            }
            if let m = companyNotam.first(t), let first = m[1] {
                close()
                // A route company NOTAM (UAAA-RKSI-00002) belongs to both ends of the leg.
                let codes = m[2].map { [first, $0] } ?? [first]
                let id = t.split(separator: " ").first.map(String.init) ?? t
                open = Open(kind: .company, codes: codes, id: id)
                continue
            }
            if var item = open, item.kind == .company, item.buffer.isEmpty,
               let m = validity.first(t) {
                item.from = m[1]
                item.to = m[2]
                open = item
                continue
            }

            // A short bare line directly above a NOTAM is that item's subject —
            // "ILS III", "APCH LGT" — not a continuation of the item above it.
            if t.count <= 40, !endsWithPunctuation.matches(t),
               i + 1 < source.count, notam.matches(source[i + 1]) {
                close()
                subject = t
                continue
            }

            if open != nil { open!.buffer.append(t) }
        }
        close()

        let rank: [String: Int] = [
            "departure": 0, "arrival": 1, "destination": 1,
            "alternate": 2, "en-route alternate": 3
        ]

        return order
            .compactMap { byCode[$0] }
            .filter { !$0.isEmpty }
            .map { airport -> Airport in
                var a = airport
                // "Areas" are the FIRs the plan crosses that are not aerodromes in their
                // own right in this package.
                if a.role != nil {
                    a.group = .flight
                } else if firs.contains(a.icao) && !named.contains(a.icao) {
                    a.group = .fir
                } else {
                    a.group = .other
                }
                return a
            }
            .sorted {
                let ra = rank[$0.role ?? ""] ?? 9
                let rb = rank[$1.role ?? ""] ?? 9
                return ra != rb ? ra < rb : $0.icao < $1.icao
            }
    }

    /// The back-of-package bulletin runs the keyword into the code — "SPECIZWYN" — which is
    /// unreadable at a glance. Fixed as the report is read, so what is stored is what is
    /// shown and what is copied.
    static func spaced(_ s: String) -> String {
        NSRegularExpression.stringByReplacing(
            pattern: "^(METAR|SPECI|TAF)([A-Z]{4}\\s)", in: s, with: "$1 $2")
    }
}

extension NSRegularExpression {
    /// `String.replacingOccurrences(of:options:.regularExpression)` does not accept the
    /// options these patterns need, so the replacement goes through the regex directly.
    static func stringByReplacing(pattern: String, in s: String, with template: String) -> String {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return s }
        return regex.stringByReplacingMatches(
            in: s, range: NSRange(s.startIndex..., in: s), withTemplate: template)
    }
}
