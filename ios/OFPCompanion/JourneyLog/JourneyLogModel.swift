import Foundation
import Combine
import SwiftUI
import OFPKit

/// The Journey Log side of the app.
///
/// Kept apart from `AppModel` because the two share nothing but the PDF engine: a different
/// document, a different form, a different way of getting it onto paper. What they do share
/// is the habit of writing everything down as it is typed, because iPadOS closes a
/// background app without asking.
@MainActor
final class JourneyLogModel: ObservableObject {

    @Published private(set) var document = JourneyLogDocument()
    @Published var banner: Banner?
    @Published private(set) var isLoading = false

    var isLoaded: Bool { !document.isEmpty }
    var pageCount: Int { document.pages.count }

    private let store = JourneyLogStore()
    private var saveWorkItem: DispatchWorkItem?

    init() {
        if let restored = store.load() { document = restored }
    }

    // MARK: - Loading

    func loadFile(at url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        do {
            let data = try Data(contentsOf: url)
            load(bytes: [UInt8](data), name: url.lastPathComponent)
        } catch {
            banner = Banner(kind: .error,
                            text: "Could not read the file: \(error.localizedDescription)")
        }
    }

    func load(bytes: [UInt8], name: String) {
        Task { await loadOffMainThread(bytes: bytes, name: name) }
    }

    private func loadOffMainThread(bytes: [UInt8], name: String) async {
        isLoading = true
        defer { isLoading = false }

        let outcome = await Task.detached(priority: .userInitiated) {
            Result { try JourneyLogReader.parse(try PDFMiniDocument(bytes: bytes)) }
        }.value

        switch outcome {
        case .failure(let error):
            banner = Banner(kind: .error, text: "Could not read the log: \(error)")
        case .success(let pages):
            document = JourneyLogDocument(pages: pages, fileName: name)
            let legs = pages.reduce(0) { $0 + $1.legs.count }
            let crew = pages.reduce(0) { $0 + $1.crew.count }
            banner = Banner(kind: .ok, text: pages.count == 1
                ? "Found: \(legs) leg rows and \(crew) crew rows"
                : "Found: \(pages.count) sheets, \(legs) leg rows and \(crew) crew rows")
            save()
        }
    }

    // MARK: - Entry

    func value(page: Int, table: JourneyLogDocument.Table, row: Int, key: String) -> String {
        document.value(page: page, table: table, row: row, key: key)
    }

    func set(_ text: String, page: Int, table: JourneyLogDocument.Table,
             row: Int, key: String, uppercase: Bool) {
        document.set(uppercase ? text.uppercased() : text,
                     page: page, table: table, row: row, key: key)
        save()
    }

    /// `0340` becomes `03:40` when the crew leaves the box, not while they are still typing.
    func normaliseTime(page: Int, table: JourneyLogDocument.Table, row: Int, key: String) {
        let current = document.value(page: page, table: table, row: row, key: key)
        guard let tidied = LogTime.normalised(current) else { return }
        document.set(tidied, page: page, table: table, row: row, key: key)
        save()
    }

    func carryDown(page: Int, key: String, from row: Int) {
        document.carryDown(page: page, key: key, from: row)
        save()
    }

    func clearEntries() {
        document.clearEntries()
        save()
    }

    func removeLog() {
        document = JourneyLogDocument()
        banner = nil
        store.clear()
    }

    // MARK: - Saving

    func save() {
        saveWorkItem?.cancel()
        let snapshot = document
        let work = DispatchWorkItem { [store] in store.save(snapshot) }
        saveWorkItem = work
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 0.25, execute: work)
    }

    func flushSave() {
        saveWorkItem?.cancel()
        saveWorkItem = nil
        store.save(document)
    }

    // MARK: - Export

    var outputName: String {
        var base = document.fileName
        if base.lowercased().hasSuffix(".pdf") { base = String(base.dropLast(4)) }
        if base.isEmpty { base = "Journey-Log" }
        return base + "_filled.pdf"
    }

    /// Draws the sheets to a PDF and hands back its URL for the share sheet.
    func buildPDF() throws -> URL {
        let data = JourneyLogPrinter.render(document: document)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(outputName)
        try? FileManager.default.removeItem(at: url)
        try data.write(to: url, options: .atomic)
        return url
    }
}

/// Where the log is kept between launches. The whole thing is small enough to be one file.
struct JourneyLogStore {
    private var url: URL {
        let base = (try? FileManager.default.url(for: .applicationSupportDirectory,
                                                 in: .userDomainMask,
                                                 appropriateFor: nil, create: true))
            ?? URL(fileURLWithPath: NSTemporaryDirectory())
        let directory = base.appendingPathComponent("OFPCompanion", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory.appendingPathComponent("journey-log.json")
    }

    func save(_ document: JourneyLogDocument) {
        guard let data = try? JSONEncoder().encode(document) else { return }
        try? data.write(to: url, options: .atomic)
    }

    func load() -> JourneyLogDocument? {
        guard let data = try? Data(contentsOf: url),
              let document = try? JSONDecoder().decode(JourneyLogDocument.self, from: data),
              !document.isEmpty else { return nil }
        return document
    }

    func clear() {
        try? FileManager.default.removeItem(at: url)
    }
}
