import SwiftUI
import OFPKit

struct ExportCard: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.palette) private var palette

    @State private var shareTarget: OutputFile?
    @State private var previewTarget: OutputFile?
    @State private var warnings: [String] = []
    @State private var confirmingSave = false
    @State private var confirmingReset = false

    var body: some View {
        Card(step: "6", title: "Export") {
            HStack(spacing: 12) {
                Button("Save PDF") { startSave() }
                    .buttonStyle(FilledButtonStyle())
                    .disabled(model.isBuilding)

                Button("Preview filled PDF") { preview() }
                    .buttonStyle(GhostButtonStyle(small: false))

                Button("Reset") { confirmingReset = true }
                    .buttonStyle(FilledButtonStyle(tint: palette.danger))

                Spacer(minLength: 0)
            }

            if let banner = model.exportBanner {
                BannerView(banner: banner)
            }

            note
        }
        .sheet(item: $shareTarget) { target in
            ShareSheet(items: [target.url])
        }
        .sheet(item: $previewTarget) { target in
            PDFPreview(url: target.url).environment(\.palette, palette)
        }
        .confirmationDialog(warnings.joined(separator: "\n\n"),
                            isPresented: $confirmingSave, titleVisibility: .visible) {
            Button("Save anyway") { produce() }
            Button("Go back", role: .cancel) {}
        }
        .confirmationDialog(
            "Reset everything? The loaded plan and all entered data will be discarded.",
            isPresented: $confirmingReset, titleVisibility: .visible) {
            Button("Reset", role: .destructive) { model.reset() }
            Button("Keep working", role: .cancel) {}
        }
    }

    /// Saving with a check still missing asks first — it is the last chance to notice.
    private func startSave() {
        warnings = model.exportWarnings()
        if warnings.isEmpty { produce() } else { confirmingSave = true }
    }

    private func produce() {
        model.isBuilding = true
        defer { model.isBuilding = false }
        do {
            shareTarget = OutputFile(url: try model.buildPDF())
            model.exportBanner = Banner(kind: .ok,
                text: "Ready — choose “Save to Files” in the share sheet.")
        } catch {
            model.exportBanner = Banner(kind: .error, text: "Error: \(error.localizedDescription)")
        }
    }

    private func preview() {
        do {
            previewTarget = OutputFile(url: try model.buildPDF())
            model.exportBanner = nil
        } catch {
            model.exportBanner = Banner(kind: .error, text: "Error: \(error.localizedDescription)")
        }
    }

    private var note: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Everything you enter is printed in bold Courier-Bold over the original document:")
                .font(.system(size: 12.5))
                .foregroundStyle(palette.dim)
            HStack(spacing: 14) {
                swatch(PrintPalette.eto, "ETO")
                swatch(PrintPalette.ato, "ATO")
                swatch(PrintPalette.fuel, "fuel")
                swatch(PrintPalette.field, "fields")
            }
            Text("DIFF stays green when fuel is above plan and red when below. "
                 + "Fully offline: the PDF is parsed and written on this device.")
                .font(.system(size: 12.5))
                .foregroundStyle(palette.dim)
        }
    }

    private func swatch(_ colour: PDFColor, _ caption: String) -> some View {
        HStack(spacing: 5) {
            RoundedRectangle(cornerRadius: 3)
                .fill(Color(.sRGB, red: colour.r, green: colour.g, blue: colour.b, opacity: 1))
                .frame(width: 12, height: 12)
                .overlay(RoundedRectangle(cornerRadius: 3).strokeBorder(palette.line))
            Text(caption).font(.mono(12)).foregroundStyle(palette.dim)
        }
    }
}

/// `sheet(item:)` wants something identifiable, and conforming `URL` itself would be a
/// retroactive conformance to two types this app does not own.
struct OutputFile: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
}
