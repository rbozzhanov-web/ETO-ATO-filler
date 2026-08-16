import Foundation

/// Everything the crew has typed, in a form that survives the app being closed.
///
/// iPadOS drops background apps when it wants the memory, and it does not ask first. The
/// state is therefore written on every change rather than on the way out, and the loaded
/// document is kept beside it, so a cold start comes back to the same flight instead of an
/// empty drop zone.
public struct SessionState: Codable, Equatable {
    public var takeoffTime: String = ""
    public var includeAlternate: Bool = false
    public var actuals: [Int: Actual] = [:]
    public var fieldText: [Int: String] = [:]
    public var readings: [Int: AltimeterReading] = [:]
    /// Cross-checks that have already sounded, so they do not sound again after a restart.
    public var alerted: Set<Int> = []
    public var alarmEnabled: Bool = true
    public var directs: [DirectMark] = []
    public var savedAt: Date?

    public init() {}
}

/// Which document a saved state belongs to. Name and size together are enough: two
/// different packages with the same name and byte count is not a case worth handling.
public struct DocumentKey: Codable, Equatable {
    public let name: String
    public let size: Int

    public init(name: String, size: Int) {
        self.name = name
        self.size = size
    }

    /// Safe as a file name whatever the document is called.
    var fileName: String {
        let cleaned = name.map { $0.isLetter || $0.isNumber ? $0 : "-" }
        return "\(String(cleaned).prefix(80))-\(size)"
    }
}

/// Reads and writes the saved state and the last document.
///
/// Every failure here is deliberately non-fatal: losing the resume is an inconvenience,
/// and a full disk or a protected-data-unavailable moment must never stop the app from
/// working the flight in front of it.
public final class SessionStore {

    private let directory: URL
    private let fileManager = FileManager.default

    public init(directory: URL) {
        self.directory = directory
        try? fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    /// The usual location: Application Support, which is backed up but not user-visible.
    public static func standard() -> SessionStore {
        let base = (try? FileManager.default.url(for: .applicationSupportDirectory,
                                                 in: .userDomainMask,
                                                 appropriateFor: nil, create: true))
            ?? URL(fileURLWithPath: NSTemporaryDirectory())
        return SessionStore(directory: base.appendingPathComponent("OFPCompanion", isDirectory: true))
    }

    // MARK: - Form state

    private func stateURL(_ key: DocumentKey) -> URL {
        directory.appendingPathComponent("state-\(key.fileName).json")
    }

    public func save(_ state: SessionState, for key: DocumentKey) {
        guard let data = try? JSONEncoder().encode(state) else { return }
        try? data.write(to: stateURL(key), options: .atomic)
    }

    public func loadState(for key: DocumentKey) -> SessionState? {
        guard let data = try? Data(contentsOf: stateURL(key)) else { return nil }
        return try? JSONDecoder().decode(SessionState.self, from: data)
    }

    public func clearState(for key: DocumentKey) {
        try? fileManager.removeItem(at: stateURL(key))
    }

    // MARK: - The document itself

    private var lastDocumentURL: URL { directory.appendingPathComponent("last.pdf") }
    private var lastKeyURL: URL { directory.appendingPathComponent("last.json") }

    /// Keeps the loaded plan so a cold start can pick the flight up where it stopped.
    public func keepDocument(_ bytes: [UInt8], key: DocumentKey) {
        do {
            try Data(bytes).write(to: lastDocumentURL, options: .atomic)
            try JSONEncoder().encode(key).write(to: lastKeyURL, options: .atomic)
        } catch {
            // Out of space, or the device is locked. Carry on without a resume.
        }
    }

    /// The document from the last session, if it is still there and still matches.
    public func resumeDocument() -> (bytes: [UInt8], key: DocumentKey)? {
        guard let keyData = try? Data(contentsOf: lastKeyURL),
              let key = try? JSONDecoder().decode(DocumentKey.self, from: keyData),
              let data = try? Data(contentsOf: lastDocumentURL),
              data.count == key.size else { return nil }
        return ([UInt8](data), key)
    }

    public func dropDocument() {
        try? fileManager.removeItem(at: lastDocumentURL)
        try? fileManager.removeItem(at: lastKeyURL)
    }
}
