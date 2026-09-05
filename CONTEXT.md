# AD Tools Analytics

This context defines how product adoption and delivered user value are described and measured across AD Tools.

## Language

**Tool Open**:
A user reaches a usable tool surface. It measures adoption and visits, not value delivered.
_Avoid_: Use, activity, engagement

**Tool Use**:
A user-initiated core operation reaches the tool-specific success boundary and produces usable output or starts the requested external work.
_Avoid_: Click, attempt, mount, open

**Supporting Event**:
An interaction or diagnostic observation that explains behavior but does not independently represent delivered value, such as a tab change, validation error, or retry.
_Avoid_: Tool use, impact

**Impact**:
The combination of verified Tool Uses and the distinct real users who received that value. Tool Opens and Supporting Events are reported separately.
_Avoid_: Raw activity, total events

The per-tool action names and success boundaries live in `frontend/config/tool-usage-definitions.json` and are enforced against the registered tool list by a test.
