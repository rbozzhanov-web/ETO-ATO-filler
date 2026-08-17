import SwiftUI
import OFPKit

/// The two palettes, carried over from the web app's custom properties so the native app
/// looks like the one the crew already knows.
struct Palette: Sendable {
    let background: Color
    let panel: Color
    let panel2: Color
    let line: Color
    let line2: Color
    let text: Color
    let dim: Color
    let accent: Color
    let accentStrong: Color
    let ok: Color
    let warn: Color
    let error: Color
    /// The gold rule under the header, and the wall clock — so a live figure is never
    /// mistaken for one read off the plan.
    let gold: Color
    let fieldPlaceholder: Color
    let danger: Color

    static let dark = Palette(
        background: Color(hex: 0x0F1419), panel: Color(hex: 0x171D24),
        panel2: Color(hex: 0x1E262F), line: Color(hex: 0x2C3742),
        line2: Color(hex: 0x232C35), text: Color(hex: 0xE6EDF3),
        dim: Color(hex: 0x8B98A5), accent: Color(hex: 0x4D9FFF),
        accentStrong: Color(hex: 0x1F6FEB), ok: Color(hex: 0x3FB950),
        warn: Color(hex: 0xD29922), error: Color(hex: 0xF85149),
        gold: Color(hex: 0x9B804D), fieldPlaceholder: Color(hex: 0x4A5560),
        danger: Color(hex: 0xC93A3A))

    static let light = Palette(
        background: Color(hex: 0xF2F5F8), panel: Color(hex: 0xFFFFFF),
        panel2: Color(hex: 0xF1F4F7), line: Color(hex: 0xD6DDE4),
        line2: Color(hex: 0xE6EBF0), text: Color(hex: 0x16202B),
        dim: Color(hex: 0x5D6B7A), accent: Color(hex: 0x0B62D6),
        accentStrong: Color(hex: 0x0B62D6), ok: Color(hex: 0x1A7F37),
        warn: Color(hex: 0x9A6700), error: Color(hex: 0xCF222E),
        gold: Color(hex: 0x8A6F3E), fieldPlaceholder: Color(hex: 0x9AA7B4),
        danger: Color(hex: 0xCF222E))
}

enum AppTheme: String, CaseIterable, Identifiable {
    case light, dark
    var id: String { rawValue }

    var palette: Palette { self == .dark ? .dark : .light }
    var colorScheme: ColorScheme { self == .dark ? .dark : .light }
}

extension Color {
    init(hex: UInt32) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255,
                  opacity: 1)
    }

    /// The print palette is chosen for paper, where dark blue on white is right. On a dark
    /// screen the same colour is nearly invisible, so it is lifted towards white — for the
    /// screen only. What goes into the document is never touched.
    static func onScreen(_ colour: PDFColor, theme: AppTheme) -> Color {
        guard theme == .dark else {
            return Color(.sRGB, red: colour.r, green: colour.g, blue: colour.b, opacity: 1)
        }
        let luminance = 0.2126 * colour.r + 0.7152 * colour.g + 0.0722 * colour.b
        guard luminance < 0.42 else {
            return Color(.sRGB, red: colour.r, green: colour.g, blue: colour.b, opacity: 1)
        }
        let k = (0.42 - luminance) * 1.3
        func mix(_ v: Double) -> Double { v + (1 - v) * k }
        return Color(.sRGB, red: mix(colour.r), green: mix(colour.g), blue: mix(colour.b),
                     opacity: 1)
    }
}

extension EnvironmentValues {
    var palette: Palette {
        get { self[PaletteKey.self] }
        set { self[PaletteKey.self] = newValue }
    }
}

private struct PaletteKey: EnvironmentKey {
    static let defaultValue = Palette.dark
}

extension Font {
    /// The form is set in Courier and the figures read off it are compared column by
    /// column, so everything taken from the document is shown monospaced.
    static func mono(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .monospaced)
    }
}
