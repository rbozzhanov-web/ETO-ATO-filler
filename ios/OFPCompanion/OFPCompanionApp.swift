import SwiftUI
import OFPKit

@main
struct OFPCompanionApp: App {
    @StateObject private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(model)
                // A plan opened from Files, Mail or another app comes in here.
                .onOpenURL { url in model.loadFile(at: url) }
        }
    }
}
