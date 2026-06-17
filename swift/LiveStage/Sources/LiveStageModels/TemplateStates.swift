import Foundation

/// Journey: trips, deliveries, rides, multi-stage processes (build spec §4.3, design §04).
public struct JourneyState: Codable, Hashable, Sendable {
    public let title: String
    public let currentStep: String
    public let nextStep: String?
    public let progress: Double?      // 0…1
    public let targetDate: Date?
    public let statusText: String?

    public init(
        title: String,
        currentStep: String,
        nextStep: String? = nil,
        progress: Double? = nil,
        targetDate: Date? = nil,
        statusText: String? = nil
    ) {
        self.title = title
        self.currentStep = currentStep
        self.nextStep = nextStep
        self.progress = progress
        self.targetDate = targetDate
        self.statusText = statusText
    }
}

/// Countdown: flights, events, appointments (build spec §4.3, design §05). `targetDate` is required.
public struct CountdownState: Codable, Hashable, Sendable {
    public let title: String
    public let subtitle: String?
    public let targetDate: Date       // required - the template's purpose
    public let statusText: String?
    public let location: String?

    public init(
        title: String,
        subtitle: String? = nil,
        targetDate: Date,
        statusText: String? = nil,
        location: String? = nil
    ) {
        self.title = title
        self.subtitle = subtitle
        self.targetDate = targetDate
        self.statusText = statusText
        self.location = location
    }
}

/// Progress: uploads, food prep, processing, tasks (build spec §4.3, design §06). `progress` is required.
public struct ProgressState: Codable, Hashable, Sendable {
    public let title: String
    public let currentStage: String?
    public let progress: Double        // required, 0…1
    public let estimatedCompletionDate: Date?
    public let detailText: String?

    public init(
        title: String,
        currentStage: String? = nil,
        progress: Double,
        estimatedCompletionDate: Date? = nil,
        detailText: String? = nil
    ) {
        self.title = title
        self.currentStage = currentStage
        self.progress = progress
        self.estimatedCompletionDate = estimatedCompletionDate
        self.detailText = detailText
    }
}
