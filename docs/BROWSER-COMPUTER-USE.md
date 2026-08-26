# Browser Control and Computer Use v1

Browser Control is a bundled Plugin and the single owner of Shio's browser session. It launches the user's installed Google Chrome through pinned `playwright-core` with one headed persistent context below Shio `userData`. The profile is isolated from the user's personal Chrome profile and survives ordinary conversational idle periods.

The Plugin exposes two typed capabilities over that same context:

- `browser-control` provides bounded observation and deterministic open, semantic click, fill, select, scroll, history, tab inspection, and known-tab switching.
- `browser-computer-use` provides one bounded generic Observe → Decide → Act → Observe session for ordinary websites, canvas applications, and keyboard-driven browser experiences.

Character Response Generation sees only deterministic browser tools and the high-level `browser.use`, `browser.useStatus`, `browser.usePause`, `browser.useResume`, and `browser.useStop` tools. Screenshots, coordinates, pointer/key down or up, drag paths, CDP, and arbitrary page JavaScript remain internal to Browser Control. Every external mutation still passes through Action Runtime, Permission Guard, lifecycle logging, cancellation, and verification.

Computer Use observations combine a bounded accessibility snapshot and semantic ref map with an optional transient masked screenshot. The Main-owned `Computer Use Vision` role is separate from the Character Brain and Fast Brain. Auto mode reuses the active Character provider/model only when image support is confirmed; otherwise visual control reports `needs-setup` and remains unavailable without disabling deterministic semantic browser operations. Provider/model, timeout, and maximum-step settings are bounded and reuse the existing Main-owned credential store. Decisions bind to the exact observation and page. Navigation, active-page, URL, viewport, or accessibility-state changes make a decision stale before input. A successful mutation invalidates the old observation and captures a fresh one.

The input boundary tracks held keys and pointer buttons and releases them on pause, stop, blocker, error, provider failure, Plugin disable, Emergency Stop, browser close, and application shutdown. Fixed Main-owned checks move CAPTCHA, authentication, two-factor, password-manager, payment-confirmation, and secure-desktop walls to `waiting-user`; Shio does not attempt to bypass them.

Page content and visual evidence are untrusted. They cannot grant Action authority, invoke shell or filesystem capabilities, change Plugins or Memory, disclose credentials, or override Character/System instructions. Browser diagnostics expose only bounded readiness and session state, never screenshots, DOM/accessibility dumps, coordinates, Action IDs, tab authorization scopes, or credentials.

Browser Computer Use emits bounded lifecycle and notable-observation events through Experience, Behavior, and Conversation Admission. The active session may request a scoped screen-gaze presentation lease; user listening and conversation remain authoritative, and terminal or waiting states release only the matching lease.

DSH remains the replaceable Desktop Control shell Adapter. It has no browser context, page, observation, screenshot, mouse, keyboard, planning, or input ownership.
