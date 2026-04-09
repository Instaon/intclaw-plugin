# Implementation Plan

## Overview

This task list implements the WebSocket protocol refactor bugfix following the exploratory bugfix workflow. The fix addresses protocol format incompatibility between the current envelope-based implementation and the standard JSON object format required by open-responses.md specification.

**Key Changes:**
- Refactor `parseRequest` to parse standard request objects directly
- Refactor `createEnvelope` to serialize events without envelope wrapping
- Update type definitions to support standard protocol format
- Preserve all non-protocol functionality (SDK dispatcher, connection management, heartbeat, timeout, logging)

---

## Tasks

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Protocol Format Incompatibility
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate protocol format mismatch
  - **Scoped PBT Approach**: Test concrete failing cases - standard request parsing and standard event sending
  - Test implementation details from Bug Condition in design:
    - Standard request object parsing: `{"model":"gpt-4","stream":true,"input":[...],"metadata":{"session_id":"sess_123"}}`
    - Standard event sending: events should be sent as JSON objects without envelope wrapping
    - User text extraction: from `input[0].content[0].text` not `envelope.data.content`
    - Session ID extraction: from `metadata.session_id` not `envelope.headers.messageId`
  - The test assertions should match the Expected Behavior Properties from design:
    - parseRequest should extract content from input array
    - parseRequest should extract session_id from metadata
    - createEnvelope should return direct JSON serialization without wrapper
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)
  - Document counterexamples found:
    - parseRequest throws "Invalid envelope: missing or invalid headers field" for standard requests
    - createEnvelope returns wrapped format with MESSAGE/headers/data structure
    - Cannot extract session_id from standard request metadata
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Non-Protocol Functionality Preservation
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for non-protocol-related functionality:
    - SDK dispatcher callback handling (chunk, completion, error signals)
    - Connection lifecycle management (connect, disconnect, reconnect, heartbeat)
    - Concurrent request control and context mapping
    - Timeout handling (14s timeout, AbortController cancellation)
    - Error isolation and recovery mechanisms
    - Logging and diagnostic output
    - Response ID and item ID generation
  - Write property-based tests capturing observed behavior patterns from Preservation Requirements:
    - For all SDK callback invocations, dispatcher behavior remains unchanged
    - For all connection state transitions, lifecycle management remains unchanged
    - For all concurrent request scenarios, control mechanisms remain unchanged
    - For all timeout scenarios, handling behavior remains unchanged
  - Property-based testing generates many test cases for stronger guarantees
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [x] 3. Fix for WebSocket protocol format incompatibility

  - [x] 3.1 Update type definitions in types.ts
    - Add new fields to RequestContent interface:
      - `sessionId: string` - session identifier from metadata
      - `stream: boolean` - streaming flag from request
      - `model?: string` - model identifier from request
    - Add new fields to RequestContext interface:
      - `stream: boolean` - streaming flag for response mode selection
      - `sessionId: string` - session identifier for routing
    - Remove or deprecate envelope-specific types if no longer needed
    - _Bug_Condition: isBugCondition(input) where input is standard request/event format_
    - _Expected_Behavior: Types support standard protocol format with session_id and stream fields_
    - _Preservation: Existing type definitions for non-protocol types remain unchanged_
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.2 Refactor parseRequest in protocol.ts
    - Remove envelope parsing layer:
      - Delete `const envelope = JSON.parse(rawMessage) as WebSocketEnvelope`
      - Delete envelope.type, envelope.headers, envelope.data validation
    - Parse standard request format directly:
      - `const request = JSON.parse(rawMessage)` as standard request object
      - Validate `request.input` array exists and is non-empty
      - Validate `request.input[0].content[0].text` exists
      - Validate `request.metadata.session_id` exists
    - Extract fields from standard request:
      - `content`: from `request.input[0].content[0].text`
      - `sessionId`: from `request.metadata.session_id`
      - `stream`: from `request.stream` (default to true if missing)
      - `model`: from `request.model` (optional)
      - `messageId`: generate new ID or extract from metadata if available
    - Return RequestContent with all extracted fields
    - Update error messages to reflect standard format validation
    - _Bug_Condition: isBugCondition(input) where input is standard request object_
    - _Expected_Behavior: expectedBehavior(result) - correctly parse standard request and extract all fields_
    - _Preservation: Error handling and logging mechanisms remain unchanged_
    - _Requirements: 2.1, 2.3_

  - [x] 3.3 Refactor createEnvelope in protocol.ts
    - Remove envelope wrapping logic:
      - Delete envelope object construction
      - Delete topic parameter from function signature
    - Return direct JSON serialization:
      - `return JSON.stringify(event)`
      - No MESSAGE/headers/data wrapper
    - Rename function to `serializeEvent` for clarity (optional but recommended)
    - Update all call sites to remove topic parameter
    - _Bug_Condition: isBugCondition(input) where input is response event object_
    - _Expected_Behavior: expectedBehavior(result) - directly serialize event without wrapper_
    - _Preservation: Event object structure and content remain unchanged_
    - _Requirements: 2.2_

  - [x] 3.4 Update SDK dispatcher to handle standard protocol
    - Update dispatchRequest to extract and store new fields:
      - Extract `stream` flag from parsed request
      - Extract `sessionId` from parsed request
      - Store both in RequestContext
    - Update event generation to include session_id in metadata:
      - Modify event creation functions to accept sessionId parameter
      - Include `metadata: { session_id: sessionId }` in response.created and response.completed events
    - Support non-streaming mode (if stream=false):
      - Implement `generateCompleteResponse` method
      - Generate complete response object instead of event sequence
      - Include all fields: id, object, status, output, output_text, metadata
    - Update all createEnvelope calls to use new signature (remove topic parameter)
    - _Bug_Condition: isBugCondition(input) where input requires session routing or non-streaming mode_
    - _Expected_Behavior: expectedBehavior(result) - correctly route by session_id and support both streaming modes_
    - _Preservation: SDK callback handling, timeout, error isolation remain unchanged_
    - _Requirements: 2.3, 2.4, 2.5, 2.6_

  - [x] 3.5 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Protocol Format Compatibility
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - Verify all assertions pass:
      - parseRequest correctly parses standard request objects
      - User text extracted from input[0].content[0].text
      - Session ID extracted from metadata.session_id
      - createEnvelope (or serializeEvent) returns direct JSON without wrapper
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 3.6 Verify preservation tests still pass
    - **Property 2: Preservation** - Non-Protocol Functionality Preservation
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Verify all preservation properties hold:
      - SDK dispatcher callback handling unchanged
      - Connection lifecycle management unchanged
      - Concurrent request control unchanged
      - Timeout handling unchanged
      - Error isolation and recovery unchanged
      - Logging and diagnostics unchanged
      - ID generation mechanisms unchanged
    - Confirm all tests still pass after fix (no regressions)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [x] 4. Checkpoint - Ensure all tests pass
  - Run complete test suite including:
    - Bug condition exploration test (Property 1)
    - Preservation property tests (Property 2)
    - Existing unit tests for protocol.ts
    - Existing unit tests for sdk-dispatcher.ts
    - Integration tests for full request-response flow
  - Verify no regressions in existing functionality
  - Verify protocol format compatibility with open-responses.md specification
  - Document any edge cases or limitations discovered
  - Ask the user if questions arise or if additional testing is needed

---

## Notes

**Testing Strategy:**
- Task 1 uses scoped property-based testing to explore concrete failing cases on unfixed code
- Task 2 uses property-based testing to capture baseline behavior for preservation checking
- Tasks 3.5 and 3.6 re-run the same tests to verify fix correctness and preservation

**Key Constraints:**
- Exploration test (Task 1) MUST be standalone, NOT a sub-task
- Preservation test (Task 2) MUST be standalone, NOT a sub-task
- Both tests MUST use `**Property N: Type**` format for hover status
- Implementation (Task 3) is a parent task with sub-tasks
- All sub-tasks reference design specifications in annotations

**Protocol Format Changes:**
- Inbound: Parse standard request `{model, stream, input, metadata}` directly
- Outbound: Send standard response.* events as JSON objects without envelope wrapper
- Session routing: Use `metadata.session_id` for correlation
- Streaming modes: Support both `stream=true` (event sequence) and `stream=false` (complete object)
