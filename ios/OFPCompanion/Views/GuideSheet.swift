import SwiftUI

/// The user guide, carried over from the web app so the crew reads the same words.
struct GuideSheet: View {
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    section("Quick start", items: [
                        "**Load** the flight plan PDF. The ICAO flight plan is pulled out and "
                        + "shown under the box. Where it is printed across a page break it is "
                        + "stitched back into one text with the page headers removed, and Copy "
                        + "gives it as a single line.",
                        "**Document fields** — ATIS, ATC CLRNC, altimeter settings, PIC BLOCK. "
                        + "Free-text boxes also use the empty space to the right of the blank "
                        + "and the spare line underneath, so they hold far more than the dots "
                        + "suggest. The counter under each box shows how much room is left.",
                        "**Takeoff time** in UTC, four digits. The button beside it fills in "
                        + "the ETD from the plan — but that is off-block time and takeoff is "
                        + "normally later, so check it.",
                        "**Actuals** — ATO and remaining fuel per waypoint. Everything is saved "
                        + "as you type.",
                        "**Save PDF** → choose \"Save to Files\", AirDrop, Print, or send it to "
                        + "ForeFlight."
                    ])

                    section("The table follows the clock", items: [
                        "Passed points fade back, the last one passed is shaded and the one you "
                        + "are running to is highlighted. The table brings that row to its "
                        + "middle as the flight moves on.",
                        "It holds still for twenty seconds after you scroll it or type in it. "
                        + "Focus is not what stops it — Enter steps from one box to the next, so "
                        + "a box would stay focused for the rest of the flight.",
                        "The highlight follows the plan rather than your typing, so it stays "
                        + "right when the actuals are a few points behind. The most recent ATO "
                        + "sets how far the flight is running from plan, and every later "
                        + "waypoint is judged against that."
                    ])

                    section("Altimeter cross-checks", items: [
                        "The app works out which waypoint falls on each full hour after takeoff "
                        + "and lists one row per hour. The reading is printed on the blank line "
                        + "directly under that waypoint, so the time is read off the ETO/ATO "
                        + "right above it.",
                        "Each row tracks its own due time against the device clock in UTC and "
                        + "turns red once overdue, with a short tone when it first falls due. No "
                        + "check is raised inside the last hour before arrival.",
                        "Saving the PDF with checks still missing asks for confirmation first."
                    ])

                    section("Fuel checks", items: [
                        "Company rule is a fuel check on overflying a waypoint, or at least "
                        + "every 30 minutes. It is watched on the waypoint card itself, because "
                        + "the record it needs — the fuel column — is already there.",
                        "The figure shows when the next check is due, amber as it comes up and "
                        + "red once it has passed unrecorded. The fuel box it belongs in is "
                        + "ringed. Any one figure in the window will do.",
                        "The windows follow the flight rather than the paper: a waypoint counts "
                        + "towards the window it is actually reached in. A direct that cuts out "
                        + "everything in a half hour does not cancel that check — the clock is "
                        + "what the rule runs on — so it is written on the next waypoint "
                        + "overflown instead."
                    ])

                    section("Direct to", items: [
                        "When ATC shortcuts the route, press **Direct to…** and tap the waypoint "
                        + "you are cleared to. The waypoints cut out stay where they are, struck "
                        + "through and faded — the order has to keep matching the paper form, "
                        + "because that is where the ATOs are written — and the target is marked "
                        + "**DCT**.",
                        "They are not gone from the sky, though: the aeroplane still goes past "
                        + "them, so they keep their own place on the clock. The one you are "
                        + "level with is marked **ABEAM** and shaded more faintly than the live "
                        + "route, so the two can never be read for each other.",
                        "Nothing about this reaches the document and no ETO is rewritten; it "
                        + "only moves the highlight. The chip in the toolbar undoes it, and each "
                        + "direct remembers exactly which waypoints it cut out."
                    ])

                    section("Weather and NOTAMs", items: [
                        "The card at the bottom shows the METAR, TAF and NOTAMs carried by the "
                        + "loaded package, grouped by aerodrome: this flight, areas along the "
                        + "route, then everything else.",
                        "Everything is read out of the PDF on the device. There is no network "
                        + "request, no account and no key. The reports are therefore exactly as "
                        + "old as the document — re-brief from the current source before acting "
                        + "on them."
                    ])

                    section("If the app is closed", items: [
                        "iPadOS drops background apps when it needs the memory. The loaded plan "
                        + "is kept on the device alongside everything typed into it, so opening "
                        + "the app again brings the same document back with the takeoff time, "
                        + "the actuals and the altimeter readings already in place. Cross-checks "
                        + "that have already sounded do not sound a second time.",
                        "**Reset** is what clears it and returns to an empty drop zone."
                    ])

                    section("What is inside", items: [
                        "No external PDF library. The app carries its own minimal engine: it "
                        + "reads text with coordinates out of the document's compressed streams "
                        + "and appends an overlay through an incremental update, so the original "
                        + "bytes stay untouched and new content is simply added at the end.",
                        "Built for Air Astana plans. If the format turns out to be different, "
                        + "the app says so on load instead of damaging the document."
                    ])
                }
                .padding(20)
                .frame(maxWidth: 760, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .background(palette.background.ignoresSafeArea())
            .navigationTitle("User guide")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Close") { dismiss() }
                }
            }
        }
    }

    private func section(_ title: String, items: [String]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(palette.text)
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                HStack(alignment: .top, spacing: 10) {
                    Circle().fill(palette.gold).frame(width: 5, height: 5).padding(.top, 8)
                    Text(markdown(item))
                        .font(.system(size: 14.5))
                        .foregroundStyle(palette.text)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    private func markdown(_ text: String) -> AttributedString {
        (try? AttributedString(markdown: text)) ?? AttributedString(text)
    }
}
