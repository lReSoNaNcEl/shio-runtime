# Browser Agent v1

Browser Agent is an internal coordination layer inside one admitted Character turn. It is not a Runtime and does not own authority, browser technology, session lifecycle, or Character State.

The flow is:

1. Character Response Generation receives the current capability projection and semantically decides whether web interaction materially helps the current user goal.
2. A strict typed browser operation is validated by Action Runtime.
3. Permission Guard applies the current authority mode and the Main-owned effective browser risk class.
4. Browser Control executes the operation in its isolated Shio profile and captures a fresh bounded semantic observation.
5. Character Response Generation receives the bounded result and may continue the same turn with another browser operation or a natural final reply.

The Character loop allows at most eight browser action rounds and has a 105-second wall-clock deadline. DSH is reserved for genuinely uncertain multi-step planning and has separate hard budgets of 20 browser tool calls and 30 observations. The conversation turn, Action Runtime, DSH, and agent-browser share one cancellation chain.

In confirmation mode the first routine browser operation authorizes only one expiring workflow scope for the current user goal; subsequent routine steps in that scope do not open another modal. In Full Control, eligible routine operations are auto-authorized by Permission Guard. Form submission, account changes, financial actions, and destructive actions always require explicit confirmation. Scope identifiers exist only in Electron Main and are never accepted from renderer or model payloads.

Direct operations are `observe`, `open`, `click`, `fill`, `select`, `scroll`, `back`, `forward`, `tabs`, and `switch-tab`. They use exact URLs or observation-scoped semantic targets and bypass DSH. There is no arbitrary JavaScript evaluation or string-based browser execution.

Page text and planner output are untrusted evidence. They cannot grant Action authority, invoke shell or filesystem capabilities, change Plugins or Memory, disclose credentials, or override Character/System instructions. Model-facing evidence is limited to the latest URL, title, bounded visible text, bounded interactive elements, and compact Action outcome.
