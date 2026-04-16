# Implementation Plan: Session-Based User Isolation

## Overview

This implementation adds session-based user isolation to the InstaClaw Connector plugin, implementing OpenClaw's `per-channel-peer` isolation mode. The feature ensures that different users within the same channel maintain separate AI conversation contexts by constructing session identifiers that include both `channelId` and `userId`.

The implementation follows a phased approach:
1. Add session ID construction in protocol.ts
2. Integrate with SDK dispatcher
3. Update event metadata
4. Add comprehensive tests

## Tasks

- [ ] 1. Implement session ID construction in protocol.ts
  - [x] 1.1 Add buildSessionId function
    - Create `buildSessionId(userId: string | number, channelId: string | number): string` function
    - Return format: `channel:{channelId}:user:{userId}`
    - Convert both parameters to strings for type safety
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_
  
  - [x] 1.2 Update parseRequest to extract identity fields
    - Extract `metadata.user_id` from request
    - Extract `metadata.channel_id` from request
    - Validate both fields are non-empty strings
    - Throw descriptive error if either field is missing or invalid
    - Call `buildSessionId` to construct sessionId
    - Include sessionId in returned RequestContent
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.7_
  
  - [ ]* 1.3 Write unit tests for buildSessionId
    - Test same userId + channelId returns same sessionId
    - Test different userId, same channelId returns different sessionId
    - Test same userId, different channelId returns different sessionId
    - Test type coercion: number inputs converted to strings
    - Test edge cases: empty strings, special characters
    - _Requirements: 2.3, 2.4, 2.5_
  
  - [ ]* 1.4 Write unit tests for parseRequest identity extraction
    - Test valid request with user_id and channel_id succeeds
    - Test missing user_id throws error
    - Test missing channel_id throws error
    - Test non-string user_id throws error
    - Test non-string channel_id throws error
    - Test sessionId included in returned RequestContent
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

- [ ] 2. Update types.ts to include sessionId
  - [x] 2.1 Add sessionId field to RequestContent interface
    - Add `sessionId: string` field with JSDoc comment
    - Document format: `channel:{channelId}:user:{userId}`
    - _Requirements: 4.6_

- [x] 3. Integrate session ID with SDK dispatcher
  - [x] 3.1 Update RequestContext interface
    - Add `sessionId: string` field to RequestContext interface
    - Add JSDoc comment explaining session identifier purpose
    - _Requirements: 4.1, 4.2_
  
  - [x] 3.2 Update dispatchRequest to pass sessionId
    - Accept sessionId field in request parameter
    - Store sessionId in RequestContext when creating context
    - Pass sessionId to realSDKDispatch method
    - _Requirements: 4.1, 4.2, 4.3_
  
  - [x] 3.3 Implement buildSessionKey method
    - Create private `buildSessionKey(sessionId?: string): string` method
    - If sessionId provided and accountId exists: return `instaclaw:{accountId}:{sessionId}`
    - If sessionId provided but no accountId: return `instaclaw:default:{sessionId}`
    - If no sessionId: return `instaclaw:{accountId}` or `instaclaw:default`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.6_
  
  - [x] 3.4 Update realSDKDispatch to use Session_Key
    - Call buildSessionKey with sessionId parameter
    - Set MsgContext.SessionKey to the constructed Session_Key
    - Pass Session_Key to SDK dispatchReplyWithBufferedBlockDispatcher
    - _Requirements: 3.4, 3.5, 3.7_
  
  - [ ]* 3.5 Write unit tests for SDK dispatcher session integration
    - Test RequestContext includes sessionId field
    - Test Session_Key constructed correctly with accountId
    - Test Session_Key constructed correctly without accountId
    - Test different users get different Session_Keys
    - Test same user gets same Session_Key across requests
    - _Requirements: 3.1, 3.2, 3.3, 3.6, 3.7_

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Update event generation to include session_id
  - [x] 5.1 Update generateInProgressEvent
    - Pass `context.sessionId` to `createInProgressEvent`
    - Verify metadata.session_id included in event
    - _Requirements: 5.1_
  
  - [x] 5.2 Update generateCompletedEvent
    - Pass `context.sessionId` to `createCompletedEvent`
    - Verify metadata.session_id included in event
    - _Requirements: 5.2_
  
  - [x] 5.3 Update generateFailedEvent
    - Pass `context.sessionId` to `createFailedEvent`
    - Verify metadata.session_id included in event
    - _Requirements: 5.3_
  
  - [x] 5.4 Update generateCompleteResponse
    - Pass `context.sessionId` to `createCompleteResponse`
    - Verify metadata.session_id included in response object
    - _Requirements: 5.4, 5.5_
  
  - [ ]* 5.5 Write unit tests for event metadata
    - Test in_progress event includes metadata.session_id
    - Test completed event includes metadata.session_id
    - Test failed event includes metadata.session_id
    - Test complete response includes metadata.session_id
    - Test sessionId format matches `channel:{channelId}:user:{userId}`
    - Test sessionId consistency across events for same request
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [x] 6. Add logging for session identifiers
  - [x] 6.1 Update parseRequest logging
    - Log userId, channelId, and constructed sessionId
    - Include in existing "Parsed user request" log statement
    - _Requirements: 7.1_
  
  - [x] 6.2 Update dispatchRequest logging
    - Log sessionId and Session_Key in "Dispatching request to SDK" log
    - _Requirements: 7.2_
  
  - [x] 6.3 Update event generation logging
    - Log sessionId in all event generation debug logs
    - _Requirements: 7.3_
  
  - [x] 6.4 Update completion/failure logging
    - Log sessionId in request completion log
    - Log sessionId in request failure log
    - _Requirements: 7.4_
  
  - [x] 6.5 Update cleanup logging
    - Log sessionId in context cleanup debug log
    - _Requirements: 7.5_

- [x] 7. Update error handling for identity extraction
  - [x] 7.1 Add error handling for missing user_id
    - Throw error with message "Invalid request: missing or non-string metadata.user_id"
    - Include message preview in error log (first 100 characters)
    - _Requirements: 8.1, 8.3_
  
  - [x] 7.2 Add error handling for missing channel_id
    - Throw error with message "Invalid request: missing or non-string metadata.channel_id"
    - Include message preview in error log (first 100 characters)
    - _Requirements: 8.2, 8.3_
  
  - [x] 7.3 Update SDK dispatch error handling
    - Include sessionId in error logs for SDK dispatch failures
    - Ensure failed events include metadata.session_id
    - _Requirements: 8.4, 8.5_
  
  - [x] 7.4 Update timeout error handling
    - Include sessionId in timeout error logs
    - Ensure timeout failed events include metadata.session_id
    - _Requirements: 8.6_

- [x] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ]* 9. Add integration tests for user isolation
  - [ ]* 9.1 Write multi-user scenario test
    - User A sends message in channel X
    - User B sends message in channel X
    - Verify different Session_Keys used
    - Verify responses include correct session_id
    - _Requirements: 6.1, 6.2, 6.5_
  
  - [ ]* 9.2 Write same user continuity test
    - User A sends first message in channel X
    - User A sends second message in channel X
    - Verify same Session_Key used
    - Verify session_id consistent across responses
    - _Requirements: 6.3_
  
  - [ ]* 9.3 Write cross-channel isolation test
    - User A sends message in channel X
    - User A sends message in channel Y
    - Verify different Session_Keys used
    - Verify different session_ids in responses
    - _Requirements: 6.4, 6.5_
  
  - [ ]* 9.4 Write error isolation test
    - User A's request times out
    - User B's request completes successfully
    - Verify User B unaffected by User A's timeout
    - _Requirements: 6.6_

- [x] 10. Update existing tests to provide identity fields
  - [x] 10.1 Update test fixtures
    - Add metadata.user_id field to all test request fixtures
    - Add metadata.channel_id field to all test request fixtures
    - Use consistent test values (e.g., user_id: "test-user", channel_id: "test-channel")
    - _Requirements: 9.1, 9.6_
  
  - [x] 10.2 Update mock request builders
    - Update all mock request builders to include identity fields
    - Ensure backward compatibility with existing tests
    - _Requirements: 9.2_
  
  - [x] 10.3 Verify all existing tests pass
    - Run full test suite
    - Fix any tests that fail due to missing identity fields
    - _Requirements: 9.3, 9.4, 9.5_

- [-] 11. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- The implementation follows the phased approach from the design document
- All identity fields must be validated before constructing session identifiers
- Session identifiers must be passed through the entire request lifecycle
- All response events must include metadata.session_id for proper routing
