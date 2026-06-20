import Foundation

/// The parsed contents of a tapped LiveStage deep link.
struct ParsedDeepLink: Equatable {
    let parameters: [String: String]   // `source` removed
    let interaction: DeepLinkInteraction
}

/// How a tapped LiveStage deep link is classified for analytics (build spec §4.8/§5.2). Only the two
/// known internal `source` values map to an event; a missing or unknown source records nothing, so an
/// arbitrary source-less app link is never miscounted as a Live Activity open.
enum DeepLinkInteraction: Equatable {
    case activityOpen      // source=activity_open   -> activity_opened
    case expandedAction    // source=expanded_action -> expanded_action_tapped
    case unspecified       // missing/unknown source -> record nothing (still routable)
}

/// Deep-link composition (mirrors the backend's `composeDeepLink`, build spec §4.1/§5.2) and parsing
/// (for `handleDeepLink`). In M1 the *server* composes the final URL returned by `start`; this
/// composer exists for parity and is unit-tested so the SDK and backend stay in lockstep.
enum DeepLink {
    /// `base + percent-encoded query params`. Throws `.validation` on a malformed base or output.
    static func compose(base: String, parameters: [String: String]) throws -> String {
        guard isSchemeURL(base) else {
            throw LiveStageError.validation(field: "deepLinkBase", message: "Invalid deep link base: \(base)")
        }
        // Sort keys so composition is deterministic (and comparable in tests).
        let query = parameters
            .sorted { $0.key < $1.key }
            .map { "\(encode($0.key))=\(encode($0.value))" }
            .joined(separator: "&")

        let composed = query.isEmpty ? base : "\(base)?\(query)"
        guard composed.rangeOfCharacter(from: .whitespacesAndNewlines) == nil else {
            throw LiveStageError.validation(field: "deepLinkURL", message: "Composed deep link is malformed: \(composed)")
        }
        return composed
    }

    /// Parses a tapped URL into its parameters and analytics classification. `source=activity_open`
    /// marks a primary Live Activity tap, `source=expanded_action` an expanded-view action; any other
    /// value (or none) is `.unspecified` and records nothing. The internal `source` key is always
    /// stripped from the returned parameters so it never leaks to the app. Returns nil for a URL with
    /// no scheme.
    static func parse(_ url: URL) -> ParsedDeepLink? {
        guard url.scheme != nil else { return nil }
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        var params: [String: String] = [:]
        for item in components?.queryItems ?? [] {
            params[item.name] = item.value ?? ""
        }
        let interaction: DeepLinkInteraction
        switch params["source"] {
        case "activity_open":   interaction = .activityOpen
        case "expanded_action": interaction = .expandedAction
        default:                interaction = .unspecified
        }
        params.removeValue(forKey: "source")
        return ParsedDeepLink(parameters: params, interaction: interaction)
    }

    // MARK: - Helpers

    private static func isSchemeURL(_ base: String) -> Bool {
        // e.g. "triptogether://trip" — a scheme followed by "://".
        guard let range = base.range(of: "://") else { return false }
        let scheme = base[base.startIndex..<range.lowerBound]
        return !scheme.isEmpty && scheme.allSatisfy { $0.isLetter || $0.isNumber || "+-.".contains($0) }
            && (scheme.first?.isLetter ?? false)
    }

    private static func encode(_ value: String) -> String {
        // Percent-encode everything that isn't unreserved (URLQueryAllowed keeps "&=+" etc.).
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }
}
