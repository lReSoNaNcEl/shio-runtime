# Shio Stability & UX Consolidation v1

This stabilization work item hardens existing Browser Computer Use, Continuous Listening, health/status presentation, navigation, diagnostics, and ownership boundaries. It does not add a product capability.

## Ownership preserved

- Browser Control Plugin remains the sole owner of the isolated persistent Chrome context.
- Playwright Browser Adapter remains the browser technology facade; extracted Playwright modules are internal collaborators, not new Runtimes.
- Browser Computer Use Runtime remains the bounded Observe/Decide/Act owner and still enters Action Runtime for authoritative mutation.
- SpeechInputRuntime owns microphone capture and streaming ASR transport.
- ConversationInputCoordinator owns voice-mode intent and Conversation Admission policy.
- Runtime Health remains a read-only technical projection. System Status and Diagnostics consume it; they do not make business decisions.
- Capabilities answers what Shio can do, Plugins owns integration configuration and operational health, and Diagnostics owns technical detail.

## OUT OF SCOPE

No new product features.

No Windows Computer Use.
No native game control.
No Twitch / OBS / Discord.
No new plugins.
No new Memory behavior.
No new Goals behavior.
No new Experience behavior.
No new Avatar behavior.
No new Browser actions.
No new browser provider.
No DSH redesign.
No new Character tools.
No new LLM routing.
No new autonomous initiative types.
