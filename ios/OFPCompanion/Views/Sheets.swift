import SwiftUI
import UIKit
import PDFKit

/// The system share sheet: "Save to Files", AirDrop, Print, or straight to ForeFlight.
/// Nothing leaves the device until the crew picks a destination here.
struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

/// A look at the filled document before saving it. PDFKit is fine for this — it only has
/// to draw the file, not write it.
struct PDFPreview: View {
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    let url: URL

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Filled document")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(palette.text)
                Spacer()
                Button("Close") { dismiss() }.buttonStyle(GhostButtonStyle())
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            Divider().overlay(palette.line)
            PDFKitView(url: url)
        }
        .background(palette.background.ignoresSafeArea())
    }
}

struct PDFKitView: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        view.displayDirection = .vertical
        view.document = PDFDocument(url: url)
        return view
    }

    func updateUIView(_ view: PDFView, context: Context) {
        if view.document?.documentURL != url {
            view.document = PDFDocument(url: url)
        }
    }
}
