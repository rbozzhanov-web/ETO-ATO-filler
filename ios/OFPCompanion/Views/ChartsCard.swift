import SwiftUI
import OFPKit

struct ChartsCard: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.palette) private var palette
    @Binding var showingCharts: Bool

    var body: some View {
        Card(step: "MAP", title: "Wind components & weather charts") {
            let count = model.plan?.charts.count ?? 0
            Disclosure(text: "\(count) full-page charts in this package — wind components, "
                       + "tropopause and significant weather.")
            Button("Open charts") { showingCharts = true }
                .buttonStyle(FilledButtonStyle())
        }
    }
}

/// Pages through the full-page pictures on their own, away from the rest of the app.
struct ChartViewer: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss

    @State private var index = 0
    @State private var zoomed = false
    @State private var image: UIImage?
    @State private var failure: String?
    @State private var decoding = false

    private var charts: [ChartPage] { model.plan?.charts ?? [] }

    var body: some View {
        VStack(spacing: 0) {
            toolbar
            Divider().overlay(palette.line)
            content
        }
        .background(palette.background.ignoresSafeArea())
        .task(id: index) { await load() }
    }

    private var toolbar: some View {
        HStack(spacing: 10) {
            Text(charts.isEmpty
                 ? "Charts"
                 : "Chart \(index + 1) of \(charts.count)  ·  page \(charts[index].page + 1)")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(palette.text)
            Spacer(minLength: 8)

            Button("Prev") { if index > 0 { index -= 1 } }
                .buttonStyle(GhostButtonStyle())
                .disabled(index == 0)
            Button("Next") { if index < charts.count - 1 { index += 1 } }
                .buttonStyle(GhostButtonStyle())
                .disabled(index >= charts.count - 1)
            Button(zoomed ? "Fit" : "Zoom") { zoomed.toggle() }
                .buttonStyle(GhostButtonStyle())
            Button("Close") { dismiss() }
                .buttonStyle(GhostButtonStyle())
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    @ViewBuilder
    private var content: some View {
        if let failure {
            VStack {
                Spacer()
                Disclosure(text: failure)
                Spacer()
            }
            .padding(24)
        } else if let image {
            if zoomed {
                // Full size, scrolling in both directions.
                ScrollView([.horizontal, .vertical]) {
                    Image(uiImage: image).resizable().frame(
                        width: image.size.width, height: image.size.height)
                }
            } else {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .padding(12)
            }
        } else {
            VStack {
                Spacer()
                ProgressView(decoding ? "Decoding…" : "Loading…")
                    .tint(palette.accent)
                    .foregroundStyle(palette.dim)
                Spacer()
            }
        }
    }

    /// Decoding a 1800×1451 bitmap is not free, so it happens off the main thread when the
    /// crew asks for the page, and the result is kept for the rest of the session.
    @MainActor
    private func load() async {
        guard charts.indices.contains(index) else { return }
        image = nil
        failure = nil
        decoding = true
        let chart = charts[index]
        let document = model.document
        let decoded = await Task.detached(priority: .userInitiated) {
            document.flatMap { ChartRenderer.image(document: $0, chart: chart) }
        }.value
        decoding = false
        if let decoded {
            image = decoded
        } else {
            failure = "Could not read this chart — its encoding is not one this app handles."
        }
        zoomed = false
    }
}
