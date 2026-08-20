import XCTest
@testable import OFPKit

final class TimeMathTests: XCTestCase {

    func testParsesFourDigitTimes() {
        XCTAssertEqual(TimeMath.parseTime("0210"), 130)
        XCTAssertEqual(TimeMath.parseTime("02:10"), 130)
        XCTAssertEqual(TimeMath.parseTime("0000"), 0)
        XCTAssertEqual(TimeMath.parseTime("2359"), 1439)
    }

    func testRejectsImpossibleTimes() {
        XCTAssertNil(TimeMath.parseTime("2400"))
        XCTAssertNil(TimeMath.parseTime("0160"))
        XCTAssertNil(TimeMath.parseTime("210"))
        XCTAssertNil(TimeMath.parseTime("02100"))
        XCTAssertNil(TimeMath.parseTime(""))
        XCTAssertNil(TimeMath.parseTime("abcd"))
    }

    func testFormatting() {
        XCTAssertEqual(TimeMath.fmt(130), "0210")
        XCTAssertEqual(TimeMath.fmt(0), "0000")
        XCTAssertEqual(TimeMath.fmt(1500), "0100", "past midnight, wrapped")
        XCTAssertEqual(TimeMath.fmt(-30), "2330", "and before it")
        XCTAssertEqual(TimeMath.hhmm(310), "5.10")
        XCTAssertEqual(TimeMath.hhmm(5), "0.05")
    }

    func testDifferencesWrapAcrossMidnight() {
        // Due at 2350, now 0005: fifteen minutes late, not a day and a bit early.
        XCTAssertEqual(TimeMath.sinceDue(23 * 60 + 50, now: 5), 15)
        // Due at 0005, now 2350: ten minutes to go.
        XCTAssertEqual(TimeMath.sinceDue(5, now: 23 * 60 + 50), -15)
        XCTAssertEqual(TimeMath.sinceDue(600, now: 600), 0)
    }
}

final class FlightComputerTests: XCTestCase {

    /// A three-hour plan, one waypoint every fifteen minutes, taking off at 0200.
    private func computer(takeoff: Int = 120,
                          legs: Int = 13,
                          step: Int = 15) -> FlightComputer {
        var waypoints: [Waypoint] = []
        for i in 0..<legs {
            waypoints.append(Waypoint(
                index: i, name: "WPT\(i)", et: i == 0 ? 0 : step, cum: i * step,
                section: 1, page: i / 6,
                etoX: 470, etoY: 700 - Double(i) * 24, atoX: 470, atoY: 688 - Double(i) * 24,
                size: 9, cw: 5.4, font: "F1",
                remaining: 30000 - i * 1000, drift: false))
        }
        let rows = FlightComputer.rows(from: waypoints, takeoff: takeoff, includeAlternate: false)
        return FlightComputer(rows: rows, takeoff: takeoff)
    }

    func testEtoRunsFromTakeoff() {
        let c = computer()
        XCTAssertEqual(c.rows.first?.t, 120)
        XCTAssertEqual(c.rows[1].t, 135)
        XCTAssertEqual(c.rows.last?.t, 120 + 12 * 15)
    }

    func testAlternateIsTimedFromTheMainArrival() {
        let main = (0..<3).map { i in
            Waypoint(index: i, name: "M\(i)", et: i == 0 ? 0 : 30, cum: i * 30, section: 1,
                     page: 0, etoX: 470, etoY: 700, atoX: 470, atoY: 688, size: 9, cw: 5.4,
                     font: "F1", remaining: nil, drift: false)
        }
        let alternate = (0..<2).map { i in
            Waypoint(index: 3 + i, name: "A\(i)", et: i == 0 ? 0 : 20, cum: i * 20, section: 2,
                     page: 0, etoX: 470, etoY: 700, atoX: 470, atoY: 688, size: 9, cw: 5.4,
                     font: "F1", remaining: nil, drift: false)
        }
        let rows = FlightComputer.rows(from: main + alternate, takeoff: 120, includeAlternate: true)
        XCTAssertEqual(rows.last?.t, 120 + 60 + 20, "the alternate starts where the main route ends")

        let without = FlightComputer.rows(from: main + alternate, takeoff: 120,
                                          includeAlternate: false)
        XCTAssertEqual(without.count, 3)
    }

    // MARK: - Offset

    func testOffsetIsZeroUntilAnActualIsEntered() {
        XCTAssertEqual(computer().currentOffset(), 0)
    }

    func testOffsetComesFromTheMostRecentActual() {
        var c = computer()
        // WPT2 is planned for 0230; entered as 0236, so six minutes behind.
        c.actuals[2] = Actual(ato: "0236")
        XCTAssertEqual(c.currentOffset(), 6)

        // A later entry supersedes it: WPT4 planned 0300, entered 0257 — three minutes up.
        c.actuals[4] = Actual(ato: "0257")
        XCTAssertEqual(c.currentOffset(), -3)
    }

    func testOffsetIgnoresIncompleteAndSkippedEntries() {
        var c = computer()
        c.actuals[2] = Actual(ato: "0236")
        c.actuals[4] = Actual(ato: "02")            // half-typed
        XCTAssertEqual(c.currentOffset(), 6, "an unusable entry does not move the offset")

        c.actuals[4] = Actual(fuel: "24000")        // fuel only
        XCTAssertEqual(c.currentOffset(), 6)
    }

    func testOffsetWrapsAcrossMidnight() {
        var c = computer(takeoff: 23 * 60 + 50)     // 2350
        // WPT1 is planned for 0005; entered as 0009.
        c.actuals[1] = Actual(ato: "0009")
        XCTAssertEqual(c.currentOffset(), 4)
    }

    // MARK: - Progress

    func testProgressSplitsPastFromComing() {
        let c = computer()                          // 0200 … 0500, every 15 min
        let p = c.progress(now: 2 * 60 + 40)        // 0240
        XCTAssertEqual(c.rows[p.current!].name, "WPT2", "0230 has come")
        XCTAssertEqual(c.rows[p.next!].name, "WPT3", "0245 has not")
    }

    func testProgressFollowsTheOffsetNotTheTyping() {
        var c = computer()
        // Running twenty minutes late, but only the actuals so far say so.
        c.actuals[1] = Actual(ato: "0235")          // planned 0215
        let p = c.progress(now: 2 * 60 + 40)
        XCTAssertEqual(p.offset, 20)
        // With everything twenty minutes later, 0230+20 = 0250 has not come at 0240.
        XCTAssertEqual(c.rows[p.current!].name, "WPT1")
    }

    func testAllWaypointsPassed() {
        let c = computer()
        let p = c.progress(now: 5 * 60 + 30)
        XCTAssertNil(p.next)
        XCTAssertEqual(c.rows[p.current!].name, "WPT12")
    }

    // MARK: - Direct to

    func testDirectCutsOutTheWaypointsBetween() {
        var c = computer()
        let now = 2 * 60 + 40                       // current is WPT2
        XCTAssertTrue(c.applyDirect(to: 6, now: now))
        XCTAssertEqual(c.skipped, [3, 4, 5])
        XCTAssertTrue(c.isDirectTarget(6))
        XCTAssertFalse(c.isSkipped(6), "the target itself is still flown")
    }

    func testDirectRefusesAWaypointAlreadyBehind() {
        var c = computer()
        XCTAssertFalse(c.applyDirect(to: 1, now: 2 * 60 + 40))
        XCTAssertTrue(c.skipped.isEmpty)
    }

    func testHighlightStepsOverSkippedWaypoints() {
        var c = computer()
        _ = c.applyDirect(to: 6, now: 2 * 60 + 40)
        let p = c.progress(now: 2 * 60 + 50)        // 0250
        // 0245 (WPT3) has come, but it is cut out, so the live pointer is still WPT2.
        XCTAssertEqual(c.rows[p.current!].name, "WPT2")
        XCTAssertEqual(c.rows[p.next!].name, "WPT6")
    }

    func testSkippedWaypointsKeepTheirPlaceOnTheClock() {
        var c = computer()
        _ = c.applyDirect(to: 6, now: 2 * 60 + 40)
        let p = c.progress(now: 2 * 60 + 50)
        let ab = c.abeam(offset: p.offset, now: 2 * 60 + 50)
        // The aeroplane still goes past them: 0245 is abeam at 0250.
        XCTAssertEqual(c.rows[ab.current!].name, "WPT3")
        XCTAssertEqual(c.rows[ab.next!].name, "WPT4")
    }

    func testEachDirectRemembersItsOwnCut() {
        var c = computer()
        // Cleared direct to WPT4, which cuts out WPT3.
        _ = c.applyDirect(to: 4, now: 2 * 60 + 40)
        XCTAssertEqual(c.skipped, [3])

        // Then re-cleared direct to WPT8. WPT4 was the previous target but is no longer
        // overflown either, so this cut takes it too.
        _ = c.applyDirect(to: 8, now: 2 * 60 + 40)
        XCTAssertEqual(c.skipped, [3, 4, 5, 6, 7])

        // Undoing the first restores only what the first took away.
        c.undoDirect(at: 0)
        XCTAssertEqual(c.skipped, [4, 5, 6, 7], "undoing one leaves the other alone")
    }

    // MARK: - Altimeter cross-checks

    func testOneCheckPerFullHour() {
        let c = computer()                          // three hours exactly
        let checks = c.altimeterChecks()
        XCTAssertEqual(checks.map(\.mark), [60, 120],
                       "no check is raised inside the last hour before arrival")
        XCTAssertEqual(checks.map { $0.due }, [180, 240])
        XCTAssertEqual(checks.first?.row.name, "WPT4", "the waypoint reached at the hour")
        XCTAssertEqual(checks.first?.label, "+1:00")
    }

    func testShortFlightRaisesNoChecks() {
        XCTAssertTrue(computer(legs: 4, step: 15).altimeterChecks().isEmpty)
    }

    func testCheckStateFollowsWhatIsEntered() {
        let check = computer().altimeterChecks()[0]     // due at 0300
        XCTAssertEqual(check.state(reading: nil, now: 2 * 60), .waiting)
        XCTAssertEqual(check.state(reading: nil, now: 2 * 60 + 55), .soon)
        XCTAssertEqual(check.state(reading: nil, now: 3 * 60 + 5), .late)

        var reading = AltimeterReading(altimeter1: "1013")
        XCTAssertEqual(check.state(reading: reading, now: 3 * 60 + 5), .partial,
                       "a started check is never simply overdue")
        reading.standby = "1013"
        reading.altimeter2 = "1012"
        XCTAssertEqual(check.state(reading: reading, now: 3 * 60 + 5), .done)
    }

    func testCheckWording() {
        let check = computer().altimeterChecks()[0]
        XCTAssertEqual(check.status(reading: nil, now: 3 * 60 + 7), "overdue by 7 min — due at 0300")
        XCTAssertEqual(check.status(reading: nil, now: 2 * 60 + 56), "due at 0300, in 4 min")
    }

    // MARK: - Fuel checks

    func testAWindowEveryHalfHour() {
        let c = computer()                          // three hours
        let checks = c.fuelChecks(offset: 0)
        XCTAssertEqual(checks.map(\.mark), [30, 60, 90, 120, 150])
        // With nothing entered, a check is due as the plan has it: the last waypoint of
        // the window, which at fifteen-minute legs lands exactly on the half hour.
        XCTAssertEqual(checks.map(\.due), [150, 180, 210, 240, 270])
    }

    func testPassingTimePrefersTheReportedTime() {
        var c = computer()                          // WPT2 planned 0230
        let wpt2 = c.rows[2]
        XCTAssertEqual(c.passingTime(wpt2, offset: 0), 150, "as planned, 0230")
        XCTAssertEqual(c.passingTime(wpt2, offset: 6), 156, "carried by the offset")

        c.actuals[2] = Actual(ato: "0234")
        XCTAssertEqual(c.passingTime(wpt2, offset: 6), 2 * 60 + 34,
                       "its own ATO wins over any estimate")
    }

    func testCheckFallsDueWhenItsWaypointIsPassed() {
        var c = computer()
        // The check sits on the last waypoint of its window, and falls due as that
        // waypoint is passed — not on a half-hour grid drawn at takeoff.
        for check in c.fuelChecks(offset: 0) {
            let point = c.fuelPoint(check, offset: 0)
            XCTAssertEqual(check.due, c.passingTime(point!, offset: 0))
        }

        // Report the waypoint the first check sits on as four minutes late, and the check
        // moves with it.
        let first = c.fuelChecks(offset: 0)[0]
        let point = c.fuelPoint(first, offset: 0)!
        XCTAssertEqual(point.name, "WPT2")
        c.actuals[point.index] = Actual(ato: "0234")

        // That entry also puts the flight four minutes down, which slides WPT2 out of the
        // first window — so the check it now sits on is the one that covers it.
        let offset = c.currentOffset()
        XCTAssertEqual(offset, 4)
        let covering = c.fuelChecks(offset: offset)
            .first { c.fuelBox($0, offset: offset).contains(where: { $0.index == point.index }) }
        XCTAssertNotNil(covering)
        XCTAssertEqual(c.fuelPoint(covering!, offset: offset)?.name, "WPT3")
    }

    func testUnreportedWaypointsCarryTheOffset() {
        var c = computer()
        // Only WPT1 is reported, six minutes down. Every later waypoint has no ATO of its
        // own, so its passing time is the plan carried by that six minutes.
        c.actuals[1] = Actual(ato: "0221")
        let offset = c.currentOffset()
        XCTAssertEqual(offset, 6)

        let first = c.fuelChecks(offset: offset)[0]
        let point = c.fuelPoint(first, offset: offset)!
        XCTAssertEqual(point.name, "WPT1")
        XCTAssertEqual(first.due, 2 * 60 + 21, "its own ATO, which is what was reported")

        let second = c.fuelChecks(offset: offset)[1]
        let later = c.fuelPoint(second, offset: offset)!
        XCTAssertEqual(second.due, later.t + 6, "unreported, so the plan plus six")
    }

    func testWindowIsSatisfiedByAnyFuelInIt() {
        var c = computer()
        let check = c.fuelChecks(offset: 0)[0]      // 0 < cum <= 30, so WPT1 and WPT2
        XCTAssertEqual(c.fuelBox(check, offset: 0).map(\.name), ["WPT1", "WPT2"])
        XCTAssertEqual(c.fuelPoint(check, offset: 0)?.name, "WPT2", "the ring goes on the last")

        XCTAssertEqual(c.fuelState(check, offset: 0, now: 3 * 60), .late)
        c.actuals[1] = Actual(fuel: "28000")
        XCTAssertEqual(c.fuelState(check, offset: 0, now: 3 * 60), .done,
                       "any one figure in the window will do")
    }

    func testWindowsFollowTheFlightNotThePaper() {
        var c = computer()
        // Twenty minutes behind: a waypoint planned for cum 25 is really reached at 45,
        // so it belongs to the second window, not the first.
        c.actuals[1] = Actual(ato: "0235")
        XCTAssertEqual(c.currentOffset(), 20)
        let first = c.fuelChecks(offset: 20)[0]     // the window covering 0 … 30 minutes
        // On the paper, WPT1 (cum 15) and WPT2 (cum 30) fall in the first half hour. Twenty
        // minutes behind, they are really reached at 35 and 50, so neither does; WPT0 —
        // planned for the moment of takeoff — is reached at 20 and takes the check instead.
        XCTAssertEqual(c.fuelBox(first, offset: 20).map(\.name), ["WPT0"])

        // The waypoints pushed out of it turn up in the window they are actually reached in.
        let second = c.fuelChecks(offset: 20)[1]    // 30 … 60 minutes
        XCTAssertEqual(c.fuelBox(second, offset: 20).map(\.name), ["WPT1", "WPT2"])
    }

    func testDirectDoesNotCancelAFuelCheck() {
        var c = computer()
        // Cut out everything in the second window.
        _ = c.applyDirect(to: 8, now: 2 * 60 + 5)
        let checks = c.fuelChecks(offset: 0)
        XCTAssertTrue(checks.contains { $0.mark == 60 },
                      "the clock is what the rule runs on, so the window survives")

        let emptied = checks.first { $0.mark == 60 }!
        let box = c.fuelBox(emptied, offset: 0)
        XCTAssertFalse(box.isEmpty, "it falls to the next waypoint actually overflown")
        XCTAssertTrue(box.allSatisfy { !c.isSkipped($0.index) })
    }

    func testWindowsPastTheEndOfTheFlightAreDropped() {
        let c = computer(legs: 5, step: 15)         // one hour
        XCTAssertEqual(c.fuelChecks(offset: 0).map(\.mark), [30])
    }

    func testFilledCount() {
        var c = computer()
        XCTAssertEqual(c.filledCount(), 0)
        c.actuals[1] = Actual(ato: "0215")
        c.actuals[2] = Actual(fuel: "28000")
        c.actuals[3] = Actual()                     // empty entries do not count
        XCTAssertEqual(c.filledCount(), 2)
    }
}
