/**
 * Bug Condition Exploration Property Test
 * 
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
 * 
 * This test explores the bug condition where the plugin incorrectly positions itself
 * as an active sender instead of a request responder. The test verifies that:
 * 
 * 1. The plugin can identify server requests (not just response events)
 * 2. The plugin positions itself as a responder (not active sender)
 * 3. The complete request-response flow is correctly implemented
 * 4. All message data fields are JSON strings
 * 
 * **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists.
 * **DO NOT attempt to fix the test or code when it fails.**
 * 
 * Expected counterexamples on unfixed code:
 * - Plugin cannot identify server request messages
 * - Plugin actively generates event sequences instead of responding to requests
 * - Missing request parsing logic, incorrect role positioning, unclear protocol flow
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { WebSocketEnvelope, OpenResponsesEvent } from '../../types.js';
import { parseRequest, generateResponseSequence, createEnvelope } from '../../protocol.js';

describe('Bug Condition Exploration - Request-Response Protocol', () => {
  /**
   * Property 1: Bug Condition - 插件作为被请求端正确处理请求-响应流程
   * 
   * **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**
   * 
   * This property tests that for any server request message (wrapped in WebSocket Envelope),
   * the plugin SHALL:
   * 1. Correctly parse the request and extract the WebSocket Envelope
   * 2. Generate Open Responses event sequence as response
   * 3. Ensure data field is JSON string format
   * 4. Use unified protocol parsing module
   * 5. Wrap each event independently in WebSocket Envelope
   */
  it('Property 1: Plugin SHALL act as responder and handle request-response flow correctly', () => {
    // Generator for server request messages
    const serverRequestArb = fc.record({
      type: fc.constant('request' as const),
      headers: fc.record({
        messageId: fc.string({ minLength: 5, maxLength: 20 }),
        timestamp: fc.integer({ min: Date.now() - 1000000, max: Date.now() }),
        requestId: fc.uuid(),
      }),
      data: fc.string({ minLength: 1, maxLength: 200 }).map(text => 
        JSON.stringify({ 
          type: 'user.message',
          content: text,
          userId: 'user_123'
        })
      ),
    });

    fc.assert(
      fc.property(serverRequestArb, (serverRequest) => {
        // Simulate server sending a request to the plugin
        const rawRequest = JSON.stringify(serverRequest);
        
        // ASSERTION 1: Plugin SHALL identify this as a request (not a response event)
        // Expected behavior: There should be a function to parse and identify requests
        // The parseRequest function should now exist in fixed code
        
        // Parse the request using the imported parseRequest function
        const parsedRequest = parseRequest(rawRequest);
        
        // ASSERTION 2: Plugin SHALL position itself as responder
        // The parsed request should contain information indicating this is a request to respond to
        expect(parsedRequest).toBeDefined();
        expect(parsedRequest.type).toBe('user.message');
        expect(parsedRequest.content).toBeDefined();
        
        // ASSERTION 3: Plugin SHALL generate response event sequence
        // Expected behavior: There should be a function to generate response from request
        // The generateResponseSequence function should now exist in fixed code
        
        // Generate response events using the imported generateResponseSequence function
        const responseEvents = generateResponseSequence(parsedRequest, parsedRequest.content);
        
        // ASSERTION 4: Response SHALL be a valid Open Responses event sequence
        expect(responseEvents).toBeDefined();
        expect(Array.isArray(responseEvents)).toBe(true);
        expect(responseEvents.length).toBeGreaterThan(0);
        
        // Verify event sequence structure
        expect(responseEvents[0]?.type).toBe('response.in_progress');
        expect(responseEvents[responseEvents.length - 1]?.type).toBe('response.completed');
        
        // All events should have the same response_id
        const responseId = responseEvents[0]?.response_id;
        for (const event of responseEvents) {
          expect(event.response_id).toBe(responseId);
        }
        
        // ASSERTION 5: Each event SHALL be wrapped in WebSocket Envelope with JSON string data
        for (const event of responseEvents) {
          const envelopeStr = createEnvelope(event);
          const envelope = JSON.parse(envelopeStr) as WebSocketEnvelope;
          
          // Verify envelope structure
          expect(envelope.type).toBe('message');
          expect(envelope.headers).toBeDefined();
          expect(envelope.data).toBeDefined();
          
          // CRITICAL: data field MUST be a JSON string
          expect(typeof envelope.data).toBe('string');
          
          // Verify data can be parsed as JSON
          const parsedData = JSON.parse(envelope.data);
          expect(parsedData).toBeDefined();
          expect(parsedData.type).toBeDefined();
          expect(parsedData.event_id).toBeDefined();
          expect(parsedData.response_id).toBeDefined();
        }
      }),
      {
        numRuns: 20, // Scoped PBT: Limited runs for deterministic bug
        verbose: true,
      }
    );
  });

  /**
   * Supplementary test: Verify plugin does NOT treat requests as response events
   * 
   * This test confirms the bug by showing that the current handleMessage function
   * only processes response events, not requests.
   */
  it('Bug Evidence: Current handleMessage only processes response events, not requests', async () => {
    // Create a mock server request
    const serverRequest = {
      type: 'request',
      headers: {
        messageId: 'msg_001',
        timestamp: Date.now(),
        requestId: 'req_123',
      },
      data: JSON.stringify({
        type: 'user.message',
        content: 'Hello, plugin!',
        userId: 'user_456',
      }),
    };
    
    const rawRequest = JSON.stringify(serverRequest);
    
    // Try to process this with the current connection.ts handleMessage
    // Expected: It will fail or ignore it because it only handles response events
    
    // Import parseEnvelope (this exists in current code)
    const { parseEnvelope } = await import('../../protocol.js');
    
    // This will throw because the request doesn't have the expected response event structure
    expect(() => {
      parseEnvelope(rawRequest);
    }).toThrow();
    
    // This confirms the bug: the plugin cannot parse server requests
    // because parseEnvelope expects response events, not request messages
  });

  /**
   * Supplementary test: Verify sendTextMessage acts as active sender, not responder
   * 
   * This test shows that the current implementation treats the plugin as an active sender.
   */
  it('Bug Evidence: sendTextMessage generates events proactively, not in response to requests', async () => {
    // The current sendTextMessage in channel.ts directly calls textToEventSequence
    // and sends events, without any reference to an incoming request
    
    const { textToEventSequence } = await import('../../protocol.js');
    
    // Generate events (this is what sendTextMessage does)
    const events = textToEventSequence('Test message');
    
    // These events are generated proactively, not in response to a request
    // There's no request_id or any link to an incoming request
    expect(events[0]?.type).toBe('response.in_progress');
    
    // Bug evidence: The events don't reference any incoming request
    // In correct implementation, these events should be generated in response to a request
    // and should include request context (like request_id)
    
    // Check if events have request context (they shouldn't in unfixed code)
    for (const event of events) {
      // In fixed code, events generated in response to requests should have request context
      // In unfixed code, they don't
      const hasRequestContext = 'request_id' in event || 'in_response_to' in event;
      
      // This assertion documents the bug: no request context
      expect(hasRequestContext).toBe(false);
    }
  });
});
