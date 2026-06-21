import XCTest
@testable import LiveStage
import LiveStageModels

#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Offline cache + degraded-mode behavior (build spec §5.2 `LocalCache`, §5.4). All host-side: a
/// `URLProtocol` stub drives the network up/down deterministically (no simulator, no real sockets), so
/// these prove the runtime serves cached config/status offline and that a fresh fetch wins online.
final class OfflineCacheTests: XCTestCase {

    // MARK: - Fixtures

    private func tempDir() -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("LiveStageCacheTests-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    private func makeConfig(_ templateId: String = "trip-status", displayName: String) -> TemplateConfiguration {
        TemplateConfiguration(
            templateId: templateId,
            templateType: .journey,
            displayName: displayName,
            icon: "airplane",
            accentStyle: .blue,
            deepLinkBase: "triptogether://trip",
            labels: TemplateLabels(nextStepLabel: "Next"),
            staleAfterSeconds: 900
        )
    }

    private func makeContentState(version: Int, lastUpdatedAt: Date) -> LiveStageContentState {
        LiveStageContentState(
            payload: .journey(JourneyState(title: "Trip to Rome", currentStep: "Boarding", progress: 0.4)),
            metadata: StateMetadata(lastUpdatedAt: lastUpdatedAt, version: version)
        )
    }

    /// A runtime wired to the stub session, with a low attempt count so an offline call fails fast
    /// (no backoff sleeps), and a configured ConfigStore so it gets past `.notConfigured`.
    private func makeRuntime(cache: LocalCache) -> LiveStageRuntime {
        let store = ConfigStore()
        store.set(apiKey: "ls_mobile_test.secret", baseURL: URL(string: "https://stub.local")!)
        let cfg = URLSessionConfiguration.ephemeral
        cfg.protocolClasses = [StubURLProtocol.self]
        let session = URLSession(configuration: cfg)
        return LiveStageRuntime(config: store, cache: cache, urlSession: session, apiMaxAttempts: 1)
    }

    override func tearDown() {
        StubURLProtocol.handler = nil
        super.tearDown()
    }

    // MARK: - FileLocalCache (durability, missing, corruption)

    func testFileLocalCacheRoundTripsAcrossInstances() {
        let dir = tempDir()
        let c1 = FileLocalCache(directory: dir)
        c1.putConfig(makeConfig(displayName: "Trip"))
        c1.putSession(CachedSession(sessionId: "s1", state: makeContentState(version: 3, lastUpdatedAt: Date()), status: "active", staleAfterSeconds: 600))

        // A fresh instance over the same directory loads the persisted snapshot (survives relaunch).
        let c2 = FileLocalCache(directory: dir)
        XCTAssertEqual(c2.config(for: "trip-status")?.displayName, "Trip")
        let session = c2.session(for: "s1")
        XCTAssertEqual(session?.status, "active")
        XCTAssertEqual(session?.state.metadata.version, 3)
        XCTAssertEqual(session?.staleAfterSeconds, 600)
    }

    func testMissingCacheFileReturnsNil() {
        let cache = FileLocalCache(directory: tempDir())
        XCTAssertNil(cache.config(for: "trip-status"))
        XCTAssertNil(cache.session(for: "s1"))
    }

    func testCorruptCacheFileIsQuarantinedAndReadsEmpty() throws {
        let dir = tempDir()
        let fileURL = dir.appendingPathComponent("cache.json")
        try Data("this is not valid json".utf8).write(to: fileURL)

        let cache = FileLocalCache(directory: dir)
        XCTAssertNil(cache.config(for: "trip-status"), "a corrupt cache reads empty, never crashes")
        XCTAssertTrue(
            FileManager.default.fileExists(atPath: fileURL.appendingPathExtension("corrupt").path),
            "the corrupt file is moved aside for inspection"
        )
    }

    // MARK: - fetchConfiguration (§5.4)

    func testFetchConfigurationServesCacheWhenOffline() async throws {
        let cache = FileLocalCache(directory: tempDir())
        cache.putConfig(makeConfig(displayName: "Cached Trip"))
        StubURLProtocol.handler = { _ in throw URLError(.notConnectedToInternet) }

        let runtime = makeRuntime(cache: cache)
        let config = try await runtime.configuration(for: "trip-status")
        XCTAssertEqual(config.displayName, "Cached Trip", "offline, the last known config is served from cache")
    }

    func testFetchConfigurationColdOfflineThrowsNetwork() async {
        let runtime = makeRuntime(cache: FileLocalCache(directory: tempDir()))  // empty cache
        StubURLProtocol.handler = { _ in throw URLError(.notConnectedToInternet) }
        do {
            _ = try await runtime.configuration(for: "trip-status")
            XCTFail("expected .network with nothing cached")
        } catch LiveStageError.network {
            // expected
        } catch {
            XCTFail("expected .network, got \(error)")
        }
    }

    func testFetchConfigurationFreshWinsOverStaleCacheWhenOnline() async throws {
        let cache = FileLocalCache(directory: tempDir())
        cache.putConfig(makeConfig(displayName: "STALE"))  // a stale value already cached
        let fresh = makeConfig(displayName: "FRESH")
        StubURLProtocol.handler = { _ in (Self.ok(), try LiveStageJSON.encoder.encode(fresh)) }

        let runtime = makeRuntime(cache: cache)
        let config = try await runtime.configuration(for: "trip-status")
        XCTAssertEqual(config.displayName, "FRESH", "with the network up, the fresh config wins over the cache")
        XCTAssertEqual(cache.config(for: "trip-status")?.displayName, "FRESH", "and the cache is refreshed to the fresh value")
    }

    // MARK: - status (§5.4)

    func testStatusServesCacheWhenOffline() async throws {
        let cache = FileLocalCache(directory: tempDir())
        let when = Date(timeIntervalSince1970: 1_700_000_000)
        cache.putSession(CachedSession(sessionId: "s1", state: makeContentState(version: 5, lastUpdatedAt: when), status: "active", staleAfterSeconds: 900))
        StubURLProtocol.handler = { _ in throw URLError(.notConnectedToInternet) }

        let runtime = makeRuntime(cache: cache)
        let status = try await runtime.status(LiveStageSession(sessionId: "s1", templateId: "trip-status"))
        XCTAssertEqual(status.status, .active)
        XCTAssertEqual(status.version, 5)
        XCTAssertEqual(status.lastUpdatedAt, when)
    }

    func testStatusColdOfflineThrowsNetwork() async {
        let runtime = makeRuntime(cache: FileLocalCache(directory: tempDir()))  // nothing cached
        StubURLProtocol.handler = { _ in throw URLError(.notConnectedToInternet) }
        do {
            _ = try await runtime.status(LiveStageSession(sessionId: "s1", templateId: "trip-status"))
            XCTFail("expected .network with nothing cached")
        } catch LiveStageError.network {
            // expected
        } catch {
            XCTFail("expected .network, got \(error)")
        }
    }

    // MARK: - Helpers

    private static func ok() -> HTTPURLResponse {
        HTTPURLResponse(url: URL(string: "https://stub.local")!, statusCode: 200, httpVersion: nil, headerFields: nil)!
    }
}

/// Drives `URLSession` deterministically in tests: each test sets `handler` to return a response or
/// throw a transport error. Registered on an ephemeral session injected into the runtime.
final class StubURLProtocol: URLProtocol {
    nonisolated(unsafe) static var handler: (@Sendable (URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let handler = Self.handler else {
            client?.urlProtocol(self, didFailWithError: URLError(.unknown))
            return
        }
        do {
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}
