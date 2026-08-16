import Foundation
import Combine
import SwiftUI
import OFPKit

/// A banner above a card.
struct Banner: Equatable {
    enum Kind { case ok, warn, error }
    let kind: Kind
    let text: String
}

/// The whole app state.
///
/// Deliberately one object rather than several: the waypoint table, the fuel tile, the
/// altimeter rows and the export button all read the same few facts, and splitting them up
/// only invents ways for them to disagree.
@MainActor
final class AppModel: ObservableObject {

    // MARK: - Document

    @Published private(set) var documentName = ""
    @Published private(set) var documentKey: DocumentKey?
    @Published private(set) var plan: ParsedPlan?
    /// Handed to the chart decoder, which runs off the main actor.
    private(set) var document: PDFMiniDocument?

    var isLoaded: Bool { plan != nil }

    // MARK: - Entry

    @Published var takeoffText = ""
    @Published var includeAlternate = false
    @Published var actuals: [Int: Actual] = [:]
    @Published var fieldText: [Int: String] = [:]
    @Published var readings: [Int: AltimeterReading] = [:]
    @Published var directs: [DirectMark] = []
    @Published var alarmEnabled = true

    /// Set once Calculate has been pressed and the table exists.
    @Published private(set) var rows: [PlannedRow] = []
    @Published private(set) var takeoff: Int?

    // MARK: - Clock

    /// Ticks every second for the wall clock; the heavier recomputation keys off `minute`.
    @Published private(set) var clock = TimeMath.clockString()
    @Published private(set) var minute = TimeMath.nowUTC()

    // MARK: - Messages

    @Published var loadBanner: Banner?
    @Published var calcBanner: Banner?
    @Published var exportBanner: Banner?

    // MARK: - Interface state

    @Published var theme: AppTheme = .dark {
        didSet { UserDefaults.standard.set(theme.rawValue, forKey: "ofp.theme") }
    }
    @Published var pickingDirect = false
    @Published var selectedAirport = 0
    @Published var isBuilding = false
    @Published private(set) var isLoading = false

    /// Cross-checks that have already sounded, so a restart does not sound them again.
    private var alerted: Set<Int> = []

    private let store = SessionStore.standard()
    private var saveWorkItem: DispatchWorkItem?
    private var timer: AnyCancellable?

    init() {
        if let saved = UserDefaults.standard.string(forKey: "ofp.theme"),
           let value = AppTheme(rawValue: saved) {
            theme = value
        }
        timer = Timer.publish(every: 1, on: .main, in: .common)
            .autoconnect()
            .sink { [weak self] _ in self?.tick() }
    }

    private func tick() {
        clock = TimeMath.clockString()
        let now = TimeMath.nowUTC()
        if now != minute {
            minute = now                       // republishes everything that reads the clock
            soundDueChecks()
        }
    }

    // MARK: - Derived state

    var computer: FlightComputer {
        FlightComputer(rows: rows, takeoff: takeoff ?? 0, actuals: actuals, directs: directs)
    }

    var progress: FlightProgress { computer.progress(now: minute) }

    var altimeterChecks: [AltimeterCheck] { computer.altimeterChecks() }

    /// The window to act on: the earliest overdue one, or failing that the next due.
    var openFuelCheck: FuelCheck? {
        let c = computer
        let offset = c.currentOffset()
        let checks = c.fuelChecks(offset: offset)
        if let late = checks.first(where: { c.fuelState($0, offset: offset, now: minute) == .late }) {
            return late
        }
        return checks.first { c.fuelState($0, offset: offset, now: minute) != .done }
    }

    var overdueFuelChecks: [FuelCheck] {
        let c = computer
        let offset = c.currentOffset()
        return c.fuelChecks(offset: offset)
            .filter { c.fuelState($0, offset: offset, now: minute) == .late }
    }

    var overdueAltimeterChecks: [AltimeterCheck] {
        altimeterChecks.filter { $0.state(reading: readings[$0.mark], now: minute) == .late }
    }

    /// The fuel boxes to ring: where the open check has to be written.
    var ringedFuelRow: (index: Int, late: Bool)? {
        guard let open = openFuelCheck else { return nil }
        let c = computer
        let offset = c.currentOffset()
        guard let point = c.fuelPoint(open, offset: offset) else { return nil }
        return (point.index, c.fuelState(open, offset: offset, now: minute) == .late)
    }

    // MARK: - Loading

    /// Reading a package means inflating every page and walking every glyph on it, which
    /// on a forty-page brief is long enough to be felt. It happens off the main actor so
    /// the app stays answerable while it runs.
    func load(bytes: [UInt8], name: String, resumed: Bool = false) {
        Task { await loadOffMainThread(bytes: bytes, name: name, resumed: resumed) }
    }

    private func loadOffMainThread(bytes: [UInt8], name: String, resumed: Bool) async {
        let key = DocumentKey(name: name, size: bytes.count)
        isLoading = true
        defer { isLoading = false }

        let outcome = await Task.detached(priority: .userInitiated) {
            Result { () -> (PDFMiniDocument, ParsedPlan) in
                let doc = try PDFMiniDocument(bytes: bytes)
                return (doc, try OFPParser.parse(doc))
            }
        }.value

        switch outcome {
        case .failure(let error):
            loadBanner = Banner(kind: .error, text: "Could not parse the document: \(error)")

        case .success(let (doc, parsed)):
            document = doc
            plan = parsed
            documentName = name
            documentKey = key
            resetEntry()

            let mainCount = parsed.waypoints.filter { $0.section == 1 }.count
            var summary = "Found: \(mainCount) main route waypoints"
            if parsed.waypoints.count > mainCount {
                summary += ", \(parsed.waypoints.count - mainCount) alternate"
            }
            if !parsed.fields.isEmpty {
                summary += ", \(parsed.fields.count) document fields"
            }
            loadBanner = Banner(kind: .ok, text: summary)

            if let state = store.loadState(for: key) {
                takeoffText = state.takeoffTime
                includeAlternate = state.includeAlternate
                actuals = state.actuals
                fieldText = state.fieldText
                readings = state.readings
                alerted = state.alerted
                alarmEnabled = state.alarmEnabled
                directs = state.directs

                if !state.takeoffTime.isEmpty {
                    calculate(rearmAlerts: false)
                    let when = state.savedAt.map { " saved " + Self.savedFormatter.string(from: $0) } ?? ""
                    loadBanner = Banner(kind: .ok, text: resumed
                        ? "Continued where you left off — \(name)\(when)."
                        : "Restored previously entered data for this file.")
                }
            }
            if !resumed { store.keepDocument(bytes, key: key) }
        }
    }

    private static let savedFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        f.timeZone = TimeZone(identifier: "UTC")
        return f
    }()

    func loadFile(at url: URL) {
        // A file handed over by the picker or a drag is security-scoped: it has to be
        // opened while the grant is held, and the grant does not survive the await.
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        do {
            let data = try Data(contentsOf: url)
            load(bytes: [UInt8](data), name: url.lastPathComponent)
        } catch {
            loadBanner = Banner(kind: .error,
                                text: "Could not read the file: \(error.localizedDescription)")
        }
    }

    /// Brings back the plan and everything typed into it after iPadOS has closed the app.
    func resumeIfPossible() {
        guard plan == nil, let saved = store.resumeDocument() else { return }
        load(bytes: saved.bytes, name: saved.key.name, resumed: true)
    }

    private func resetEntry() {
        takeoffText = ""
        includeAlternate = false
        actuals = [:]
        fieldText = [:]
        readings = [:]
        directs = []
        alerted = []
        rows = []
        takeoff = nil
        pickingDirect = false
        selectedAirport = 0
        calcBanner = nil
        exportBanner = nil
    }

    // MARK: - Calculate

    /// `rearmAlerts` is false only when restoring: a check the crew has already heard must
    /// not sound again just because the app was reopened. Pressing Calculate does re-arm
    /// them, because a new takeoff time moves every due time with it.
    func calculate(rearmAlerts: Bool = true) {
        guard let plan else { return }
        guard let t0 = TimeMath.parseTime(takeoffText) else {
            calcBanner = Banner(kind: .error, text: "Enter the time as HHMM, for example 0210")
            return
        }
        takeoff = t0
        rows = FlightComputer.rows(from: plan.waypoints, takeoff: t0,
                                   includeAlternate: includeAlternate)

        let drifting = rows.filter { $0.waypoint.drift }.count
        calcBanner = drifting > 0
            ? Banner(kind: .warn,
                     text: "Warning: at \(drifting) waypoints the ET sum did not match T/T.")
            : nil

        if rearmAlerts { alerted = [] }
        save()
    }

    func useDocumentETD() {
        guard let etd = plan?.times?.etd else { return }
        takeoffText = etd
        calculate()
    }

    // MARK: - Entry helpers

    func setATO(_ value: String, at index: Int) {
        var entry = actuals[index] ?? Actual()
        entry.ato = String(value.filter(\.isNumber).prefix(4))
        actuals[index] = entry.isEmpty ? nil : entry
        save()
    }

    func setFuel(_ value: String, at index: Int) {
        var entry = actuals[index] ?? Actual()
        entry.fuel = String(value.filter(\.isNumber).prefix(5))
        actuals[index] = entry.isEmpty ? nil : entry
        save()
    }

    func setReading(_ value: String, mark: Int, field: AltimeterReading.Field) {
        var reading = readings[mark] ?? AltimeterReading()
        reading[field] = String(value.filter(\.isNumber).prefix(5))
        readings[mark] = reading.isEmpty ? nil : reading
        // Finishing a check clears its alarm, so re-entering it can sound again.
        if reading.filledCount > 0 { alerted.remove(mark) }
        save()
    }

    func setField(_ value: String, at index: Int) {
        guard let field = plan?.fields.first(where: { $0.index == index }) else { return }
        let trimmed = String(value.uppercased().prefix(field.capacity))
        fieldText[index] = trimmed.isEmpty ? nil : trimmed
        save()
    }

    func clearActuals() {
        actuals = [:]
        save()
    }

    /// An ATO that is not four figures is shown as wrong rather than silently ignored.
    func isATOMalformed(_ index: Int) -> Bool {
        guard let value = actuals[index]?.ato, !value.isEmpty else { return false }
        return value.count != 4 || TimeMath.parseTime(value) == nil
    }

    // MARK: - Direct to

    func applyDirect(to waypointIndex: Int) {
        var c = computer
        if c.applyDirect(to: waypointIndex, now: minute) {
            directs = c.directs
            pickingDirect = false
            calcBanner = nil
            save()
        } else {
            calcBanner = Banner(kind: .error, text: "That waypoint is not ahead of you.")
        }
    }

    func undoDirect(at position: Int) {
        guard directs.indices.contains(position) else { return }
        directs.remove(at: position)
        save()
    }

    func directTargetName(_ mark: DirectMark) -> String {
        rows.first { $0.index == mark.to }?.name ?? "?"
    }

    // MARK: - Alarm

    private func soundDueChecks() {
        guard alarmEnabled, takeoff != nil else { return }
        var fresh = false
        for check in altimeterChecks {
            let state = check.state(reading: readings[check.mark], now: minute)
            if state == .late {
                if !alerted.contains(check.mark) {
                    alerted.insert(check.mark)
                    fresh = true
                }
            } else if state == .done || state == .partial {
                alerted.remove(check.mark)
            }
        }
        if fresh {
            Alarm.play()
            save()
        }
    }

    // MARK: - Saving

    func save() {
        guard let key = documentKey else { return }
        saveWorkItem?.cancel()
        var state = SessionState()
        state.takeoffTime = takeoffText
        state.includeAlternate = includeAlternate
        state.actuals = actuals
        state.fieldText = fieldText
        state.readings = readings
        state.alerted = alerted
        state.alarmEnabled = alarmEnabled
        state.directs = directs
        state.savedAt = Date()

        let work = DispatchWorkItem { [store] in store.save(state, for: key) }
        saveWorkItem = work
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 0.25, execute: work)
    }

    /// iPadOS freezes a backgrounded app without warning, and the quarter-second debounce
    /// would swallow the last keystrokes.
    func flushSave() {
        saveWorkItem?.cancel()
        saveWorkItem = nil
        guard let key = documentKey else { return }
        var state = SessionState()
        state.takeoffTime = takeoffText
        state.includeAlternate = includeAlternate
        state.actuals = actuals
        state.fieldText = fieldText
        state.readings = readings
        state.alerted = alerted
        state.alarmEnabled = alarmEnabled
        state.directs = directs
        state.savedAt = Date()
        store.save(state, for: key)
    }

    // MARK: - Export

    /// What a save would leave unrecorded, so the crew is asked before it happens.
    func exportWarnings() -> [String] {
        var out: [String] = []
        let missing = altimeterChecks.filter {
            $0.state(reading: readings[$0.mark], now: minute) != .done
        }
        if !missing.isEmpty {
            let marks = missing.map { "+\($0.mark / 60)h" }.joined(separator: ", ")
            out.append("\(missing.count) altimeter cross-check\(missing.count > 1 ? "s are" : " is") "
                       + "not recorded (\(marks)).")
        }
        let overdue = overdueFuelChecks
        if !overdue.isEmpty {
            out.append("\(overdue.count) fuel check\(overdue.count > 1 ? "s are" : " is") "
                       + "overdue with no fuel recorded.")
        }
        return out
    }

    var outputName: String {
        var base = documentName
        if base.lowercased().hasSuffix(".pdf") { base = String(base.dropLast(4)) }
        return base + "_ETO.pdf"
    }

    /// Writes the filled document to a temporary file and hands back its URL for the share
    /// sheet. Nothing leaves the device unless the crew chooses a destination.
    func buildPDF() throws -> URL {
        guard let plan, let document else {
            throw NSError(domain: "OFP", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "No plan is loaded."])
        }
        let input = OverlayBuilder.Input(
            plan: plan, rows: rows, actuals: actuals, fieldText: fieldText,
            altimeterChecks: altimeterChecks, readings: readings)
        let bytes = try OverlayBuilder.build(input, document: document)

        let url = FileManager.default.temporaryDirectory.appendingPathComponent(outputName)
        try? FileManager.default.removeItem(at: url)
        try Data(bytes).write(to: url, options: .atomic)
        return url
    }

    // MARK: - Reset

    func reset() {
        if let key = documentKey { store.clearState(for: key) }
        store.dropDocument()
        saveWorkItem?.cancel()
        saveWorkItem = nil
        document = nil
        plan = nil
        documentName = ""
        documentKey = nil
        loadBanner = nil
        resetEntry()
    }
}
