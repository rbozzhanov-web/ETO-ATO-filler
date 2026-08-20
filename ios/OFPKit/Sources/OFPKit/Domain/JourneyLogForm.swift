import Foundation

/// The geometry of the Air Astana Journey Log, in points on a landscape A4 sheet.
///
/// These are the measurements the form is actually printed to. The app draws the sheet
/// itself rather than overlaying the original — the document arrives as a blank to be
/// filled, and a blank redrawn at its own coordinates prints identically while letting
/// every cell be typed into.
public enum JourneyLogForm {

    public static let pageWidth = 841.89
    public static let pageHeight = 595.28
    public static let ruleWidth = 0.75
    public static let rowHeight = 16.56

    /// Top of the leg table; the rest of the sheet is measured down from there.
    public static let legTop = 42.81
    /// Leg table bottom to the Fuel / PayLoad title band.
    public static let gapToFuel = 5.25
    /// Fuel table bottom to the crew table.
    public static let gapToCrew = 6.00
    /// The three ruled lines below the crew table, measured from its bottom.
    public static let immigrationRules: [Double] = [28.27, 39.52, 50.77]
    public static let remarksBox = (top: 11.24, bottom: 78.89, x0: 491.58, x1: 817.42)

    // MARK: - Columns

    public static let legX: [Double] = [
        17.28, 28.61, 71.13, 110.81, 150.49, 190.17, 229.85, 269.53, 309.21, 348.89,
        388.57, 428.25, 467.93, 507.61, 547.29, 586.97, 626.65, 666.33, 706.01, 745.69, 785.37]
    public static let legHeaders = [
        "", "Date", "Flight", "Ac.Reg", "Dep", "Arr", "STD", "STA", "ATD", "ATA", "TKOF",
        "TDWN", "Blk", "NtBLK", "Flt", "TO", "LD", "MA", "FlAlt", "DETAIL"]
    public static let legKeys: [String?] = [
        nil, "date", "flight", "acreg", "dep", "arr", "std", "sta", "atd", "ata", "tkof",
        "tdwn", "blk", "ntblk", "flt", "to", "ld", "ma", "flalt", "detail"]
    /// Cells the document itself arrives with filled in.
    public static let legPrinted: Set<String> = ["date", "flight", "acreg", "dep", "arr", "std", "sta"]
    public static let legTimes: Set<String> = [
        "std", "sta", "atd", "ata", "tkof", "tdwn", "blk", "ntblk", "flt"]

    public static let fuelX: [Double] = [
        17.28, 28.61, 68.29, 107.97, 147.65, 187.33, 227.01, 266.69, 306.37, 346.05, 408.41, 470.76]
    public static let fuelHeaders = [
        "", "Init", "UplfW", "Calc Ramp", "Act Ramp", "Stdn", "Burn", "UplfV",
        "Fuel Disc", "Slip 1", "Slip 2"]
    public static let fuelKeys: [String?] = [
        nil, "init", "uplfw", "calcramp", "actramp", "stdn", "burn", "uplfv",
        "fueldisc", "slip1", "slip2"]

    public static let payloadX: [Double] = [470.76, 510.44, 550.12, 589.80, 629.48, 669.16, 708.84, 748.52]
    public static let payloadHeaders = ["ADL", "CHL", "INF", "Cargo", "Mail", "BAG", "ZFW"]
    public static let payloadKeys = ["adl", "chl", "inf", "cargo", "mail", "bag", "zfw"]

    public static let crewX: [Double] = [
        17.28, 28.61, 68.29, 85.30, 198.67, 238.35, 278.03, 317.71, 357.39, 640.82, 660.66]
    public static let crewHeaders = [
        "", "Staff No", "POS", "Name", "DUTY", "Duty time", "Night duty", "Alwd. time", "REMARKS", ""]
    public static let crewKeys: [String?] = [
        nil, "staff", "pos", "name", "duty", "dutytime", "night", "alwd", "remarks", "leg"]
    public static let crewPrinted: Set<String> = ["staff", "pos", "name", "leg"]
    public static let crewTimes: Set<String> = ["dutytime", "night", "alwd"]
    /// Figures that are the same for the whole crew far more often than not, so the
    /// captain's row can put its own on every other.
    public static let crewDuplicable = ["duty", "dutytime", "night", "alwd"]

    /// Which column an item's left edge falls in, or nil if it falls outside the table.
    public static func column(of x: Double, in xs: [Double]) -> Int? {
        for i in 0..<(xs.count - 1) where x >= xs[i] - 1 && x < xs[i + 1] - 1 { return i }
        return nil
    }
}

/// One sheet of the log: its heading, and the four tables it carries.
public struct JourneyLogPage: Codable, Equatable {
    public var operatorName: String = ""
    public var stamp: String = ""
    public var docNumber: String = ""
    public var captain: String = ""
    public var cat: String = ""
    public var lt: String = ""

    public var legs: [[String: String]] = []
    public var fuel: [[String: String]] = []
    public var payload: [[String: String]] = []
    public var crew: [[String: String]] = []
    public var immigration: [String] = ["", "", ""]
    public var remarks: [String] = ["", "", ""]

    public init() {}
}

public enum JourneyLogError: Error, CustomStringConvertible {
    case notAJourneyLog
    case noRows
    case noPages

    public var description: String {
        switch self {
        case .notAJourneyLog: return "not a Journey Log — its table headings are missing"
        case .noRows:         return "no rows found in the form"
        case .noPages:        return "the PDF has no pages"
        }
    }
}
