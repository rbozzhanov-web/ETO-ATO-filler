import SwiftUI
import UniformTypeIdentifiers
import OFPKit

struct JourneyLogView: View {
    @EnvironmentObject private var model: JourneyLogModel
    @Environment(\.palette) private var palette
    @Environment(\.scenePhase) private var scenePhase

    /// Which apps the toolbar can cross to.
    let showCompanion: () -> Void

    @State private var importing = false
    @State private var dropTargeted = false
    @State private var shareTarget: OutputFile?
    @State private var confirmingClear = false
    @State private var confirmingRemove = false
    @FocusState private var focused: String?

    // nil means fitted to the window, which is where it starts.
    @State private var zoom: Double?
    /// The scale the pinch began from, so the gesture multiplies once rather than compounding.
    @State private var zoomAtGestureStart: Double?

    var body: some View {
        VStack(spacing: 0) {
            toolbar
            Divider().overlay(palette.line)
            if model.isLoaded {
                sheets
            } else {
                loadCard
            }
        }
        .background(palette.background.ignoresSafeArea())
        .fileImporter(isPresented: $importing,
                      allowedContentTypes: [.pdf],
                      allowsMultipleSelection: false) { result in
            if case .success(let urls) = result, let url = urls.first {
                model.loadFile(at: url)
            }
        }
        .sheet(item: $shareTarget) { ShareSheet(items: [$0.url]) }
        .confirmationDialog("Clear everything typed into this log?",
                            isPresented: $confirmingClear, titleVisibility: .visible) {
            Button("Clear entries", role: .destructive) { model.clearEntries() }
            Button("Keep them", role: .cancel) {}
        }
        .confirmationDialog("Remove the log? The document and everything in it will be discarded.",
                            isPresented: $confirmingRemove, titleVisibility: .visible) {
            Button("Remove log", role: .destructive) { model.removeLog() }
            Button("Keep it", role: .cancel) {}
        }
        .onChange(of: scenePhase) { phase in
            if phase != .active { model.flushSave() }
        }
    }

    // MARK: - Toolbar

    private var toolbar: some View {
        HStack(spacing: 10) {
            Text("Journey Log")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(palette.text)
            Spacer(minLength: 8)

            if model.isLoaded {
                Button("Save PDF") { export() }.buttonStyle(GhostButtonStyle())
                Button("Clear entries") { confirmingClear = true }.buttonStyle(GhostButtonStyle())
                Button("Remove log") { confirmingRemove = true }
                    .buttonStyle(FilledButtonStyle(tint: palette.danger))
            }
            // Last but for the gap: it comes to rest where the companion keeps the button
            // that crosses the other way.
            Button("OFP Companion") { showCompanion() }.buttonStyle(GhostButtonStyle())
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    // MARK: - Loading

    private var loadCard: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Card(step: "1", title: "Load the Journey Log PDF") {
                    Button { importing = true } label: {
                        VStack(spacing: 8) {
                            if model.isLoading {
                                ProgressView("Reading the log…")
                                    .tint(palette.accent)
                                    .foregroundStyle(palette.dim)
                            } else {
                                Text("Tap to choose a PDF")
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundStyle(palette.accent)
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 32)
                        .background(
                            RoundedRectangle(cornerRadius: 8)
                                .fill(palette.panel2)
                                .overlay(RoundedRectangle(cornerRadius: 8)
                                    .strokeBorder(dropTargeted ? palette.accent : palette.line,
                                                  style: StrokeStyle(lineWidth: 2, dash: [6, 4])))
                        )
                    }
                    .buttonStyle(.plain)
                    .disabled(model.isLoading)
                    .dropDestination(for: URL.self) { urls, _ in
                        guard let url = urls.first(where: { $0.pathExtension.lowercased() == "pdf" })
                        else { return false }
                        model.loadFile(at: url)
                        return true
                    } isTargeted: { dropTargeted = $0 }

                    Disclosure(text: "Only Air Astana Journey Logs are supported.")
                    Disclosure(text: "The form is drawn from the document you load — its legs, "
                               + "its crew, its number of rows. Nothing leaves the device.")
                    Disclosure(text: "Times take four digits — 0340 becomes 03:40. Blk and Flt "
                               + "are worked out from the times either side until you write in "
                               + "them yourself.")

                    if let banner = model.banner { BannerView(banner: banner) }
                }
            }
            .padding(18)
            .frame(maxWidth: 900)
            .frame(maxWidth: .infinity)
        }
    }

    // MARK: - The sheets

    private var sheets: some View {
        GeometryReader { viewport in
            let fitted = max(0.2, (viewport.size.width - 32) / JourneyLogForm.pageWidth)
            let scale = zoom ?? fitted

            ScrollView([.horizontal, .vertical]) {
                VStack(spacing: 16) {
                    ForEach(0..<model.pageCount, id: \.self) { index in
                        JourneyLogSheetView(
                            page: index,
                            layout: JourneyLogLayout.build(document: model.document, page: index),
                            focused: $focused)
                        .scaleEffect(scale, anchor: .topLeading)
                        .frame(width: JourneyLogForm.pageWidth * scale,
                               height: JourneyLogForm.pageHeight * scale)
                        .background(Color.white)
                        .shadow(color: .black.opacity(0.25), radius: 6, y: 2)
                    }
                }
                .padding(16)
            }
            // Pinch the sheets, the way any document is handled.
            .gesture(
                MagnificationGesture()
                    .onChanged { value in
                        let base = zoomAtGestureStart ?? (zoom ?? fitted)
                        if zoomAtGestureStart == nil { zoomAtGestureStart = base }
                        zoom = min(4, max(0.3, base * value))
                    }
                    .onEnded { _ in zoomAtGestureStart = nil }
            )
            .overlay(alignment: .bottomTrailing) { zoomControls(fitted: fitted) }
        }
    }

    private func zoomControls(fitted: Double) -> some View {
        HStack(spacing: 6) {
            Button { zoom = min(4, (zoom ?? fitted) * 1.25) } label: { Image(systemName: "plus.magnifyingglass") }
            Button { zoom = max(0.3, (zoom ?? fitted) / 1.25) } label: { Image(systemName: "minus.magnifyingglass") }
            Button("Fit") { zoom = nil }
        }
        .font(.system(size: 13, weight: .semibold))
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 8).fill(palette.panel)
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(palette.line)))
        .padding(16)
    }

    private func export() {
        focused = nil
        do {
            shareTarget = OutputFile(url: try model.buildPDF())
        } catch {
            model.banner = Banner(kind: .error, text: "Error: \(error.localizedDescription)")
        }
    }
}
