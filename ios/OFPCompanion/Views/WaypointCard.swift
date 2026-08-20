import SwiftUI
import OFPKit

struct WaypointCard: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.palette) private var palette

    @State private var confirmingClear = false
    @State private var metrics = ScrollMetrics()
    /// The table follows the clock, but never fights the hands: it holds still for twenty
    /// seconds after the crew scrolls it or types in it. Focus is no test — Enter steps to
    /// the next box, so a box stays focused for the rest of the flight.
    @State private var lastTouched = Date.distantPast
    @State private var lastCentred: Int?

    private let space = "waypoints"

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Rectangle().fill(palette.line).frame(height: 1).padding(.top, 2)
            stats
            toolbar
            if !model.overdueFuelChecks.isEmpty { fuelBanner }
            if model.pickingDirect {
                BannerView(banner: Banner(kind: .warn,
                                          text: "Tap the waypoint you have been cleared direct to."))
            }
            table
        }
    }

    // MARK: - Figures

    private var stats: some View {
        let c = model.computer
        let main = model.rows.filter { $0.section == 1 }
        let arrival = main.last.map { TimeMath.fmt($0.t) } ?? "—"
        let enroute = main.last.map { TimeMath.hhmm($0.cum) } ?? "—"
        let progress = model.progress
        let next = progress.next.map { model.rows[$0] }

        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: 24) {
                StatTile(value: TimeMath.fmt(model.takeoff ?? 0), caption: "Takeoff")
                StatTile(value: arrival, caption: "Arrival (ETO)")
                StatTile(value: enroute, caption: "Time en route")
                StatTile(value: "\(model.rows.count)", caption: "Waypoints")
                StatTile(value: "\(c.filledCount())", caption: "Actuals entered")
                StatTile(value: model.clock, caption: "UTC now", tone: .live)
                nextTile(next: next, offset: progress.offset)
                fuelTile
            }
            .padding(.vertical, 2)
        }
    }

    private func nextTile(next: PlannedRow?, offset: Int) -> some View {
        let caption: String
        if let next {
            let mins = -TimeMath.sinceDue(next.t + offset, now: model.minute)
            var text = "Next · \(TimeMath.fmt(next.t)) · in \(mins) min"
            if offset != 0 { text += " · \(offset > 0 ? "+" : "")\(offset) on plan" }
            caption = text
        } else {
            caption = "All waypoints passed"
        }
        return StatTile(value: next?.name ?? "—", caption: caption)
    }

    private var fuelTile: some View {
        let c = model.computer
        let offset = c.currentOffset()
        guard let open = model.openFuelCheck else {
            let done = !c.fuelChecks(offset: offset).isEmpty
            return StatTile(value: done ? "done" : "—",
                            caption: done ? "All fuel checks recorded" : "Fuel check")
        }
        let state = c.fuelState(open, offset: offset, now: model.minute)
        let d = TimeMath.sinceDue(open.due, now: model.minute)
        return StatTile(
            value: TimeMath.fmt(open.due),
            caption: state == .late
                ? "Fuel check · overdue by \(d) min"
                : "Fuel check · in \(-d) min",
            tone: state == .late ? .bad : state == .soon ? .warn : .normal)
    }

    private var fuelBanner: some View {
        let late = model.overdueFuelChecks
        return BannerView(banner: Banner(kind: .error, text: late.count == 1
            ? "Fuel check due at \(TimeMath.fmt(late[0].due)) with no fuel recorded — "
              + "the box is ringed in the table."
            : "\(late.count) fuel checks are due with no fuel recorded."))
    }

    // MARK: - Toolbar

    private var toolbar: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Button(model.pickingDirect ? "Cancel" : "Direct to…") {
                    model.pickingDirect.toggle()
                    if !model.pickingDirect { model.calcBanner = nil }
                }
                .buttonStyle(GhostButtonStyle())

                Button("Clear actuals") { confirmingClear = true }
                    .buttonStyle(GhostButtonStyle())

                Spacer(minLength: 0)
            }
            if !model.directs.isEmpty { directChips }
        }
        .confirmationDialog("Clear all entered ATO and fuel values?",
                            isPresented: $confirmingClear, titleVisibility: .visible) {
            Button("Clear actuals", role: .destructive) { model.clearActuals() }
            Button("Keep them", role: .cancel) {}
        }
    }

    private var directChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Array(model.directs.enumerated()), id: \.offset) { position, mark in
                    HStack(spacing: 6) {
                        Text("DIRECT → \(model.directTargetName(mark))")
                            .font(.mono(12, weight: .semibold))
                        Button {
                            model.undoDirect(at: position)
                        } label: {
                            Image(systemName: "xmark").font(.system(size: 10, weight: .bold))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Undo direct")
                    }
                    .foregroundStyle(palette.accent)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .background(Capsule().fill(palette.panel2)
                        .overlay(Capsule().strokeBorder(palette.line)))
                }
            }
        }
    }

    // MARK: - Table

    private var table: some View {
        let progress = model.progress
        let abeam = model.computer.abeam(offset: progress.offset, now: model.minute)
        let ringed = model.ringedFuelRow

        return VStack(spacing: 0) {
            header
            GeometryReader { viewport in
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 0) {
                            ForEach(Array(model.rows.enumerated()), id: \.element.index) { n, row in
                                if n == 0 || model.rows[n - 1].section != row.section {
                                    sectionHeading(row.section)
                                }
                                WaypointRow(
                                    row: row,
                                    position: rowPosition(n, progress: progress, abeam: abeam),
                                    ring: ringed?.index == row.index
                                        ? (ringed?.late == true ? .late : .due) : .off)
                                .id(row.index)
                            }
                        }
                        .measureScroll(space: space, into: $metrics)
                    }
                    .coordinateSpace(name: space)
                    .onChange(of: progress.next) { next in
                        guard let next, model.rows.indices.contains(next) else { return }
                        let target = model.rows[next].index
                        guard target != lastCentred,
                              Date().timeIntervalSince(lastTouched) > 20 else { return }
                        lastCentred = target
                        withAnimation(.easeInOut(duration: 0.4)) {
                            proxy.scrollTo(target, anchor: .center)
                        }
                    }
                }
                .onAppear { metrics.viewportHeight = viewport.size.height }
                .onChange(of: viewport.size.height) { metrics.viewportHeight = $0 }
            }
            .frame(height: 380)
            .scrollEdgeHints(more: metrics.canScrollDown, previous: metrics.canScrollUp,
                             background: palette.panel)
        }
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(palette.panel)
                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(palette.line))
        )
        .simultaneousGesture(DragGesture().onChanged { _ in lastTouched = Date() })
    }

    private func rowPosition(_ n: Int, progress: FlightProgress,
                             abeam: (current: Int?, next: Int?)) -> WaypointRow.Position {
        let skipped = model.computer.isSkipped(model.rows[n].index)
        if skipped {
            // A direct takes waypoints out of the route, not out of the sky. They keep
            // their place on the clock, quieter than the live route and labelled, so the
            // two can never be read for each other.
            if n == abeam.current { return .abeamNow }
            if n == abeam.next { return .abeamNext }
            return .skipped
        }
        if let current = progress.current, n < current { return .past }
        if n == progress.current { return .now }
        if n == progress.next { return .next }
        return .ahead
    }

    private func sectionHeading(_ section: Int) -> some View {
        Text(section == 1 ? "Main route" : "Alternate route (ALTN)")
            .font(.system(size: 11, weight: .bold))
            .textCase(.uppercase).kerning(0.7)
            .foregroundStyle(palette.dim)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(palette.panel2)
    }

    private var header: some View {
        HStack(spacing: 0) {
            columnText("Waypoint", .leading, WaypointRow.Widths.name)
            columnText("ET", .trailing, WaypointRow.Widths.et)
            columnText("Cumul.", .trailing, WaypointRow.Widths.cum)
            columnText("ETO", .leading, WaypointRow.Widths.eto)
            columnText("ATO actual", .leading, WaypointRow.Widths.ato)
            columnText("REM plan", .trailing, WaypointRow.Widths.rem)
            columnText("Fuel actual", .leading, WaypointRow.Widths.fuel)
            columnText("Δ", .trailing, WaypointRow.Widths.diff)
        }
        .font(.system(size: 11, weight: .semibold))
        .foregroundStyle(palette.dim)
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background(palette.panel2)
        .overlay(alignment: .bottom) { Rectangle().fill(palette.line).frame(height: 1) }
    }

    private func columnText(_ title: String, _ alignment: Alignment, _ width: CGFloat) -> some View {
        Text(title)
            .frame(width: width, alignment: alignment)
            .padding(.trailing, 8)
    }
}

/// One line of the table.
struct WaypointRow: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.palette) private var palette

    enum Position { case past, now, next, ahead, skipped, abeamNow, abeamNext }
    enum Ring { case off, due, late }

    enum Widths {
        static let name: CGFloat = 116
        static let et: CGFloat = 40
        static let cum: CGFloat = 56
        static let eto: CGFloat = 60
        static let ato: CGFloat = 86
        static let rem: CGFloat = 66
        static let fuel: CGFloat = 92
        static let diff: CGFloat = 56
    }

    let row: PlannedRow
    let position: Position
    let ring: Ring

    private var isSkipped: Bool {
        position == .skipped || position == .abeamNow || position == .abeamNext
    }

    private var background: Color {
        switch position {
        case .now: return palette.accent.opacity(0.10)
        case .next: return palette.accent.opacity(0.16)
        // Quieter than the live route, and with no bold, so an abeam position can never
        // be taken for one the aeroplane is flying to.
        case .abeamNow: return palette.dim.opacity(0.16)
        case .abeamNext: return palette.accent.opacity(0.12)
        default: return .clear
        }
    }

    private var opacity: Double {
        switch position {
        case .past: return 0.55
        case .skipped: return 0.3
        case .abeamNow: return 0.8
        case .abeamNext: return 0.75
        default: return 1
        }
    }

    var body: some View {
        HStack(spacing: 0) {
            name
            figure("\(row.waypoint.et)", width: Widths.et, alignment: .trailing)
            figure(TimeMath.hhmm(row.cum), width: Widths.cum, alignment: .trailing)

            Text(TimeMath.fmt(row.t))
                .font(.mono(13, weight: .semibold))
                .foregroundStyle(Color.onScreen(PrintPalette.eto, theme: model.theme))
                .frame(width: Widths.eto, alignment: .leading)
                .padding(.trailing, 8)

            atoField
            figure(row.waypoint.remaining.map(String.init) ?? "—",
                   width: Widths.rem, alignment: .trailing)
            fuelField
            difference
        }
        .padding(.horizontal, 12)
        .frame(height: 44)
        .background(background)
        .opacity(opacity)
        .overlay(alignment: .leading) { marker }
        .overlay(alignment: .bottom) { Rectangle().fill(palette.line2).frame(height: 1) }
        .contentShape(Rectangle())
        .onTapGesture {
            if model.pickingDirect { model.applyDirect(to: row.index) }
        }
    }

    @ViewBuilder private var marker: some View {
        switch position {
        case .now, .next:
            Rectangle().fill(palette.accent).frame(width: 3)
        case .abeamNow, .abeamNext:
            Rectangle().fill(palette.dim.opacity(0.55)).frame(width: 3)
        default:
            EmptyView()
        }
    }

    private var name: some View {
        HStack(spacing: 6) {
            Text(row.name)
                .font(.mono(13, weight: position == .now || position == .next ? .bold : .regular))
                .strikethrough(isSkipped)
                .foregroundStyle(palette.text)
                .lineLimit(1)
            if model.computer.isDirectTarget(row.index) { badge("DCT", palette.accent) }
            if position == .abeamNow { badge("ABEAM", palette.dim) }
            Spacer(minLength: 0)
        }
        .frame(width: Widths.name, alignment: .leading)
        .padding(.trailing, 8)
    }

    private func badge(_ text: String, _ colour: Color) -> some View {
        Text(text)
            .font(.system(size: 9, weight: .bold))
            .kerning(0.5)
            .foregroundStyle(palette.text)
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .background(RoundedRectangle(cornerRadius: 4).fill(colour.opacity(0.28)))
    }

    private func figure(_ text: String, width: CGFloat, alignment: Alignment) -> some View {
        Text(text)
            .font(.mono(13))
            .foregroundStyle(palette.dim)
            .frame(width: width, alignment: alignment)
            .padding(.trailing, 8)
    }

    private var atoField: some View {
        FigureField(
            placeholder: TimeMath.fmt(row.t),
            text: Binding(get: { model.actuals[row.index]?.ato ?? "" },
                          set: { model.setATO($0, at: row.index) }),
            width: Widths.ato - 8,
            invalid: model.isATOMalformed(row.index))
        .padding(.trailing, 8)
        .disabled(model.pickingDirect)
    }

    private var fuelField: some View {
        FigureField(
            placeholder: row.waypoint.remaining.map(String.init) ?? "",
            text: Binding(get: { model.actuals[row.index]?.fuel ?? "" },
                          set: { model.setFuel($0, at: row.index) }),
            width: Widths.fuel - 8,
            highlighted: ring == .late ? palette.error : ring == .due ? palette.warn : nil)
        .padding(.trailing, 8)
        .disabled(model.pickingDirect)
    }

    private var difference: some View {
        let entry = model.actuals[row.index]?.fuel ?? ""
        guard let planned = row.waypoint.remaining, let actual = Int(entry) else {
            return AnyView(Text("—")
                .font(.mono(13, weight: .bold))
                .foregroundStyle(palette.fieldPlaceholder)
                .frame(width: Widths.diff, alignment: .trailing))
        }
        let d = actual - planned
        let colour = d == 0 ? PrintPalette.fuel : d > 0 ? PrintPalette.above : PrintPalette.below
        return AnyView(Text((d > 0 ? "+" : "") + String(d))
            .font(.mono(13, weight: .bold))
            .foregroundStyle(Color.onScreen(colour, theme: model.theme))
            .frame(width: Widths.diff, alignment: .trailing))
    }
}
