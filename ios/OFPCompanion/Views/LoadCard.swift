import SwiftUI
import UniformTypeIdentifiers
import OFPKit

struct LoadCard: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.palette) private var palette

    @State private var importing = false
    @State private var dropTargeted = false
    @State private var copied = false

    var body: some View {
        Card(step: "1", title: "Load the flight plan PDF") {
            Button { importing = true } label: {
                VStack(spacing: 8) {
                    if model.isLoading {
                        ProgressView("Reading the plan…")
                            .tint(palette.accent)
                            .foregroundStyle(palette.dim)
                    } else {
                        Text("Tap to choose a PDF")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(palette.accent)
                    }
                    if !model.documentName.isEmpty {
                        Text(model.documentName)
                            .font(.system(size: 13))
                            .foregroundStyle(palette.dim)
                            .multilineTextAlignment(.center)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 32)
                .padding(.horizontal, 20)
                .background(
                    RoundedRectangle(cornerRadius: 8)
                        .fill(palette.panel2)
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .strokeBorder(dropTargeted ? palette.accent : palette.line,
                                              style: StrokeStyle(lineWidth: 2, dash: [6, 4]))
                        )
                )
            }
            .buttonStyle(.plain)
            .disabled(model.isLoading)
            // The plan can also be dragged straight out of Files in Split View.
            .dropDestination(for: URL.self) { urls, _ in
                guard let url = urls.first(where: { $0.pathExtension.lowercased() == "pdf" })
                else { return false }
                model.loadFile(at: url)
                return true
            } isTargeted: { dropTargeted = $0 }

            if !model.isLoaded {
                Disclosure(text: "Only Air Astana computerized flight plans are supported.")
            }

            if let icao = model.plan?.icao {
                icaoBox(icao)
            }
            if let banner = model.loadBanner {
                BannerView(banner: banner)
            }
        }
        .fileImporter(isPresented: $importing,
                      allowedContentTypes: [.pdf],
                      allowsMultipleSelection: false) { result in
            if case .success(let urls) = result, let url = urls.first {
                model.loadFile(at: url)
            }
        }
    }

    private func icaoBox(_ icao: IcaoFlightPlan) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Text("ICAO flight plan")
                    .font(.system(size: 12, weight: .semibold))
                    .textCase(.uppercase).kerning(0.7)
                    .foregroundStyle(palette.dim)
                Text(icao.split
                     ? "reassembled from pages \(icao.pages.first ?? 0)–\(icao.pages.last ?? 0)"
                     : "page \(icao.pages.first ?? 0)")
                    .font(.system(size: 12))
                    .foregroundStyle(palette.dim)
                Spacer(minLength: 8)
                Button(copied ? "Copied" : "Copy") {
                    UIPasteboard.general.string = icao.oneLine
                    copied = true
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) { copied = false }
                }
                .buttonStyle(GhostButtonStyle())
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .overlay(alignment: .bottom) { Rectangle().fill(palette.line).frame(height: 1) }

            Text(icao.lines.joined(separator: "\n"))
                .font(.mono(13))
                .foregroundStyle(palette.text)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
        }
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(palette.panel2)
                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(palette.line))
        )
    }
}
