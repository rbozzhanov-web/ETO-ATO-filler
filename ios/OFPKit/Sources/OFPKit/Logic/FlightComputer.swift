import Foundation

/// What the crew has written against one waypoint.
public struct Actual: Equatable, Codable {
    public var ato: String = ""
    public var fuel: String = ""
    public init(ato: String = "", fuel: String = "") { self.ato = ato; self.fuel = fuel }
    public var isEmpty: Bool { ato.isEmpty && fuel.isEmpty }
}

/// One "direct to", remembering exactly which waypoints it cut out — so undoing this one
/// restores those and leaves any other direct alone.
public struct DirectMark: Equatable, Codable {
    public var to: Int
    public var skipped: [Int]
    public init(to: Int, skipped: [Int]) { self.to = to; self.skipped = skipped }
}

/// A waypoint with its estimated overhead time worked out from the takeoff time.
public struct PlannedRow: Equatable {
    public let waypoint: Waypoint
    /// Absolute ETO, minutes past midnight UTC.
    public let t: Int

    public var index: Int { waypoint.index }
    public var name: String { waypoint.name }
    public var section: Int { waypoint.section }
    public var cum: Int { waypoint.cum }
}

/// Where the aeroplane is against the plan.
public struct Progress: Equatable {
    /// Row indices into `rows`, not waypoint numbers.
    public let current: Int?
    public let next: Int?
    /// How far the flight is running from plan, in minutes.
    public let offset: Int
}

/// The flight as it stands: the plan, what has been entered against it, and the directs.
/// Everything derived is a pure function of these three and the clock, which is what makes
/// it all testable without a screen.
public struct FlightComputer {

    public let rows: [PlannedRow]
    public let takeoff: Int
    public var actuals: [Int: Actual]
    public var directs: [DirectMark]

    public init(rows: [PlannedRow], takeoff: Int,
                actuals: [Int: Actual] = [:], directs: [DirectMark] = []) {
        self.rows = rows
        self.takeoff = takeoff
        self.actuals = actuals
        self.directs = directs
    }

    /// Builds the rows for a takeoff time. The alternate route is timed from the main
    /// route's arrival, not from takeoff.
    public static func rows(from waypoints: [Waypoint], takeoff: Int,
                            includeAlternate: Bool) -> [PlannedRow] {
        let main = waypoints.filter { $0.section == 1 }
        let arrival = main.last.map { takeoff + $0.cum } ?? takeoff
        return waypoints
            .filter { $0.section == 1 || (includeAlternate && $0.section == 2) }
            .map { PlannedRow(waypoint: $0, t: ($0.section == 1 ? takeoff : arrival) + $0.cum) }
    }

    // MARK: - Directs

    public var skipped: Set<Int> {
        Set(directs.flatMap(\.skipped))
    }

    public func isSkipped(_ waypointIndex: Int) -> Bool {
        skipped.contains(waypointIndex)
    }

    public func isDirectTarget(_ waypointIndex: Int) -> Bool {
        directs.contains { $0.to == waypointIndex }
    }

    /// Cleared direct to a waypoint: everything still ahead of the aeroplane and before it
    /// is cut out of the route. Nothing here reaches the document and no ETO is rewritten —
    /// the printed order has to keep matching the paper form, because that is where the
    /// ATOs are written.
    public mutating func applyDirect(to waypointIndex: Int, now: Int) -> Bool {
        guard let target = rows.firstIndex(where: { $0.index == waypointIndex }) else {
            return false
        }
        let current = progress(now: now).current ?? -1
        guard target > current else { return false }

        var cut: [Int] = []
        var k = current + 1
        while k < target {
            if !isSkipped(rows[k].index) { cut.append(rows[k].index) }
            k += 1
        }
        directs.append(DirectMark(to: rows[target].index, skipped: cut))
        return true
    }

    public mutating func undoDirect(at position: Int) {
        guard directs.indices.contains(position) else { return }
        directs.remove(at: position)
    }

    // MARK: - Progress

    /// How far the flight is running from the plan, taken from the most recent waypoint
    /// with an ATO entered. Applied to the comparison times only — never to the document.
    public func currentOffset() -> Int {
        for row in rows.reversed() {
            if isSkipped(row.index) { continue }
            guard let entry = actuals[row.index], !entry.ato.isEmpty,
                  let actual = TimeMath.parseTime(entry.ato) else { continue }
            return TimeMath.wrap(actual - TimeMath.norm(row.t))
        }
        return 0
    }

    /// The last row whose time has come and the first whose has not, over whichever rows
    /// are asked for — the flown route, or the ones a direct has put abeam.
    private func scan(_ want: (PlannedRow) -> Bool, offset: Int, now: Int) -> (Int?, Int?) {
        var current: Int?
        var next: Int?
        for (n, row) in rows.enumerated() {
            guard want(row) else { continue }
            if TimeMath.sinceDue(row.t + offset, now: now) >= 0 {
                current = n
            } else if next == nil {
                next = n
            }
        }
        return (current, next)
    }

    public func progress(now: Int) -> Progress {
        let offset = currentOffset()
        let (current, next) = scan({ !isSkipped($0.index) }, offset: offset, now: now)
        return Progress(current: current, next: next, offset: offset)
    }

    /// A direct takes waypoints out of the route, not out of the sky: the aeroplane still
    /// goes past them, so they keep their place on the clock as abeam positions.
    public func abeam(offset: Int, now: Int) -> (current: Int?, next: Int?) {
        scan({ isSkipped($0.index) }, offset: offset, now: now)
    }

    public func filledCount() -> Int {
        rows.filter { actuals[$0.index]?.isEmpty == false }.count
    }

    // MARK: - Altimeter cross-checks

    /// The waypoint reached at each full hour after takeoff. A check falling inside the
    /// last hour before arrival is not raised — by then the descent is under way and the
    /// reading would be taken on approach anyway.
    public func altimeterChecks() -> [AltimeterCheck] {
        let main = rows.filter { $0.section == 1 }
        guard let last = main.last else { return [] }
        var out: [AltimeterCheck] = []
        var mark = 60
        while last.cum - mark >= 60 {
            defer { mark += 60 }
            guard let row = main.first(where: { $0.cum >= mark }) else { continue }
            if out.contains(where: { $0.row.index == row.index }) { continue }
            out.append(AltimeterCheck(mark: mark, row: row, due: takeoff + mark))
        }
        return out
    }

    // MARK: - Fuel checks

    /// Waypoints actually flown over: the main route, less anything a direct cut out.
    private var flown: [PlannedRow] {
        rows.filter { $0.section == 1 && !isSkipped($0.index) }
    }

    /// The half-hour windows the company rule asks for. Only past the end of the flight is
    /// a window dropped: the rule runs on the clock, so a direct that empties a window does
    /// not excuse its check.
    public func fuelChecks(offset: Int) -> [FuelCheck] {
        let main = flown
        guard let last = main.last else { return [] }
        let total = last.cum + offset
        var out: [FuelCheck] = []
        var mark = 30
        while total - mark >= 30 {
            let check = FuelCheck(mark: mark, from: mark - 30, to: mark, due: takeoff + mark)
            if !fuelBox(check, offset: offset).isEmpty { out.append(check) }
            mark += 30
        }
        return out
    }

    /// Where a check can be written: the waypoints inside its window, measured by the time
    /// they are actually reached — or, when a direct has cut them all out, the first one
    /// actually overflown after it.
    public func fuelBox(_ check: FuelCheck, offset: Int) -> [PlannedRow] {
        let main = flown
        let inside = main.filter { $0.cum + offset > check.from && $0.cum + offset <= check.to }
        if !inside.isEmpty { return inside }
        if let after = main.first(where: { $0.cum + offset > check.to }) { return [after] }
        return []
    }

    /// The waypoint the check falls on: the last one before the half-hour mark, so the
    /// reading is taken at the mark rather than anywhere inside the window. A figure
    /// entered at any point in the window still satisfies it — only the ring narrows.
    public func fuelPoint(_ check: FuelCheck, offset: Int) -> PlannedRow? {
        fuelBox(check, offset: offset).last
    }

    public func fuelState(_ check: FuelCheck, offset: Int, now: Int) -> CheckState {
        if fuelBox(check, offset: offset).contains(where: { actuals[$0.index]?.fuel.isEmpty == false }) {
            return .done
        }
        let d = TimeMath.sinceDue(check.due, now: now)
        return d >= 0 ? .late : d >= -10 ? .soon : .waiting
    }
}
