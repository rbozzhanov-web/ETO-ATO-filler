import Foundation

/// How a due check stands against the clock.
public enum CheckState: String, Equatable {
    /// Every box filled.
    case done
    /// Started but not finished — worth saying, because a half-entered check is easy to
    /// walk away from.
    case partial
    /// The time has come and it is not recorded.
    case late
    /// Within ten minutes of falling due.
    case soon
    case waiting
}

/// One hourly altimeter cross-check: the waypoint it belongs to and the time it falls due.
public struct AltimeterCheck: Equatable {
    /// Minutes after takeoff — 60, 120, 180.
    public let mark: Int
    public let row: PlannedRow
    public let due: Int

    /// `+2:00`, the way the row is labelled.
    public var label: String { "+\(mark / 60):00" }
}

/// The three readings compared at each cross-check.
public struct AltimeterReading: Equatable, Codable {
    public var altimeter1: String = ""
    public var standby: String = ""
    public var altimeter2: String = ""

    public init(altimeter1: String = "", standby: String = "", altimeter2: String = "") {
        self.altimeter1 = altimeter1
        self.standby = standby
        self.altimeter2 = altimeter2
    }

    public var filledCount: Int {
        [altimeter1, standby, altimeter2].filter { !$0.isEmpty }.count
    }
    public var isEmpty: Bool { filledCount == 0 }

    public subscript(field: Field) -> String {
        get {
            switch field {
            case .altimeter1: return altimeter1
            case .standby:    return standby
            case .altimeter2: return altimeter2
            }
        }
        set {
            switch field {
            case .altimeter1: altimeter1 = newValue
            case .standby:    standby = newValue
            case .altimeter2: altimeter2 = newValue
            }
        }
    }

    public enum Field: String, CaseIterable {
        case altimeter1, standby, altimeter2
        public var caption: String {
            switch self {
            case .altimeter1: return "ALTM1"
            case .standby:    return "STBY"
            case .altimeter2: return "ALTM2"
            }
        }
    }
}

/// A half-hour fuel-check window.
public struct FuelCheck: Equatable {
    public let mark: Int
    public let from: Int
    public let to: Int
    public let due: Int
}

public extension AltimeterCheck {
    /// A check is judged on what has been written into it first, and only then on the
    /// clock — a completed check is never overdue.
    func state(reading: AltimeterReading?, now: Int) -> CheckState {
        let filled = reading?.filledCount ?? 0
        if filled == 3 { return .done }
        if filled > 0 { return .partial }
        let d = TimeMath.sinceDue(due, now: now)
        return d >= 0 ? .late : d >= -10 ? .soon : .waiting
    }

    /// The wording under each row.
    func status(reading: AltimeterReading?, now: Int) -> String {
        let d = TimeMath.sinceDue(due, now: now)
        switch state(reading: reading, now: now) {
        case .done:    return "recorded"
        case .partial: return "incomplete — finish this entry"
        case .late:    return "overdue by \(d) min — due at \(TimeMath.fmt(due))"
        case .soon:    return "due at \(TimeMath.fmt(due)), in \(-d) min"
        case .waiting: return "due at \(TimeMath.fmt(due))"
        }
    }
}
