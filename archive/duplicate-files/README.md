# Archived duplicate files (2026-09-03 cleanup)

The files in this folder are exact or near-duplicate copies of files that
already exist elsewhere in the project. Before archiving, each one was
verified to have **zero** cross-references anywhere in the codebase
(no `require`, `import`, or string reference in any `.js`, `.mjs`, `.json`,
or `.yaml` file) — moving them here does not change runtime behavior.

The canonical, actually-deployed entrypoint is:

    trading-bot-v25-marketdata-fixed.mjs   (started via package.json / render.yaml)

## Why this matters

The original "no signals for a while" bug (fixed separately) existed because
a fix had been applied to `trading-bot-v24.6-runtime.mjs` but the actually
deployed file, `trading-bot-v25-marketdata-fixed.mjs`, was never updated to
match. Numbered duplicate files (`(1)`, `(2)`, `(3)`, `(4)`, ...) make this
kind of silent drift much easier to reintroduce, since it's not obvious
which copy is "live" at a glance. Moving orphaned duplicates out of the
project root reduces that risk.

## What's here and why each one is safe to archive

| File | Duplicate of | Notes |
|---|---|---|
| `index (1).js` | `index.js` | Unreferenced upload artifact |
| `trading-bot-v25-marketdata-fixed (2).js` | `trading-bot-v25-marketdata-fixed.mjs` | Older snapshot of the canonical entrypoint |
| `trading-bot-v25-marketdata-fixed.js` | `trading-bot-v25-marketdata-fixed.mjs` | Non-ESM duplicate, not referenced by `package.json`/`render.yaml` |
| `ml-engine (1).js`, `ml-engine (2).js` | `ml-engine.js` | Unreferenced upload artifacts |
| `exchange-adapter (1).js` | `exchange-adapter.js` | Unreferenced upload artifact |
| `config (1).js` | `config.js` | Unreferenced upload artifact |
| `trading-bot-v24.6-runtime (2/3/4).mjs` | `trading-bot-v24.6-runtime.mjs` | Older snapshots; the un-numbered file is still in the project root and is still exercised by several test files (see below) |
| `trading-bot-v22.2.1.js`, `trading-bot-v21.1-tfjs.js`, `trading-bot-v24.6.js` (root copies) | Same filenames already under `archive/legacy-bot-versions/` | `hardening.test.js` reads the `archive/legacy-bot-versions/` copies explicitly, so the root-level copies were redundant |

## NOT archived — needs a deliberate decision, not a silent move

`trading-bot-v24.6-runtime.mjs` and its thin delegator `trading-bot-v25.js`
were deliberately **left in place**, even though neither is what
`package.json`/`render.yaml` actually starts. Reason: roughly a dozen test
files (`consolidation.test.js`, `final-fixes.test.js`,
`step3-reconciliation.test.js`, `telegram-ai-commands.test.js`,
`market-data-root-fix.test.js`, `v24.6-hotfix.test.js`,
`instance-lock-hardening.test.js`, `state-queue-fix.test.js`,
`runtime-integration-step1.test.js`, and their `tests/` duplicates) still
import `trading-bot-v24.6-runtime.mjs` directly. Archiving it would break
the test suite.

**This is itself worth fixing deliberately**: the test suite currently
validates a runtime file that is not the one deployed to production
(`trading-bot-v25-marketdata-fixed.mjs`). That mismatch is exactly the
mechanism that caused the original signal-drought bug, and it can happen
again as long as tests and production point at different files. Recommended
follow-up (not done here, since it changes what the test suite covers):
either point those tests at `trading-bot-v25-marketdata-fixed.mjs` instead,
or make `trading-bot-v25-marketdata-fixed.mjs` re-export from
`trading-bot-v24.6-runtime.mjs` so there is only one implementation to test
and deploy.
