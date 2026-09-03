# Dashboard Fix — 2026-09-03

- Fixed the right column: six dashboard panels were defined but only three grid rows existed, pushing lower panels below the viewport. The right column now exposes all six panels with its own scrollbar.
- Added responsive layouts so panels remain reachable on smaller screens.
- The dashboard now consumes the existing read-only `/api/dashboard/intelligence` projection so ML learning/sample and validation accuracy fields can populate.
- Server time now renders from the canonical server timestamp.
- Added a dashboard regression test.
- No live order execution was added or enabled.
