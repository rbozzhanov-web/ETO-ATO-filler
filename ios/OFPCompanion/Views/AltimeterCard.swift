import SwiftUI
import OFPKit

struct AltimeterCard: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.palette) private var palette

    var body: some View {
        Card(step: "5", title: "Altimeter cross-checks") {
            Disclosure(text: "Hourly comparison of ALTM1 / STBY / ALTM2, printed next to the "
                       + "waypoint reached at each full hour after takeoff.")

            HStack(spacing: 12) {
                // The clock is deliberately outside the toggle's label: a label toggles its
                // switch from anywhere inside it, and a glance-and-tap at the clock used to
                // silence the alert.
                Toggle(isOn: $model.alarmEnabled) {
                    Text("Alert me when a check falls due").font(.system(size: 14))
                }
                .toggleStyle(.switch)
                .fixedSize()
                .onChange(of: model.alarmEnabled) { _ in model.save() }

                Text("UTC now \(model.clock)")
                    .font(.mono(13))
                    .monospacedDigit()
                    .foregroundStyle(palette.gold)
                Spacer(minLength: 0)
            }

            let overdue = model.overdueAltimeterChecks
            if !overdue.isEmpty {
                BannerView(banner: Banner(kind: .error, text: overdue.count == 1
                    ? "One altimeter cross-check is due and not recorded."
                    : "\(overdue.count) altimeter cross-checks are due and not recorded."))
            }

            VStack(spacing: 10) {
                ForEach(model.altimeterChecks, id: \.mark) { check in
                    row(check)
                }
            }
        }
    }

    private func row(_ check: AltimeterCheck) -> some View {
        let reading = model.readings[check.mark]
        let state = check.state(reading: reading, now: model.minute)
        let late = state == .late

        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(check.label)
                    .font(.mono(13, weight: .bold))
                    .foregroundStyle(palette.text)
                Text(TimeMath.fmt(check.row.t))
                    .font(.mono(13, weight: .bold))
                    .foregroundStyle(palette.accent)
                Text("at \(check.row.name)")
                    .font(.system(size: 13))
                    .foregroundStyle(palette.dim)
                Spacer(minLength: 0)
            }

            Text(check.status(reading: reading, now: model.minute))
                .font(.system(size: 12))
                .foregroundStyle(statusColour(state))

            HStack(spacing: 12) {
                ForEach(AltimeterReading.Field.allCases, id: \.self) { field in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(field.caption)
                            .font(.system(size: 11))
                            .foregroundStyle(palette.dim)
                        FigureField(
                            placeholder: "....",
                            text: Binding(
                                get: { model.readings[check.mark]?[field] ?? "" },
                                set: { model.setReading($0, mark: check.mark, field: field) }),
                            width: 88)
                    }
                }
                Spacer(minLength: 0)
            }
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(late ? palette.error.opacity(0.10) : palette.panel2)
                .overlay(RoundedRectangle(cornerRadius: 8)
                    .strokeBorder(late ? palette.error.opacity(0.5) : palette.line))
        )
    }

    private func statusColour(_ state: CheckState) -> Color {
        switch state {
        case .done: return palette.ok
        case .partial, .soon: return palette.warn
        case .late: return palette.error
        case .waiting: return palette.dim
        }
    }
}
