import XCTest
@testable import LiveStage
import LiveStageModels

/// Pure-logic SDK tests that run on the macOS host (no simulator, no ActivityKit): deep-link
/// composition + parsing, the forward-only sync decision, HTTP→error mapping, and the canonical
/// wire schema. ActivityKit-dependent paths are `#if os(iOS)` and verified in the simulator.
final class SDKLogicTests: XCTestCase {

    // MARK: - Deep-link composition (mirrors the backend; percent-encoding, deterministic order)

    func testComposeDeepLinkEncodesAndOrders() throws {
        let url = try DeepLink.compose(base: "triptogether://trip", parameters: ["tripId": "123"])
        XCTAssertEqual(url, "triptogether://trip?tripId=123")

        let multi = try DeepLink.compose(base: "triptogether://trip", parameters: ["b": "2", "a": "1 2"])
        // Keys sorted; the space in "1 2" is percent-encoded.
        XCTAssertEqual(multi, "triptogether://trip?a=1%202&b=2")
    }

    func testComposeDeepLinkRejectsMalformedBase() {
        XCTAssertThrowsError(try DeepLink.compose(base: "not-a-url", parameters: [:])) { error in
            guard case LiveStageError.validation(let field, _) = error else {
                return XCTFail("expected .validation, got \(error)")
            }
            XCTAssertEqual(field, "deepLinkBase")
        }
    }

    // MARK: - Deep-link parsing (source detection + strip)

    func testParseActivityOpen() throws {
        let parsed = try XCTUnwrap(DeepLink.parse(URL(string: "triptogether://trip?tripId=123&source=activity_open")!))
        XCTAssertEqual(parsed.interaction, .activityOpen)
        XCTAssertEqual(parsed.parameters, ["tripId": "123"], "the internal source must be stripped")
    }

    func testParseExpandedActionStripsSource() throws {
        let parsed = try XCTUnwrap(DeepLink.parse(URL(string: "triptogether://trip?tripId=123&source=expanded_action")!))
        XCTAssertEqual(parsed.interaction, .expandedAction)
        XCTAssertEqual(parsed.parameters, ["tripId": "123"], "source must be stripped from parameters")
    }

    func testParseNoSourceIsUnspecified() throws {
        let parsed = try XCTUnwrap(DeepLink.parse(URL(string: "triptogether://trip?tripId=123")!))
        XCTAssertEqual(parsed.interaction, .unspecified, "a source-less link is never a Live Activity open")
        XCTAssertEqual(parsed.parameters, ["tripId": "123"])
    }

    func testParseUnknownSourceIsUnspecifiedAndStripped() throws {
        let parsed = try XCTUnwrap(DeepLink.parse(URL(string: "triptogether://trip?tripId=123&source=banana")!))
        XCTAssertEqual(parsed.interaction, .unspecified)
        XCTAssertEqual(parsed.parameters, ["tripId": "123"], "any source value is stripped from the public route")
    }

    func testHandleDeepLinkReturnsNilWhenNoSessionMatches() async throws {
        // Even with a valid source, a URL matching no known LiveStage session is not an open: it
        // returns nil and records nothing (no arbitrary link is classified as a Live Activity open).
        let runtime = LiveStageRuntime(config: ConfigStore())
        let route = try await runtime.handleDeepLink(URL(string: "triptogether://trip?tripId=999&source=activity_open")!)
        XCTAssertNil(route)
    }

    func testHandleDeepLinkReturnsNilForSchemelessURL() async throws {
        let runtime = LiveStageRuntime(config: ConfigStore())
        let route = try await runtime.handleDeepLink(URL(string: "not-a-deep-link")!)
        XCTAssertNil(route)
    }

    // MARK: - Forward-only sync decision (build spec §9)

    func testForwardOnlyVersionApplication() {
        XCTAssertTrue(SyncDecision.shouldApply(incoming: 3, applied: 2))
        XCTAssertFalse(SyncDecision.shouldApply(incoming: 2, applied: 2), "equal version is a duplicate, ignore")
        XCTAssertFalse(SyncDecision.shouldApply(incoming: 1, applied: 4), "older version is out-of-order, ignore")
    }

    func testForwardOnlyVersionEdgeCases() {
        XCTAssertTrue(SyncDecision.shouldApply(incoming: 1, applied: 0), "the first state after the initial baseline applies")
        XCTAssertTrue(SyncDecision.shouldApply(incoming: 10, applied: 2), "a large forward jump (missed polls) still applies")
        XCTAssertFalse(SyncDecision.shouldApply(incoming: 0, applied: 0), "no movement from the baseline is not an apply")
        XCTAssertFalse(SyncDecision.shouldApply(incoming: 4, applied: 5), "a late out-of-order response below the applied version is ignored")
    }

    // MARK: - HTTP status → LiveStageError mapping (build spec §5.3)

    func testErrorMapping() {
        guard case LiveStageError.validation(let field, _) =
                APIClient.mapError(status: 400, body: .init(error: "validation", message: "bad", field: "progress")) else {
            return XCTFail("400 should map to .validation")
        }
        XCTAssertEqual(field, "progress")

        if case LiveStageError.sessionNotFound = APIClient.mapError(status: 404, body: nil) {} else {
            XCTFail("404 should map to .sessionNotFound")
        }
        if case LiveStageError.alreadyEnded =
            APIClient.mapError(status: 409, body: .init(error: "already_ended", message: nil, field: nil)) {} else {
            XCTFail("409 already_ended should map to .alreadyEnded")
        }
        if case LiveStageError.server(let status, _) =
            APIClient.mapError(status: 409, body: .init(error: "idempotency_conflict", message: nil, field: nil)) {
            XCTAssertEqual(status, 409)
        } else {
            XCTFail("409 conflict (non-ended) should map to .server")
        }
        if case LiveStageError.server(let status, _) = APIClient.mapError(status: 500, body: nil) {
            XCTAssertEqual(status, 500)
        } else {
            XCTFail("500 should map to .server")
        }
    }

    // MARK: - Error model surfaced clearly (build spec §5.3)

    func testLiveStageErrorSurfacesActionableLocalizedDescription() {
        let err = LiveStageError.validation(field: "progress", message: "out of range (1.4)")
        XCTAssertEqual(err.errorDescription, "Validation failed for progress: out of range (1.4)")
        // Host apps that display `error.localizedDescription` get the real reason, not a generic string.
        XCTAssertEqual((err as Error).localizedDescription, "Validation failed for progress: out of range (1.4)")
    }

    // MARK: - Canonical wire schema (compare parsed objects, not raw bytes)

    func testStartRequestEncodesPayloadFlattenedUnderPayloadKey() throws {
        let body = StartRequest(
            templateId: "trip-status",
            deepLinkParameters: ["tripId": "123"],
            payload: .journey(JourneyState(title: "Trip to Rome", currentStep: "Heading to the airport", progress: 0.35))
        )
        let data = try LiveStageJSON.encoder.encode(body)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertEqual(object["templateId"] as? String, "trip-status")
        let payload = try XCTUnwrap(object["payload"] as? [String: Any])
        XCTAssertEqual(payload["type"] as? String, "journey", "payload carries the flattened type discriminator")
        XCTAssertEqual(payload["title"] as? String, "Trip to Rome")
        XCTAssertEqual(payload["progress"] as? Double, 0.35)
        XCTAssertNil(payload["journey"], "payload must be flattened, not nested under a case key")
    }

    func testDecodesBackendResponseWithFractionalSecondDates() throws {
        // The backend stamps server time with JS toISOString() — fractional seconds must decode.
        let json = """
        {
          "version": 2,
          "lastUpdatedAt": "2026-06-17T18:47:31.972Z",
          "state": {
            "payload": { "type": "journey", "title": "Trip to Rome", "currentStep": "Boarding", "progress": 0.6 },
            "metadata": { "lastUpdatedAt": "2026-06-17T18:47:31.972Z", "version": 2 }
          }
        }
        """
        let resp = try LiveStageJSON.decoder.decode(UpdateResponse.self, from: Data(json.utf8))
        XCTAssertEqual(resp.version, 2)
        XCTAssertEqual(resp.state.metadata.version, 2)
        guard case .journey(let journey) = resp.state.payload else { return XCTFail("expected journey") }
        XCTAssertEqual(journey.currentStep, "Boarding")
        XCTAssertEqual(journey.progress, 0.6)
    }

    // MARK: - notConfigured surfaces before any network

    func testNotConfiguredThrows() async {
        let runtime = LiveStageRuntime(config: ConfigStore())
        do {
            _ = try await runtime.configuration(for: "trip-status")
            XCTFail("expected notConfigured")
        } catch LiveStageError.notConfigured {
            // expected
        } catch {
            XCTFail("expected .notConfigured, got \(error)")
        }
    }
}
