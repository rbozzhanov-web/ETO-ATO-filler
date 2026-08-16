import SwiftUI
import OFPKit

/// The blanks on the form: ATIS, ATC CLRNC, the altimeter settings, PIC BLOCK and the
/// reason for extra fuel. Fields printed on the same line of the document are shown on the
/// same row here, so the screen reads like the paper.
struct DocumentFieldsCard: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.palette) private var palette

    private struct Row: Identifiable {
        let id: String
        let fields: [DocumentField]
    }

    private var rows: [Row] {
        guard let fields = model.plan?.fields else { return [] }
        var out: [Row] = []
        for field in fields {
            guard let first = field.segments.first else { continue }
            let key = "\(first.page):\(first.base)"
            if out.last?.id == key {
                out[out.count - 1] = Row(id: key, fields: out[out.count - 1].fields + [field])
            } else {
                out.append(Row(id: key, fields: [field]))
            }
        }
        return out
    }

    var body: some View {
        Card(step: "2", title: "Document fields") {
            VStack(alignment: .leading, spacing: 16) {
                ForEach(rows) { row in
                    if row.fields.count == 1 {
                        single(row.fields[0])
                    } else {
                        group(row)
                    }
                }
            }
        }
    }

    private func label(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 12))
            .foregroundStyle(palette.dim)
    }

    private func single(_ field: DocumentField) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            label(field.label.isEmpty ? "field \(field.index + 1)" : field.label)
            HStack(spacing: 8) {
                textField(field)
                if let reference = field.reference {
                    // Pinned beside the box rather than used as its placeholder: it is
                    // wanted most at the moment of typing, which is when a placeholder
                    // disappears. It is never written into the document.
                    Text("PLANNED BLKF (\(reference))")
                        .font(.mono(12))
                        .foregroundStyle(palette.dim)
                        .lineLimit(1)
                }
            }
            Text("\((model.fieldText[field.index] ?? "").count) / \(field.capacity)")
                .font(.system(size: 11))
                .foregroundStyle(palette.dim)
        }
    }

    private func group(_ row: Row) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            label(row.fields[0].rowLabel.isEmpty
                  ? row.fields.map(\.label).joined(separator: " / ")
                  : row.fields[0].rowLabel)
            HStack(alignment: .bottom, spacing: 14) {
                ForEach(row.fields, id: \.index) { field in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(field.label.isEmpty ? "field \(field.index + 1)" : field.label)
                            .font(.system(size: 11))
                            .foregroundStyle(palette.dim)
                        textField(field, width: 110)
                    }
                }
                Spacer(minLength: 0)
            }
        }
    }

    private func isNumeric(_ field: DocumentField) -> Bool {
        let numeric = ["ALTM1", "ALTM2", "STBY", "QNH", "PIC BLOCK"]
        return numeric.contains { $0.caseInsensitiveCompare(field.label) == .orderedSame }
    }

    private func textField(_ field: DocumentField, width: CGFloat? = nil) -> some View {
        let binding = Binding(
            get: { model.fieldText[field.index] ?? "" },
            set: { model.setField($0, at: field.index) })

        return TextField(String(repeating: ".", count: min(field.capacity, 40)), text: binding)
            .textFieldStyle(.plain)
            .font(.mono(15))
            .foregroundStyle(palette.text)
            .keyboardType(isNumeric(field) ? .numberPad : .default)
            .textInputAutocapitalization(.characters)
            .autocorrectionDisabled()
            .submitLabel(.next)
            .padding(12)
            .frame(width: width)
            .frame(maxWidth: width == nil ? .infinity : nil, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(palette.background)
                    .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(palette.line))
            )
    }
}
