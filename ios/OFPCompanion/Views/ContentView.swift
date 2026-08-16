import SwiftUI
import OFPKit

struct ContentView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.scenePhase) private var scenePhase

    @State private var showingGuide = false
    @State private var showingCharts = false

    var body: some View {
        let palette = model.theme.palette

        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HeaderView(showingGuide: $showingGuide)

                LoadCard()

                if model.isLoaded {
                    if !(model.plan?.fields.isEmpty ?? true) {
                        DocumentFieldsCard()
                    }
                    TakeoffCard()
                    if model.takeoff != nil {
                        WaypointCard()
                        if !model.altimeterChecks.isEmpty {
                            AltimeterCard()
                        }
                    }
                    ExportCard()
                    if !(model.plan?.airports.isEmpty ?? true) {
                        WeatherCard()
                    }
                    if !(model.plan?.charts.isEmpty ?? true) {
                        ChartsCard(showingCharts: $showingCharts)
                    }
                }
            }
            .padding(.horizontal, 18)
            .padding(.top, 20)
            .padding(.bottom, 70)
            .frame(maxWidth: 1120)
            .frame(maxWidth: .infinity)
        }
        .background(palette.background.ignoresSafeArea())
        .environment(\.palette, palette)
        .preferredColorScheme(model.theme.colorScheme)
        .scrollDismissesKeyboard(.interactively)
        .sheet(isPresented: $showingGuide) {
            GuideSheet().environment(\.palette, palette)
                .preferredColorScheme(model.theme.colorScheme)
        }
        .fullScreenCover(isPresented: $showingCharts) {
            ChartViewer().environmentObject(model).environment(\.palette, palette)
                .preferredColorScheme(model.theme.colorScheme)
        }
        .onAppear { model.resumeIfPossible() }
        .onChange(of: scenePhase) { phase in
            // Both of these fire before iPadOS freezes the app.
            if phase != .active { model.flushSave() }
        }
    }
}

struct HeaderView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.palette) private var palette
    @Binding var showingGuide: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 18) { titleBlock; Spacer(minLength: 12); controls }
                VStack(alignment: .leading, spacing: 12) { titleBlock; controls }
            }
            Rectangle().fill(palette.gold).frame(height: 1)
        }
        .padding(.bottom, 6)
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("OFP Companion").font(.system(size: 20, weight: .semibold)).kerning(0.3)
            Text("Operational flight plan — in flight")
                .font(.system(size: 13)).foregroundStyle(palette.dim)

            if let identity = model.plan?.identity {
                Text(Identity.summary(identity))
                    .font(.mono(12.5, weight: .bold))
                    .kerning(0.4)
                    .foregroundStyle(palette.accent)
            }
            if let figures = model.plan?.figures, !figures.summary.isEmpty {
                Text(figures.summary)
                    .font(.mono(12))
                    .kerning(0.3)
                    .foregroundStyle(palette.dim)
            }
        }
        .foregroundStyle(palette.text)
    }

    private var controls: some View {
        HStack(spacing: 12) {
            Button("User guide") { showingGuide = true }
                .buttonStyle(GhostButtonStyle(small: false))

            HStack(spacing: 3) {
                themeButton(.light, symbol: "sun.max")
                themeButton(.dark, symbol: "moon")
            }
            .padding(3)
            .background(
                RoundedRectangle(cornerRadius: 9)
                    .fill(palette.panel)
                    .overlay(RoundedRectangle(cornerRadius: 9).strokeBorder(palette.line))
            )
        }
    }

    private func themeButton(_ theme: AppTheme, symbol: String) -> some View {
        let selected = model.theme == theme
        return Button {
            model.theme = theme
        } label: {
            Image(systemName: symbol)
                .font(.system(size: 17, weight: .medium))
                .frame(width: 42, height: 34)
                .foregroundStyle(selected ? palette.accent : palette.dim)
                .background(
                    RoundedRectangle(cornerRadius: 6)
                        .fill(selected ? palette.accent.opacity(0.16) : .clear)
                )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(theme == .light ? "Light theme" : "Dark theme")
    }
}
