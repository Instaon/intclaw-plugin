---
name: intclaw_matrix
description: Instructs the AI on formatting and targeting rules for the intclaw_matrix_send tool
---

# IntClaw Matrix Plugin SKILL

This skill activates when the user requests integration or message delivery through the IntClaw Matrix framework.

## Behavior

1. **Active Invocation**: Whenever the user explicitly asks you to "send a matrix message", "dispatch via matrix", or similar, YOU MUST call the `intclaw_matrix_send` tool.
2. **Target Resolution**: Always require the user to specify a full Matrix destination such as `!roomid:matrix.org` or `@username:homeserver.com`. If the destination is ambiguous or not provided, ask the user to clarify before dispatching.
3. **Account Targeting**: By default, use the `default` account ID. If the user expresses that they want to send it from a specific bot instance or account, pass that through the `account_id` parameter of the tool.

## Formatting Rules

- Output pure structured text without heavy Markdown when dispatching text payloads to `intclaw_matrix_send`. Matrix handles plaintext or basic HTML best. Do not wrap payloads in codeblocks unless explicitly communicating code.
- Report back the Matrix Event ID obtained from the tool output directly to the user upon a successful dispatch.

