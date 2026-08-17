// swift-tools-version: 5.9
import PackageDescription

// OFPKit is deliberately free of UIKit, SwiftUI and Core Graphics: everything that
// reads or writes the flight plan lives here, so it builds and its tests run on any
// platform with a Swift toolchain, not only on a Mac with Xcode. The app target adds
// the screen on top.
let package = Package(
    name: "OFPKit",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [
        .library(name: "OFPKit", targets: ["OFPKit"])
    ],
    targets: [
        .target(
            name: "OFPKit",
            swiftSettings: [.unsafeFlags(["-Ounchecked"], .when(configuration: .release))]
        ),
        .testTarget(
            name: "OFPKitTests",
            dependencies: ["OFPKit"],
            resources: [.copy("Fixtures")]
        )
    ]
)
