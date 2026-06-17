import XCTest
@testable import LiveStageModels

/// Verifies the riskiest M0 piece: `TemplatePayload`'s flattened `"type"`-discriminator
/// `Codable` (build spec §4.7, §13, §14). Pure model logic - runs on the macOS host via
/// `swift test`, no simulator.
final class TemplatePayloadCodableTests: XCTestCase {

    // Whole-second dates so `.iso8601` (no fractional seconds) round-trips exactly.
    private static let targetDate = Date(timeIntervalSince1970: 1_781_023_320)     // 2026-06-09T...Z
    private static let lastUpdatedAt = Date(timeIntervalSince1970: 1_781_019_720)

    private func sampleJourney() -> TemplatePayload {
        .journey(JourneyState(
            title: "Trip to Rome",
            currentStep: "Heading to the airport",
            nextStep: "Flight AZ809",
            progress: 0.35,
            targetDate: Self.targetDate,
            statusText: "On time"
        ))
    }

    private func sampleCountdown() -> TemplatePayload {
        .countdown(CountdownState(
            title: "Flight to Rome",
            subtitle: "Gate B12",
            targetDate: Self.targetDate,
            statusText: "On time",
            location: "Terminal 3"
        ))
    }

    private func sampleProgress() -> TemplatePayload {
        .progress(ProgressState(
            title: "Preparing your order",
            currentStage: "Packing",
            progress: 0.72,
            estimatedCompletionDate: Self.targetDate,
            detailText: "3 items left"
        ))
    }

    // MARK: - Test 1: symmetric round-trip through the configured ISO8601 coder, all three cases.

    func testRoundTripAllCasesThroughConfiguredCoder() throws {
        for payload in [sampleJourney(), sampleCountdown(), sampleProgress()] {
            let data = try LiveStageJSON.encoder.encode(payload)
            let decoded = try LiveStageJSON.decoder.decode(TemplatePayload.self, from: data)
            XCTAssertEqual(decoded, payload, "TemplatePayload must round-trip exactly for \(payload.templateType)")
        }
    }

    func testRoundTripWithNilOptionals() throws {
        // Journey with all optionals nil - absent keys must not break decoding.
        let payload = TemplatePayload.journey(JourneyState(title: "Solo", currentStep: "Walking"))
        let data = try LiveStageJSON.encoder.encode(payload)
        let decoded = try LiveStageJSON.decoder.decode(TemplatePayload.self, from: data)
        XCTAssertEqual(decoded, payload)
    }

    // MARK: - Test 2: the encoded JSON is flattened with `type` as a sibling of the state fields.

    func testWireShapeIsFlattenedWithTypeDiscriminator() throws {
        let data = try LiveStageJSON.encoder.encode(sampleJourney())
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertEqual(object["type"] as? String, "journey")
        // State fields are siblings of `type`, not nested under a "journey" key.
        XCTAssertNil(object["journey"], "payload must be flattened, not nested")
        XCTAssertEqual(object["title"] as? String, "Trip to Rome")
        XCTAssertEqual(object["currentStep"] as? String, "Heading to the airport")
        XCTAssertEqual(object["progress"] as? Double, 0.35)
        // Dates serialize as ISO8601 strings (not numeric).
        let target = try XCTUnwrap(object["targetDate"] as? String)
        XCTAssertTrue(target.hasSuffix("Z"), "targetDate must be an ISO8601 string, got \(target)")
    }

    // MARK: - Test 3: decode the documented §4.7 sample wire JSON verbatim.

    func testDecodeDocumentedWireSample() throws {
        let json = """
        {
          "payload": {
            "type": "journey",
            "title": "Trip to Rome",
            "currentStep": "Heading to the airport",
            "nextStep": "Flight AZ809",
            "progress": 0.35,
            "targetDate": "2026-06-14T16:42:00Z",
            "statusText": "On time"
          },
          "metadata": { "lastUpdatedAt": "2026-06-14T15:00:00Z", "version": 4 }
        }
        """
        let data = Data(json.utf8)
        let state = try LiveStageJSON.decoder.decode(LiveStageContentState.self, from: data)

        guard case .journey(let journey) = state.payload else {
            return XCTFail("expected .journey payload")
        }
        XCTAssertEqual(journey.title, "Trip to Rome")
        XCTAssertEqual(journey.currentStep, "Heading to the airport")
        XCTAssertEqual(journey.nextStep, "Flight AZ809")
        XCTAssertEqual(journey.progress, 0.35)
        XCTAssertEqual(journey.statusText, "On time")
        XCTAssertEqual(state.metadata.version, 4)
    }

    // MARK: - Test 4: ActivityKit-coder proxy - round-trips through a default coder too.

    /// ActivityKit serializes `ContentState` with its own `JSONEncoder`/`JSONDecoder`, not ours.
    /// Round-tripping through a *default* coder (no custom date strategy) proves the enum's
    /// conformance isn't coupled to `.iso8601`, so it survives ActivityKit's internal coding.
    func testRoundTripThroughDefaultCoderProxy() throws {
        let original = LiveStageContentState(
            payload: sampleJourney(),
            metadata: StateMetadata(lastUpdatedAt: Self.lastUpdatedAt, version: 4)
        )
        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(LiveStageContentState.self, from: data)
        XCTAssertEqual(decoded, original)
    }
}
