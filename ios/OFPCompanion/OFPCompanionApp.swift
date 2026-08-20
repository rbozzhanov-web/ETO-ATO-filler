import SwiftUI
import OFPKit

@main
struct OFPCompanionApp: App {
    @StateObject private var companion = AppModel()
    @StateObject private var journeyLog = JourneyLogModel()
    @State private var screen: Screen = .companion

    /// Two documents, two forms, two screens. They cross to each other from the same place
    /// in each toolbar, so the button does not move when you arrive.
    enum Screen { case companion, journeyLog }

    var body: some Scene {
        WindowGroup {
            Group {
                switch screen {
                case .companion:
                    ContentView(showJourneyLog: { screen = .journeyLog })
                        .environmentObject(companion)
                case .journeyLog:
                    JourneyLogView(showCompanion: { screen = .companion })
                        .environmentObject(journeyLog)
                        .environment(\.palette, companion.theme.palette)
                        .preferredColorScheme(companion.theme.colorScheme)
                }
            }
            // A PDF handed to the app goes to whichever screen is open: the crew opened it
            // from there, and it is the one that can say whether the document fits.
            .onOpenURL { url in
                switch screen {
                case .companion: companion.loadFile(at: url)
                case .journeyLog: journeyLog.loadFile(at: url)
                }
            }
        }
    }
}
