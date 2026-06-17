#if os(iOS)
import SwiftUI
import LiveStageModels

@available(iOS 16.2, *)
extension AccentStyle {
    /// Maps the fixed palette to the iOS system color hues used in the design doc (§04).
    var color: Color {
        switch self {
        case .blue:   return Color(red: 10 / 255,  green: 132 / 255, blue: 255 / 255)
        case .orange: return Color(red: 255 / 255, green: 159 / 255, blue: 10 / 255)
        case .green:  return Color(red: 48 / 255,  green: 209 / 255, blue: 88 / 255)
        case .indigo: return Color(red: 94 / 255,  green: 92 / 255,  blue: 230 / 255)
        case .teal:   return Color(red: 100 / 255, green: 210 / 255, blue: 255 / 255)
        }
    }
}

/// Resolves an `iconIdentifier` (SF Symbol allowlist, build spec §4.5) to an `Image`.
@available(iOS 16.2, *)
func liveStageIcon(_ identifier: String) -> Image {
    Image(systemName: identifier)
}
#endif
