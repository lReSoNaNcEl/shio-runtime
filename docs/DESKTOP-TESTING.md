# Desktop test infrastructure

Desktop verification uses one deterministic TypeScript runner plus explicit standalone
runners for checks that require a real application, browser, provider, or extended runtime.
The split prevents environment-dependent qualification from being mistaken for ordinary
regression coverage.

## Permanent deterministic tests

Vitest owns files below `apps/desktop/tests`:

- `unit` — one owner or policy in isolation;
- `integration` — cooperation between bounded runtime owners;
- `renderer` — rendered behavior, accessibility, and user interaction;
- `contracts` — stable typed and protocol behavior;
- `architecture` — AST/import ownership and security boundaries;
- `support` — shared clocks, deferred promises, event collectors, temporary resources,
  and domain fixtures.

Test names describe the owning domain and observable behavior. Historical Epic labels,
`hardening`, and numeric suffixes are not permanent taxonomy.

Run the stable command surface from the repository root:

```text
npm run desktop:test
npm run desktop:test:fast
npm run desktop:test:regression
npm run desktop:test:architecture
```

Use a Vitest path or name filter instead of adding a package script for every domain:

```text
npm --prefix apps/desktop run test -- memory
npm --prefix apps/desktop run test -- speech
```

`desktop:test:fast` covers unit, contract, and architecture tests. The complete
credential-free deterministic suite is `desktop:test:regression`; it is a single Vitest
run. Browser Control's local fixture uses the Shio-managed Chrome context and belongs to
this regression tier. The public-site Browser qualification remains opt-in.

## Qualifications and benchmarks

Standalone runners remain appropriate when a check needs real Electron, real Chrome,
a public site, live LLM or speech infrastructure, a long soak, or performance measurement.
Their stable root commands use the `desktop:qualify:*` or `desktop:benchmark:*` prefixes.
They do not run as part of deterministic regression.

## Temporary reproducers

New reproducers belong below `apps/desktop/repro/issue-<id>` and require a README stating
the issue, root cause, owner, expected failure, creation date, and migration target. After
the fix, move the durable regression case into the owner's deterministic suite and remove
the temporary reproducer.

The former permanent `apps/desktop/scripts/*-repro` suites have been migrated into Vitest.
Continuous Listening is the sole temporary exception: its feature is not ready, its legacy
harness stays outside `test:regression`, and it must not be migrated or treated as current
coverage until the feature work resumes.

## CI tiers

| Tier | Purpose | Contents |
| --- | --- | --- |
| Fast | Every change | Unit, contracts, architecture |
| Regression | Before merge | All deterministic integration and renderer tests |
| E2E | Merge candidate | Electron smoke |
| Qualification | Relevant opt-in changes | Real Chrome, speech service, public-site checks |
| Soak | Nightly or major runtime changes | Extended lifecycle and leak checks |
| Live | Manual | Real providers and credentials |
| Benchmark | Manual or nightly | Latency and performance |

Browser Control shares scenario helpers between a deterministic local-fixture Vitest suite
and the opt-in public-site qualification. The qualification is never discovered by Vitest.
Continuous Browser Control adds a dynamic local Canvas fixture to the deterministic regression
tier and a separate real-Chrome qualification/soak command:

```text
npm run desktop:qualify:continuous-browser
```

The qualification reports frame backpressure, tracking/input latency, re-anchor/plan counts,
held-input cleanup, Worker memory, and process-memory samples. Set
`SHIO_CONTINUOUS_BROWSER_SOAK_MS` to shorten a local diagnostic run; the release qualification
default remains 30 minutes.
