import SwiftUI
import OFPKit

/// METAR, TAF and NOTAMs carried by the loaded package.
///
/// Everything here was read out of the PDF on the device: there is no network request, no
/// account and no key, so the card works in airplane mode like the rest of the app. The
/// reports are therefore exactly as old as the document.
struct WeatherCard: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.palette) private var palette

    private var airports: [Airport] { model.plan?.airports ?? [] }

    private var selected: Airport? {
        guard !airports.isEmpty else { return nil }
        return airports[min(model.selectedAirport, airports.count - 1)]
    }

    var body: some View {
        Card(step: "WX", title: "Weather & NOTAMs") {
            Disclosure(text: "Read out of this flight plan package — nothing is fetched from "
                       + "the network. Re-brief from the current source before acting on it.")

            HStack(alignment: .bottom, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Aerodrome").font(.system(size: 12)).foregroundStyle(palette.dim)
                    Picker("Aerodrome", selection: $model.selectedAirport) {
                        ForEach(AirportGroup.allCases, id: \.self) { group in
                            let items = indexed.filter { $0.airport.group == group }
                            if !items.isEmpty {
                                Section(group.title) {
                                    ForEach(items, id: \.index) { item in
                                        Text(item.airport.listTitle).tag(item.index)
                                    }
                                }
                            }
                        }
                    }
                    .pickerStyle(.menu)
                    .tint(palette.text)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(
                        RoundedRectangle(cornerRadius: 5)
                            .fill(palette.panel2)
                            .overlay(RoundedRectangle(cornerRadius: 5).strokeBorder(palette.line))
                    )
                }
                if let selected {
                    Text(selected.counts)
                        .font(.system(size: 12))
                        .foregroundStyle(palette.dim)
                        .padding(.bottom, 8)
                }
                Spacer(minLength: 0)
            }

            if let airport = selected {
                content(airport)
            }
        }
    }

    private var indexed: [(index: Int, airport: Airport)] {
        airports.enumerated().map { ($0.offset, $0.element) }
    }

    @ViewBuilder
    private func content(_ airport: Airport) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            if !airport.metar.isEmpty {
                block("METAR") { reports(airport.metar) }
            }
            if !airport.taf.isEmpty {
                block("TAF") { reports(airport.taf) }
            }
            if !airport.notams.isEmpty {
                // A busy aerodrome runs to eighty-odd NOTAMs, so the list scrolls inside
                // the card instead of pushing the rest of the page away.
                block("NOTAM · \(airport.notams.count) items") {
                    NotamList(items: airport.notams)
                }
            }
            if !airport.company.isEmpty {
                block("Company NOTAMs") { NotamList(items: airport.company) }
            }
            if airport.isEmpty {
                Disclosure(text: "Nothing recorded for this aerodrome.")
            }
        }
    }

    private func reports(_ items: [String]) -> some View {
        Text(items.joined(separator: "\n\n"))
            .font(.mono(13))
            .foregroundStyle(palette.text)
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
    }

    private func block<Content: View>(_ title: String,
                                      @ViewBuilder content: () -> Content) -> some View {
        VStack(spacing: 0) {
            Text(title)
                .font(.system(size: 12, weight: .semibold))
                .textCase(.uppercase).kerning(0.7)
                .foregroundStyle(palette.dim)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 12)
                .padding(.vertical, 9)
                .overlay(alignment: .bottom) { Rectangle().fill(palette.line).frame(height: 1) }
            content()
        }
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(palette.panel2)
                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(palette.line))
        )
    }
}

struct NotamList: View {
    @Environment(\.palette) private var palette
    let items: [Notam]

    @State private var metrics = ScrollMetrics()
    private let space = "notams"

    var body: some View {
        GeometryReader { viewport in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                        row(item)
                        if index < items.count - 1 {
                            Rectangle().fill(palette.line2).frame(height: 1)
                        }
                    }
                }
                .measureScroll(space: space, into: $metrics)
            }
            .coordinateSpace(name: space)
            .onAppear { metrics.viewportHeight = viewport.size.height }
            .onChange(of: viewport.size.height) { metrics.viewportHeight = $0 }
        }
        .frame(height: min(480, max(140, CGFloat(items.count) * 96)))
        .scrollEdgeHints(more: metrics.canScrollDown, previous: metrics.canScrollUp,
                         background: palette.panel2)
    }

    private func row(_ item: Notam) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(item.id)
                    .font(.mono(12, weight: .bold))
                    .foregroundStyle(palette.accent)
                if let validity = item.validityText {
                    Text(validity)
                        .font(.system(size: 11.5))
                        .foregroundStyle(palette.dim)
                }
                Spacer(minLength: 0)
            }
            if let subject = item.subject {
                Text(subject)
                    .font(.system(size: 11, weight: .bold))
                    .textCase(.uppercase).kerning(0.5)
                    .foregroundStyle(palette.gold)
            }
            Text(item.text)
                .font(.mono(13))
                .foregroundStyle(palette.text)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
    }
}
