# Requirements Document

## Introduction

This document specifies the requirements for implementing the core WebSocket-SDK communication logic for the InstaClaw Connector plugin. The system enables bidirectional communication between a remote server and an internal SDK through a plugin intermediary. The remote server communicates with the plugin via WebSocket using the Open Responses protocol, while the plugin communicates with the SDK via in-process function calls with callbacks.

The architecture follows this flow:
```
Remote Server ←(WebSocket)→ Plugin ←(function call + callback)→ SDK
```

## Glossary

- **Plugin**: The InstaClaw Connector channel plugin that acts as an intermediary between the remote server and the internal SDK
- **Remote_Server**: The external server that sends requests and receives responses via WebSocket
- **SDK**: The internal OpenClaw SDK that processes requests and generates responses using AI models
- **WebSocket_Connection**: The bidirectional persistent connection between Remote_Server and Plugin
- **Open_Responses_Protocol**: The standardized event-based protocol for streaming AI responses (defined in open-responses.md)
- **Request_Message**: An inbound message from Remote_Server to Plugin containing user content
- **Response_Event**: An outbound Open Responses protocol event from Plugin to Remote_Server
- **SDK_Callback**: A function provided by Plugin to SDK for receiving streaming response text
- **Dispatch_Method**: The SDK method that Plugin calls to send a request for processing
- **Event_Sequence**: An ordered series of Open Responses events representing a complete response lifecycle

## Requirements

### Requirement 1: SDK Integration Interface

**User Story:** As a plugin developer, I want to integrate with the OpenClaw SDK, so that I can dispatch user requests for AI processing and receive streaming responses.

#### Acceptance Criteria

1. THE Plugin SHALL provide a dispatch method interface that accepts request content and returns a response promise
2. WHEN Plugin calls the dispatch method, THE SDK SHALL process the request using internal AI models
3. THE Plugin SHALL provide a callback function to SDK for receiving streaming response text
4. WHEN SDK generates response text, THE SDK SHALL invoke the callback function with text chunks
5. THE Plugin SHALL handle callback invocations without blocking SDK execution

### Requirement 2: Request Reception and Parsing

**User Story:** As a plugin, I want to receive and parse inbound WebSocket messages from the remote server, so that I can extract user requests for processing.

#### Acceptance Criteria

1. WHEN Plugin receives a WebSocket message with topic "/v1.0/im/user/messages", THE Plugin SHALL parse it as a Request_Message
2. THE Plugin SHALL extract the content field from the Request_Message data payload
3. THE Plugin SHALL extract the messageId from the Request_Message headers
4. IF the WebSocket message cannot be parsed, THEN THE Plugin SHALL log an error and continue operation
5. THE Plugin SHALL validate that content is a non-empty string before processing

### Requirement 3: SDK Request Dispatch

**User Story:** As a plugin, I want to dispatch parsed requests to the SDK, so that the AI model can generate appropriate responses.

#### Acceptance Criteria

1. WHEN Plugin receives a valid Request_Message, THE Plugin SHALL call the SDK Dispatch_Method with the request content
2. THE Plugin SHALL pass the SDK_Callback function when calling the Dispatch_Method
3. THE Plugin SHALL associate the request messageId with the SDK processing session for response correlation
4. IF SDK Dispatch_Method throws an error, THEN THE Plugin SHALL generate a response.failed event
5. THE Plugin SHALL handle multiple concurrent SDK dispatch calls independently

### Requirement 4: Streaming Response Collection

**User Story:** As a plugin, I want to collect streaming response text from SDK callbacks, so that I can convert it to Open Responses events.

#### Acceptance Criteria

1. WHEN SDK invokes the SDK_Callback with a text chunk, THE Plugin SHALL accumulate the text in a response buffer
2. THE Plugin SHALL maintain separate response buffers for concurrent requests
3. WHEN SDK signals completion, THE Plugin SHALL finalize the accumulated response text
4. THE Plugin SHALL preserve the order of text chunks as received from SDK
5. IF SDK_Callback receives an error, THEN THE Plugin SHALL mark the response as failed

### Requirement 5: Response Event Generation

**User Story:** As a plugin, I want to convert SDK response text to Open Responses event sequences, so that I can send properly formatted responses to the remote server.

#### Acceptance Criteria

1. WHEN Plugin receives the first text chunk from SDK, THE Plugin SHALL generate response.in_progress and response.output_item.added events
2. WHEN Plugin receives text chunks from SDK, THE Plugin SHALL generate response.output_text.delta events
3. WHEN SDK signals completion, THE Plugin SHALL generate response.content_part.done and response.completed events
4. IF SDK signals an error, THEN THE Plugin SHALL generate a response.failed event with error details
5. THE Plugin SHALL generate events in the correct order per Open Responses protocol state machine

### Requirement 6: Response Event Transmission

**User Story:** As a plugin, I want to send response events to the remote server via WebSocket, so that the server receives streaming AI responses.

#### Acceptance Criteria

1. WHEN Plugin generates a Response_Event, THE Plugin SHALL wrap it in a WebSocket Envelope with topic "/v1.0/im/bot/messages"
2. WHEN Plugin wraps an event, THE Plugin SHALL serialize the event to JSON and place it in the envelope data field
3. WHEN Plugin creates an envelope, THE Plugin SHALL generate a unique messageId for the envelope headers
4. THE Plugin SHALL send each envelope through the WebSocket_Connection immediately after creation
5. IF WebSocket_Connection is not open, THEN THE Plugin SHALL log an error and discard the event

### Requirement 7: Request-Response Correlation

**User Story:** As a plugin, I want to correlate SDK responses with original requests, so that I can track which response belongs to which request.

#### Acceptance Criteria

1. WHEN Plugin dispatches a request to SDK, THE Plugin SHALL create a correlation context containing the request messageId
2. THE Plugin SHALL pass the correlation context to the SDK_Callback closure
3. WHEN SDK_Callback is invoked, THE Plugin SHALL retrieve the correlation context to identify the originating request
4. THE Plugin SHALL maintain correlation contexts until the response is completed or failed
5. THE Plugin SHALL clean up correlation contexts after response completion to prevent memory leaks

### Requirement 8: Error Handling and Recovery

**User Story:** As a plugin, I want to handle errors gracefully during SDK communication, so that individual failures don't crash the entire system.

#### Acceptance Criteria

1. IF SDK Dispatch_Method throws an error, THEN THE Plugin SHALL generate a response.failed event with error code "SDK_ERROR"
2. IF SDK_Callback throws an error, THEN THE Plugin SHALL log the error and generate a response.failed event
3. IF WebSocket send fails, THEN THE Plugin SHALL log the error and continue processing other requests
4. THE Plugin SHALL isolate errors to individual request-response cycles without affecting concurrent operations
5. WHEN an error occurs, THE Plugin SHALL include diagnostic information in error logs

### Requirement 9: Concurrent Request Handling

**User Story:** As a plugin, I want to handle multiple concurrent requests, so that the system can process multiple user messages simultaneously.

#### Acceptance Criteria

1. THE Plugin SHALL support processing multiple Request_Messages concurrently
2. THE Plugin SHALL maintain independent state for each concurrent request-response cycle
3. WHEN multiple requests are active, THE Plugin SHALL not mix response events between different requests
4. THE Plugin SHALL use unique response_id values for each request-response cycle
5. THE Plugin SHALL limit concurrent requests to prevent resource exhaustion (configurable limit)

### Requirement 10: SDK Callback Interface Contract

**User Story:** As a plugin developer, I want a clear callback interface contract with the SDK, so that I can implement reliable response handling.

#### Acceptance Criteria

1. THE SDK_Callback SHALL accept a text chunk parameter of type string
2. THE SDK_Callback SHALL accept an optional error parameter for signaling failures
3. THE SDK_Callback SHALL accept an optional completion flag parameter for signaling end of stream
4. WHEN SDK calls the callback with completion flag true, THE Plugin SHALL finalize the response
5. THE SDK_Callback SHALL return void and not block SDK execution

### Requirement 11: Response Text Chunking

**User Story:** As a plugin, I want to chunk large response texts into delta events, so that I can provide smooth streaming experience to the remote server.

#### Acceptance Criteria

1. WHEN Plugin generates delta events, THE Plugin SHALL split text into chunks of configurable size
2. THE Plugin SHALL use the TEXT_CHUNK_SIZE configuration value for chunk size
3. WHEN text length exceeds chunk size, THE Plugin SHALL generate multiple delta events
4. THE Plugin SHALL preserve text integrity across chunk boundaries (no character splitting)
5. THE Plugin SHALL send delta events in order to maintain text coherence

### Requirement 12: Protocol Compliance Validation

**User Story:** As a plugin, I want to validate protocol compliance, so that all messages conform to the Open Responses specification.

#### Acceptance Criteria

1. THE Plugin SHALL validate that all generated events contain required fields (type, response_id, timestamp)
2. THE Plugin SHALL validate that event types match the Open Responses protocol event type enumeration
3. THE Plugin SHALL validate that event sequences follow the protocol state machine rules
4. IF validation fails, THEN THE Plugin SHALL log a warning and attempt to send the event anyway
5. THE Plugin SHALL include validation errors in diagnostic logs for debugging

### Requirement 13: SDK Integration Lifecycle

**User Story:** As a plugin, I want to manage SDK integration lifecycle, so that resources are properly initialized and cleaned up.

#### Acceptance Criteria

1. WHEN Plugin starts, THE Plugin SHALL initialize SDK integration components
2. THE Plugin SHALL register callback handlers with SDK during initialization
3. WHEN Plugin stops, THE Plugin SHALL clean up all active SDK sessions
4. THE Plugin SHALL cancel pending SDK operations during shutdown
5. THE Plugin SHALL wait for in-flight responses to complete before final shutdown (with timeout)

### Requirement 14: Response Timeout Handling

**User Story:** As a plugin, I want to handle SDK response timeouts, so that stuck requests don't block the system indefinitely.

#### Acceptance Criteria

1. WHEN Plugin dispatches a request to SDK, THE Plugin SHALL start a timeout timer with configurable duration
2. IF SDK does not complete the response before timeout, THEN THE Plugin SHALL generate a response.failed event with error code "TIMEOUT"
3. WHEN timeout occurs, THE Plugin SHALL cancel the SDK operation if possible
4. THE Plugin SHALL clean up correlation context and response buffer after timeout
5. THE Plugin SHALL log timeout events with request details for diagnostics

### Requirement 15: Logging and Observability

**User Story:** As a plugin operator, I want comprehensive logging of SDK communication, so that I can diagnose issues and monitor system health.

#### Acceptance Criteria

1. THE Plugin SHALL log each request dispatch to SDK with request messageId and content length
2. THE Plugin SHALL log each SDK_Callback invocation with chunk size and completion status
3. THE Plugin SHALL log each response event generation with event type and response_id
4. THE Plugin SHALL log errors with full context including request details and error messages
5. WHEN debug mode is enabled, THE Plugin SHALL log detailed protocol message contents

