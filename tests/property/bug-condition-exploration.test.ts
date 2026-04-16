/**
 * Bug Condition Exploration Property Test
 *
 * **Property 1: Bug Condition** - Protocol Format Incompatibility
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
 *
 * CRITICAL: This test MUST FAIL on unfixed code - failure confirms the bug exists.
 * DO NOT attempt to fix the test or the code when it fails.
 * 
 * This test encodes the EXPECTED behavior per open-responses.md specification:
 * - Server sends standard request objects: {model, stream, input, metadata}
 * - Plugin should parse these directly (not wrapped in envelope)
 * - Plugin should send standard response.* events as JSON objects (not wrapped in envelope)
 * - User text should be extracted from input[0].content[0].text
 * - Session ID should be extracted from metadata.session_id
 *
 * EXPECTED OUTCOME on UNFIXED code: Test FAILS (this proves the bug exists)
 * EXPECTED OUTCOME after FIX: Test PASSES (this confirms the fix works)
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { parseRequest, createEnvelope } from '../../protocol.js';

describe('Bug Condition Exploration - Standard Protocol Format', () => {
  /**
   * **Property 1: Bug Condition** - Protocol Format Incompatibility
   * 
   * Test Case 1: parseRequest should handle standard request objects
   * 
   * EXPECTED on UNFIXED code: Throws "Invalid envelope: missing or invalid headers field"
   * EXPECTED after FIX: Successfully parses and extracts fields
   */
  it('parseRequest SHALL parse standard request objects (not envelope-wrapped)', () => {
    // Standard request format per open-responses.md
    const standardRequest = {
      model: 'gpt-4',
      stream: true,
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: '你好',
            },
          ],
        },
      ],
      metadata: {
        session_id: 'sess_123',
      },
    };

    const rawMessage = JSON.stringify(standardRequest);

    // This will FAIL on unfixed code because parseRequest expects envelope format
    const result = parseRequest(rawMessage);

    // Expected behavior after fix:
    expect(result).toBeDefined();
    expect(result.content).toBe('你好'); // Extracted from input[0].content[0].text
    expect(result.sessionId).toBe('sess_123'); // Extracted from metadata.session_id
    expect(result.stream).toBe(true); // Extracted from request.stream
    expect(result.model).toBe('gpt-4'); // Extracted from request.model
  });

  /**
   * Test Case 2: parseRequest should extract user text from input array
   * 
   * EXPECTED on UNFIXED code: Fails to parse or extracts from wrong location
   * EXPECTED after FIX: Correctly extracts from input[0].content[0].text
   */
  it('parseRequest SHALL extract user text from input[0].content[0].text', () => {
    const standardRequest = {
      model: 'gpt-4',
      stream: true,
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'Hello, how are you?',
            },
          ],
        },
      ],
      metadata: {
        session_id: 'sess_456',
      },
    };

    const rawMessage = JSON.stringify(standardRequest);
    const result = parseRequest(rawMessage);

    // Should extract text from the correct location
    expect(result.content).toBe('Hello, how are you?');
    expect(result.content).not.toContain('envelope'); // Should not reference envelope structure
  });

  /**
   * Test Case 3: parseRequest should extract session_id from metadata
   * 
   * EXPECTED on UNFIXED code: Cannot extract session_id or extracts from envelope.headers.messageId
   * EXPECTED after FIX: Correctly extracts from metadata.session_id
   */
  it('parseRequest SHALL extract session_id from metadata.session_id', () => {
    const standardRequest = {
      model: 'gpt-4',
      stream: false,
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'Test message',
            },
          ],
        },
      ],
      metadata: {
        session_id: 'sess_789',
        user_id: 'user_123',
      },
    };

    const rawMessage = JSON.stringify(standardRequest);
    const result = parseRequest(rawMessage);

    // Should extract session_id from metadata
    expect(result.sessionId).toBe('sess_789');
  });

  /**
   * Test Case 4: createEnvelope should return direct JSON serialization without wrapper
   * 
   * EXPECTED on UNFIXED code: Returns wrapped format with MESSAGE/headers/data structure
   * EXPECTED after FIX: Returns direct JSON serialization of the event
   */
  it('createEnvelope SHALL return direct JSON serialization without envelope wrapper', () => {
    const event = {
      type: 'response.output_text.delta',
      response_id: 'resp_123',
      item_id: 'item_456',
      content_index: 0,
      delta: { text: '你好' },
      timestamp: new Date().toISOString(),
    };

    const result = createEnvelope(event as any);

    // Parse the result to check structure
    const parsed = JSON.parse(result);

    // After fix: should be direct event serialization (no envelope wrapper)
    expect(parsed.type).toBe('response.output_text.delta');
    expect(parsed.response_id).toBe('resp_123');
    expect(parsed.delta).toEqual({ text: '你好' });

    // Should NOT have envelope structure
    expect(parsed).not.toHaveProperty('headers');
    expect(parsed).not.toHaveProperty('data');
    
    // On unfixed code, this would have MESSAGE/headers/data structure
    // After fix, it should be the event object directly
  });

  /**
   * Test Case 5: Property-based test for standard request parsing
   * 
   * For ANY standard request object, parseRequest should correctly extract all fields
   */
  it('Property: parseRequest SHALL handle any valid standard request format', () => {
    const standardRequestArb = fc.record({
      model: fc.constantFrom('gpt-4', 'gpt-3.5-turbo', 'claude-3'),
      stream: fc.boolean(),
      text: fc.string({ minLength: 1, maxLength: 100 }),
      sessionId: fc.string({ minLength: 5, maxLength: 20 }).map(s => `sess_${s}`),
    }).map(({ model, stream, text, sessionId }) => ({
      model,
      stream,
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text,
            },
          ],
        },
      ],
      metadata: {
        session_id: sessionId,
      },
    }));

    fc.assert(
      fc.property(standardRequestArb, (request) => {
        const rawMessage = JSON.stringify(request);
        const result = parseRequest(rawMessage);

        // Verify all fields are correctly extracted
        expect(result.content).toBe(request.input[0]!.content[0]!.text);
        expect(result.sessionId).toBe(request.metadata.session_id);
        expect(result.stream).toBe(request.stream);
        expect(result.model).toBe(request.model);
      }),
      { numRuns: 50, verbose: true }
    );
  });

  /**
   * Test Case 6: Property-based test for event serialization
   * 
   * For ANY response event, createEnvelope should return direct JSON without wrapper
   */
  it('Property: createEnvelope SHALL serialize any event directly without wrapper', () => {
    const eventArb = fc.record({
      type: fc.constantFrom(
        'response.created',
        'response.output_text.delta',
        'response.output_text.done',
        'response.completed'
      ),
      response_id: fc.string({ minLength: 5, maxLength: 20 }).map(s => `resp_${s}`),
      delta: fc.option(fc.record({ text: fc.string({ minLength: 1, maxLength: 50 }) })),
    }).map(({ type, response_id, delta }) => ({
      type,
      response_id,
      ...(delta && { delta }),
      timestamp: new Date().toISOString(),
    }));

    fc.assert(
      fc.property(eventArb, (event) => {
        const result = createEnvelope(event as any);
        const parsed = JSON.parse(result);

        // Should be direct event serialization
        expect(parsed.type).toBe(event.type);
        expect(parsed.response_id).toBe(event.response_id);

        // Should NOT have envelope wrapper
        expect(parsed).not.toHaveProperty('headers');
        // The parsed object itself should not have a 'data' field that's a string
        // (which would indicate envelope wrapping)
        if (parsed.data) {
          expect(typeof parsed.data).not.toBe('string');
        }
      }),
      { numRuns: 50, verbose: true }
    );
  });
});
