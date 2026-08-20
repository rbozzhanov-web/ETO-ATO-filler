import SwiftUI
import OFPKit

/// One sheet of the log, drawn at its true size in points and scaled as a whole.
///
/// The sheet is held at one scale rather than letting the system zoom it: were the page
/// itself zoomed, a tapped box would jump under the finger and the toolbar would sail off.
struct JourneyLogSheetView: View {
    @EnvironmentObject private var model: JourneyLogModel
    @Environment(\.palette) private var palette

    let page: Int
    let layout: JourneyLogLayout
    @FocusState.Binding var focused: String?

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.white

            ForEach(Array(layout.bands.enumerated()), id: \.offset) { _, band in
                Rectangle()
                    .fill(Color(white: band.light ? 0.92 : 0.85))
                    .frame(width: band.width, height: band.height)
                    .offset(x: band.x, y: band.y)
            }

            ForEach(Array(layout.rules.enumerated()), id: \.offset) { _, rule in
                Rectangle()
                    .fill(Color.black)
                    .frame(width: rule.width, height: rule.height)
                    .offset(x: rule.x, y: rule.y)
            }

            ForEach(Array(layout.captions.enumerated()), id: \.offset) { _, caption in
                Text(caption.text)
                    .font(.system(size: 7.5, weight: caption.bold ? .semibold : .regular))
                    .foregroundStyle(.black)
                    .lineLimit(1)
                    .minimumScaleFactor(JourneyLogPrinter.minimumScale)
                    .frame(width: caption.sizesToText ? nil : caption.width,
                           height: caption.height,
                           alignment: caption.align == .centre ? .center : .leading)
                    .fixedSize(horizontal: caption.sizesToText, vertical: false)
                    .offset(x: caption.x, y: caption.y)
            }

            ForEach(Array(layout.fields.enumerated()), id: \.offset) { _, field in
                cell(field)
            }

            ForEach(Array(layout.duplicators.enumerated()), id: \.offset) { _, button in
                Button {
                    model.carryDown(page: page, key: button.key, from: button.from)
                } label: {
                    Image(systemName: "arrow.down")
                        .font(.system(size: 6, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 9, height: 9)
                        .background(Circle().fill(Color.black.opacity(0.45)))
                }
                .buttonStyle(.plain)
                .help("Put this on every crew member")
                .offset(x: button.x, y: button.y)
            }
        }
        .frame(width: JourneyLogForm.pageWidth, height: JourneyLogForm.pageHeight,
               alignment: .topLeading)
        .clipped()
    }

    @ViewBuilder
    private func cell(_ field: JourneyLogLayout.Field) -> some View {
        let path = field.path(page: page)
        let binding = Binding(
            get: { model.value(page: page, table: field.table, row: field.row, key: field.key) },
            set: { model.set($0, page: page, table: field.table, row: field.row,
                             key: field.key, uppercase: !field.printed) })

        if field.printed {
            // What the document was printed with is shown, not offered: it reads as print,
            // and the return key steps straight past it.
            Text(binding.wrappedValue)
                .font(.system(size: 7.5))
                .foregroundStyle(.black)
                .lineLimit(1)
                .minimumScaleFactor(JourneyLogPrinter.minimumScale)
                .frame(width: field.width, height: field.height,
                       alignment: field.align == .centre ? .center : .leading)
                .offset(x: field.x, y: field.y)
        } else {
            TextField("", text: binding)
                .textFieldStyle(.plain)
                .font(.system(size: 7.5))
                .foregroundStyle(Color(red: 0, green: 0.2, blue: 0.8))
                .multilineTextAlignment(field.align == .centre ? .center : .leading)
                .keyboardType(field.numeric ? .numbersAndPunctuation : .default)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.characters)
                .minimumScaleFactor(JourneyLogPrinter.minimumScale)
                .lineLimit(1)
                .focused($focused, equals: path)
                .frame(width: field.width, height: field.height)
                .background(focused == path ? Color.yellow.opacity(0.25) : Color.clear)
                .onSubmit { model.normaliseTime(page: page, table: field.table,
                                                row: field.row, key: field.key) }
                .onChange(of: focused) { now in
                    // Tidied as the box is left, not while it is still being typed in.
                    if now != path, field.time {
                        model.normaliseTime(page: page, table: field.table,
                                            row: field.row, key: field.key)
                    }
                }
                .offset(x: field.x, y: field.y)
        }
    }
}
