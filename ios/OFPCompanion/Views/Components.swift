import SwiftUI
import OFPKit

/// The panel every section of the app sits in.
struct Card<Content: View>: View {
    @Environment(\.palette) private var palette
    let step: String
    let title: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                Text(step)
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 6)
                    .frame(minWidth: 20, minHeight: 20)
                    .background(Capsule().fill(palette.accentStrong))
                Text(title)
                    .font(.system(size: 12, weight: .semibold))
                    .textCase(.uppercase)
                    .kerning(0.8)
                    .foregroundStyle(palette.dim)
            }
            content
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(palette.panel)
                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(palette.line))
        )
    }
}

/// The coloured message strips: what was found, what is overdue, what went wrong.
struct BannerView: View {
    @Environment(\.palette) private var palette
    let banner: Banner

    private var colour: Color {
        switch banner.kind {
        case .ok: return palette.ok
        case .warn: return palette.warn
        case .error: return palette.error
        }
    }

    var body: some View {
        Text(banner.text)
            .font(.system(size: 13.5))
            .foregroundStyle(colour)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 13)
            .padding(.vertical, 11)
            .background(
                RoundedRectangle(cornerRadius: 7)
                    .fill(colour.opacity(0.14))
                    .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(colour.opacity(0.34)))
            )
    }
}

/// A short note in the dim colour, with the gold dot the web app used.
struct Disclosure: View {
    @Environment(\.palette) private var palette
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Circle().fill(palette.gold).frame(width: 6, height: 6).padding(.top, 6)
            Text(text).font(.system(size: 12.5)).foregroundStyle(palette.dim)
        }
    }
}

/// One of the figures above the waypoint table.
struct StatTile: View {
    @Environment(\.palette) private var palette
    let value: String
    let caption: String
    var tone: Tone = .normal

    enum Tone { case normal, live, warn, bad }

    private var colour: Color {
        switch tone {
        case .normal: return palette.accent
        // The wall clock is the one figure here not read off the plan, so it is set apart.
        case .live: return palette.gold
        case .warn: return palette.warn
        case .bad: return palette.error
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value)
                .font(.mono(20, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(colour)
            Text(caption)
                .font(.system(size: 11))
                .textCase(.uppercase)
                .kerning(0.6)
                .foregroundStyle(palette.dim)
        }
        .frame(minWidth: 92, alignment: .leading)
    }
}

/// The pill buttons in the toolbars.
struct GhostButtonStyle: ButtonStyle {
    @Environment(\.palette) private var palette
    var small = true

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: small ? 13.5 : 15, weight: .semibold))
            .foregroundStyle(palette.dim)
            .padding(.horizontal, small ? 15 : 22)
            .frame(minHeight: small ? 38 : 44)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .strokeBorder(palette.line)
            )
            .opacity(configuration.isPressed ? 0.6 : 1)
    }
}

struct FilledButtonStyle: ButtonStyle {
    @Environment(\.palette) private var palette
    var tint: Color?

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 22)
            .frame(minHeight: 44)
            .background(RoundedRectangle(cornerRadius: 8).fill(tint ?? palette.accentStrong))
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
    }
}

/// A monospaced box for a figure read off or written onto the form.
struct FigureField: View {
    @Environment(\.palette) private var palette
    let placeholder: String
    @Binding var text: String
    var width: CGFloat = 74
    var invalid = false
    var highlighted: Color?

    var body: some View {
        TextField(placeholder, text: $text)
            .textFieldStyle(.plain)
            .font(.mono(15, weight: .semibold))
            .multilineTextAlignment(.center)
            .keyboardType(.numberPad)
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
            .frame(width: width)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 6)
                    .fill(highlighted?.opacity(0.12) ?? palette.background)
                    .overlay(
                        RoundedRectangle(cornerRadius: 6)
                            .strokeBorder(invalid ? palette.error : (highlighted ?? palette.line),
                                          lineWidth: highlighted != nil || invalid ? 1.5 : 1)
                    )
            )
            .foregroundStyle(palette.text)
    }
}

/// Marks a scrolling box while there is more above or below it, so the crew can see at a
/// glance that the list goes on. Both strips are solid in the box's own colour for their
/// full depth, so no half-line of text shows through.
struct ScrollEdgeHints: ViewModifier {
    @Environment(\.palette) private var palette
    let more: Bool
    let previous: Bool
    var background: Color?
    /// Sticky headings cover the top of the box, so the upper strip sits under them and
    /// marks the first hidden row rather than covering the titles.
    var topInset: CGFloat = 0

    func body(content: Content) -> some View {
        let fill = background ?? palette.panel
        content
            .overlay(alignment: .top) {
                if previous {
                    strip(fill: fill, flipped: true).padding(.top, topInset)
                }
            }
            .overlay(alignment: .bottom) {
                if more { strip(fill: fill, flipped: false) }
            }
    }

    private func strip(fill: Color, flipped: Bool) -> some View {
        ZStack(alignment: flipped ? .top : .bottom) {
            LinearGradient(
                colors: flipped ? [fill, fill.opacity(0)] : [fill.opacity(0), fill],
                startPoint: .top, endPoint: .bottom)
            // One shape for both ends: the upper arrow is the lower one turned through
            // 180°, rather than two characters left to the device's fallback font.
            Image(systemName: "chevron.down")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(palette.dim)
                .rotationEffect(.degrees(flipped ? 180 : 0))
                .padding(.vertical, 3)
        }
        .frame(height: 26)
        .allowsHitTesting(false)
    }
}

extension View {
    func scrollEdgeHints(more: Bool, previous: Bool,
                         background: Color? = nil, topInset: CGFloat = 0) -> some View {
        modifier(ScrollEdgeHints(more: more, previous: previous,
                                 background: background, topInset: topInset))
    }
}

/// Reports how far a scroll view has been scrolled and how tall its content is, which is
/// what the edge hints need.
struct ScrollMetrics: Equatable {
    var offset: CGFloat = 0
    var contentHeight: CGFloat = 0
    var viewportHeight: CGFloat = 0

    var canScrollUp: Bool { offset > 4 }
    var canScrollDown: Bool { contentHeight - viewportHeight - offset > 4 }
}

private struct ScrollMetricsKey: PreferenceKey {
    static var defaultValue = ScrollMetrics()
    static func reduce(value: inout ScrollMetrics, nextValue: () -> ScrollMetrics) {
        let next = nextValue()
        if next.contentHeight > 0 { value = next }
    }
}

extension View {
    /// Attach inside a `ScrollView`'s content, with a matching `coordinateSpace` on the
    /// scroll view itself.
    func measureScroll(space: String, into binding: Binding<ScrollMetrics>) -> some View {
        background(
            GeometryReader { content in
                Color.clear.preference(
                    key: ScrollMetricsKey.self,
                    value: ScrollMetrics(
                        offset: -content.frame(in: .named(space)).minY,
                        contentHeight: content.size.height,
                        viewportHeight: 0))
            }
        )
        .onPreferenceChange(ScrollMetricsKey.self) { new in
            var updated = new
            updated.viewportHeight = binding.wrappedValue.viewportHeight
            binding.wrappedValue = updated
        }
    }
}
