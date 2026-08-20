import SwiftUI
import OFPKit

struct TakeoffCard: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.palette) private var palette
    @FocusState private var focused: Bool

    var body: some View {
        Card(step: "3", title: "Takeoff time (airborne), UTC") {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .bottom, spacing: 16) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("HHMM").font(.system(size: 12)).foregroundStyle(palette.dim)
                        TextField(model.plan?.times?.etd ?? "----", text: $model.takeoffText)
                            .textFieldStyle(.plain)
                            .font(.mono(24, weight: .bold))
                            .kerning(3)
                            .multilineTextAlignment(.center)
                            .keyboardType(.numberPad)
                            .focused($focused)
                            .frame(width: 148)
                            .padding(12)
                            .background(
                                RoundedRectangle(cornerRadius: 8)
                                    .fill(palette.background)
                                    .overlay(RoundedRectangle(cornerRadius: 8)
                                        .strokeBorder(focused ? palette.accent : palette.line))
                            )
                            .onChange(of: model.takeoffText) { value in
                                let cleaned = String(value.filter(\.isNumber).prefix(4))
                                if cleaned != value { model.takeoffText = cleaned }
                            }
                    }

                    Toggle(isOn: $model.includeAlternate) {
                        Text("Alternate route (ALTN)").font(.system(size: 14))
                    }
                    .toggleStyle(.switch)
                    .fixedSize()
                    .padding(.bottom, 8)
                    .onChange(of: model.includeAlternate) { _ in
                        if model.takeoff != nil { model.calculate() }
                    }

                    Button("Calculate") {
                        focused = false
                        model.calculate()
                    }
                    .buttonStyle(FilledButtonStyle())
                    .padding(.bottom, 4)

                    // The time you need in order to fill the box, next to the box — laid
                    // out like it, label above and figure below, and ticking from the
                    // moment the plan loads. Gold, so it is never taken for a time read
                    // off the plan.
                    VStack(alignment: .leading, spacing: 6) {
                        Text("UTC now").font(.system(size: 12)).foregroundStyle(palette.dim)
                        Text(model.clock)
                            .font(.mono(24, weight: .bold))
                            .monospacedDigit()
                            .foregroundStyle(palette.gold)
                            .padding(.vertical, 12)
                    }

                    Spacer(minLength: 0)
                }

                if let times = model.plan?.times {
                    documentTimes(times)
                }
                if let banner = model.calcBanner {
                    BannerView(banner: banner)
                }

                // The table opens underneath rather than in a card of its own.
                if model.takeoff != nil {
                    WaypointCard()
                }
            }
        }
    }

    private func documentTimes(_ times: FlightTimes) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                figure("STD", times.std)
                figure("ETD", times.etd)
                figure("STA", times.sta)
                figure("ETA", times.eta)
                if let trip = times.trip { figure("TRIP", trip) }
            }
            if let etd = times.etd {
                HStack(spacing: 10) {
                    Button("Use \(etd)") { model.useDocumentETD() }
                        .buttonStyle(GhostButtonStyle())
                    // ETD is off-block; the crew is entering the airborne time.
                    Text("ETD is off-block time — takeoff is normally later")
                        .font(.system(size: 12))
                        .foregroundStyle(palette.dim)
                }
            }
        }
    }

    private func figure(_ caption: String, _ value: String?) -> some View {
        HStack(spacing: 4) {
            Text(caption).font(.system(size: 13)).foregroundStyle(palette.dim)
            Text(value ?? "—").font(.mono(13, weight: .bold)).foregroundStyle(palette.text)
        }
    }
}
