# Implementation Plan: WebSocket-SDK Communication Core

## Overview

This implementation plan converts the feature design into actionable coding tasks. The system implements core WebSocket-SDK communication logic that bridges the remote server (via WebSocket/Open Responses protocol) and the OpenClaw SDK (via function calls with callbacks). The implementation follows an 8-phase approach focusing on incremental validation and property-based testing.

## Tasks

- [x] 1. Set up SDK dispatcher module structure
  - Create sdk-dispatcher.ts with core interfaces and types
  - Define RequestContext interface with all required fields
  - Define SDKCallback type signature
  - Define DispatcherConfig interface
  - Set up module exports
  - _Requirements: 1.1, 1.3, 7.1, 7.2_

- [x] 2. Implement core SDK dispatcher class
  - [x] 2.1 Create SDKDispatcher class with constructor and private fields
    - Initialize contexts Map for tracking active requests
    - Initialize logger instance
    - Store configuration (timeout, max concurrent requests, debug)
    - _Requirements: 1.1, 9.1, 13.1_
  
  - [x] 2.2 Implement dispatchRequest method
    - Validate request content is non-empty string
    - Check concurrent request limit
    - Create correlation context with unique response_id and item_id
    - Set up timeout timer
    - Call SDK dispatch method with callback
    - Handle SDK dispatch errors
    - _Requirements: 2.5, 3.1, 3.2, 7.1, 9.5, 14.1_
  
  - [x] 2.3 Implement createCallback method
    - Return callback closure that captures messageId
    - Callback should handle chunk, error, and completion parameters
    - Callback should return void immediately (non-blocking)
    - _Requirements: 1.3, 1.5, 10.1, 10.2, 10.3, 10.4, 10.5_
  
  - [ ]* 2.4 Write property test for SDK dispatch interface contract
    - **Property 2: SDK Dispatch Interface Contract**
    - **Validates: Requirements 1.1, 1.3, 3.1, 3.2**
    - Test that dispatch accepts content string and callback, returns promise without throwing
  
  - [ ]* 2.5 Write property test for callback non-blocking behavior
    - **Property 3: Callback Non-Blocking Behavior**
    - **Validates: Requirements 1.5, 10.5**
    - Test that callback returns void immediately for any input combination

- [x] 3. Implement response collection and buffering
  - [x] 3.1 Implement handleChunk method
    - Look up context by messageId
    - Detect first chunk and set firstChunkReceived flag
    - Accumulate chunk in responseBuffer maintaining order
    - Generate appropriate events (in_progress, item_added, delta)
    - _Requirements: 4.1, 4.4, 5.1, 5.2_
  
  - [x] 3.2 Implement handleCompletion method
    - Look up context by messageId
    - Generate content_part.done and response.completed events
    - Update context status to 'completed'
    - Clean up context and timeout timer
    - _Requirements: 4.3, 5.3, 7.4, 7.5_
  
  - [x] 3.3 Implement handleError method
    - Look up context by messageId
    - Generate response.failed event with error details
    - Update context status to 'failed'
    - Clean up context and timeout timer
    - _Requirements: 4.5, 5.4, 8.1, 8.2_
  
  - [ ]* 3.4 Write property test for response buffer accumulation order
    - **Property 4: Response Buffer Accumulation Order**
    - **Validates: Requirements 4.1, 4.4**
    - Test that chunks are concatenated in exact order received
  
  - [ ]* 3.5 Write unit tests for response collection
    - Test first chunk detection and initialization
    - Test subsequent chunk accumulation
    - Test completion handling
    - Test error handling
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 4. Implement Open Responses event generation
  - [x] 4.1 Create event generation helper functions
    - Implement generateInProgressEvent
    - Implement generateItemAddedEvent
    - Implement generateDeltaEvent
    - Implement generateContentPartDoneEvent
    - Implement generateCompletedEvent
    - Implement generateFailedEvent
    - Use existing protocol.ts helpers where available
    - _Requirements: 5.1, 5.2, 5.3, 5.4_
  
  - [x] 4.2 Integrate event generation into callback handlers
    - Call event generators from handleChunk
    - Call event generators from handleCompletion
    - Call event generators from handleError
    - Ensure events are generated in correct order
    - _Requirements: 5.5, 12.3_
  
  - [x] 4.3 Implement event transmission via WebSocket
    - Wrap events in WebSocket envelope with topic "/v1.0/im/bot/messages"
    - Generate unique messageId for each envelope
    - Serialize event to JSON for envelope data field
    - Send envelope via WebSocket connection
    - Handle WebSocket send failures gracefully
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  
  - [ ]* 4.4 Write property test for event sequence state machine
    - **Property 7: Event Sequence State Machine**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.5, 12.3**
    - Test that event sequences follow protocol state machine
  
  - [ ]* 4.5 Write property test for envelope format compliance
    - **Property 11: Envelope Format Compliance**
    - **Validates: Requirements 6.1, 6.2, 6.3**
    - Test envelope structure with type, topic, messageId, and data
  
  - [ ]* 4.6 Write property test for event structure validation
    - **Property 12: Event Structure Validation**
    - **Validates: Requirements 12.1, 12.2**
    - Test that events contain required fields with valid types

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement error handling and timeout mechanism
  - [x] 6.1 Implement handleTimeout method
    - Look up context by messageId
    - Generate response.failed event with error code "TIMEOUT"
    - Update context status to 'timeout'
    - Cancel SDK operation if possible
    - Clean up context
    - _Requirements: 14.1, 14.2, 14.3, 14.4_
  
  - [x] 6.2 Implement error isolation logic
    - Ensure errors in one request don't affect other requests
    - Wrap all context operations in try-catch
    - Log errors with full diagnostic context
    - Continue processing other requests after error
    - _Requirements: 8.3, 8.4, 8.5_
  
  - [x] 6.3 Implement parse error handling
    - Handle malformed WebSocket messages gracefully
    - Log parse errors without crashing
    - Continue processing other messages
    - _Requirements: 2.4, 18.1_
  
  - [ ]* 6.4 Write property test for error event generation
    - **Property 8: Error Event Generation**
    - **Validates: Requirements 3.4, 4.5, 5.4, 8.1, 8.2, 14.2**
    - Test that errors generate response.failed events
  
  - [ ]* 6.5 Write property test for error isolation
    - **Property 9: Error Isolation**
    - **Validates: Requirements 8.3, 8.4**
    - Test that failures don't affect concurrent requests
  
  - [ ]* 6.6 Write property test for timeout enforcement
    - **Property 14: Timeout Enforcement**
    - **Validates: Requirements 14.1, 14.2, 14.3, 14.4**
    - Test timeout triggers and cleanup
  
  - [ ]* 6.7 Write property test for malformed message resilience
    - **Property 18: Malformed Message Resilience**
    - **Validates: Requirements 2.4**
    - Test system continues after parse errors
  
  - [ ]* 6.8 Write property test for WebSocket send failure handling
    - **Property 19: WebSocket Send Failure Handling**
    - **Validates: Requirements 6.5**
    - Test system continues after send failures

- [x] 7. Implement concurrent request support
  - [x] 7.1 Implement concurrent request limit enforcement
    - Check active request count in dispatchRequest
    - Reject requests exceeding maxConcurrentRequests
    - Generate response.failed event for rejected requests
    - _Requirements: 9.5_
  
  - [x] 7.2 Implement getActiveRequestCount method
    - Return count of contexts with status 'pending' or 'processing'
    - _Requirements: 9.1_
  
  - [x] 7.3 Implement cleanupContext method
    - Remove context from contexts Map
    - Clear timeout timer if exists
    - Log cleanup action
    - _Requirements: 7.5_
  
  - [ ]* 7.4 Write property test for concurrent request isolation
    - **Property 5: Concurrent Request Isolation**
    - **Validates: Requirements 3.5, 4.2, 9.1, 9.2, 9.3**
    - Test independent state for concurrent requests
  
  - [ ]* 7.5 Write property test for response ID uniqueness
    - **Property 6: Response ID Uniqueness**
    - **Validates: Requirements 9.4**
    - Test all response_id values are unique
  
  - [ ]* 7.6 Write property test for concurrent request limit
    - **Property 15: Concurrent Request Limit**
    - **Validates: Requirements 9.5**
    - Test limit enforcement and rejection
  
  - [ ]* 7.7 Write property test for correlation context lifecycle
    - **Property 10: Correlation Context Lifecycle**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5**
    - Test context creation, access, and cleanup

- [x] 8. Integrate SDK dispatcher with connection.ts
  - [x] 8.1 Modify connection.ts handleMessage function
    - Import SDKDispatcher from sdk-dispatcher.ts
    - Create SDKDispatcher instance with configuration
    - Parse envelope to determine topic
    - Route user messages (topic "/v1.0/im/user/messages") to SDK dispatcher
    - Keep existing Open Responses event handling logic unchanged
    - Remove echo logic, replace with SDK dispatch
    - _Requirements: 2.1, 2.2, 2.3, 3.1_
  
  - [x] 8.2 Pass WebSocket connection to dispatcher
    - Ensure dispatcher has access to WebSocket instance for sending events
    - Store WebSocket reference in RequestContext
    - _Requirements: 6.4_
  
  - [ ]* 8.3 Write integration tests for complete flow
    - Test WebSocket message → SDK dispatch → callback → events → WebSocket send
    - Use mock WebSocket and mock SDK
    - Verify complete event sequence
    - _Requirements: 1.1, 2.1, 3.1, 5.1, 6.1_

- [x] 9. Extend types.ts with SDK-related types
  - [x] 9.1 Add DispatcherConfig interface
    - Add requestTimeout field
    - Add maxConcurrentRequests field
    - Add debug field
    - Add optional systemPrompt field
    - Add optional accountId field
    - _Requirements: 1.1, 9.5, 14.1_
  
  - [x] 9.2 Add RequestContext interface
    - Add all fields from design document
    - Add proper TypeScript types for each field
    - _Requirements: 7.1_
  
  - [x] 9.3 Add SDKCallback type
    - Define callback signature with chunk, error, isComplete parameters
    - _Requirements: 1.3, 10.1, 10.2, 10.3_

- [x] 10. Add SDK configuration to config.ts
  - [x] 10.1 Add SDK_REQUEST_TIMEOUT constant
    - Default 60000 milliseconds (60 seconds)
    - Read from environment variable SDK_REQUEST_TIMEOUT
    - _Requirements: 14.1_
  
  - [x] 10.2 Add MAX_CONCURRENT_REQUESTS constant
    - Default 10 concurrent requests
    - Read from environment variable MAX_CONCURRENT_REQUESTS
    - _Requirements: 9.5_

- [x] 11. Implement text chunking for delta events
  - [x] 11.1 Implement text chunking logic in handleChunk
    - Split text into chunks of TEXT_CHUNK_SIZE
    - Preserve character integrity (no mid-character splits)
    - Generate multiple delta events for large text
    - Send delta events in order
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_
  
  - [ ]* 11.2 Write property test for text chunking integrity
    - **Property 13: Text Chunking Integrity**
    - **Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5**
    - Test concatenation of chunks equals original text

- [x] 12. Implement lifecycle management
  - [x] 12.1 Implement dispatcher initialization
    - Initialize in connection.ts when WebSocket connects
    - Register with SDK during initialization
    - _Requirements: 13.1, 13.2_
  
  - [x] 12.2 Implement graceful shutdown
    - Wait for in-flight requests to complete (with timeout)
    - Cancel pending SDK operations
    - Clean up all contexts
    - _Requirements: 13.3, 13.4, 13.5_
  
  - [ ]* 12.3 Write property test for graceful shutdown cleanup
    - **Property 16: Graceful Shutdown Cleanup**
    - **Validates: Requirements 13.3, 13.4, 13.5**
    - Test cleanup of active requests at shutdown

- [x] 13. Implement comprehensive logging
  - [x] 13.1 Add logging to dispatchRequest
    - Log request dispatch with messageId and content length
    - _Requirements: 15.1_
  
  - [x] 13.2 Add logging to callback handlers
    - Log callback invocations with chunk size and completion status
    - _Requirements: 15.2_
  
  - [x] 13.3 Add logging to event generation
    - Log each event generation with event type and response_id
    - _Requirements: 15.3_
  
  - [x] 13.4 Add logging to error handlers
    - Log errors with full context including request details and error messages
    - _Requirements: 15.4_
  
  - [x] 13.5 Add debug logging for protocol details
    - Log detailed protocol message contents when debug mode enabled
    - _Requirements: 15.5_
  
  - [ ]* 13.6 Write property test for comprehensive logging
    - **Property 17: Comprehensive Logging**
    - **Validates: Requirements 15.1, 15.2, 15.3, 15.4, 15.5**
    - Test all lifecycle events generate appropriate logs

- [x] 14. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 15. Write property test for request parsing round trip
  - [ ]* 15.1 Implement property test for request parsing
    - **Property 1: Request Parsing Round Trip**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.5**
    - Test parsing extracts content and messageId correctly

- [x] 16. Final integration and wiring
  - [x] 16.1 Wire all components together in connection.ts
    - Ensure SDK dispatcher is properly initialized
    - Ensure message routing works correctly
    - Ensure event transmission works correctly
    - _Requirements: 1.1, 2.1, 3.1, 6.1_
  
  - [x] 16.2 Verify no orphaned code or unused imports
    - Remove any temporary test code
    - Clean up unused imports
    - Ensure all code is integrated
  
  - [x] 16.3 Run full test suite
    - Run all unit tests
    - Run all property tests
    - Run all integration tests
    - Verify test coverage

- [x] 17. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties (19 total)
- Unit tests validate specific examples and edge cases
- Integration tests verify complete end-to-end flows
- The implementation uses TypeScript with strict type checking
- All code follows existing project patterns and conventions
- The design uses existing protocol.ts helpers where possible
- Error handling isolates failures to individual requests
- Concurrent request support enables parallel processing
- Timeout mechanism prevents indefinite resource holding
- Comprehensive logging enables debugging and monitoring
