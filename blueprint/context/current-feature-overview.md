# Pin stacking and zero-count copy - Overview for review

Source of truth: `blueprint/history/fixes/pin-stacking-and-zero-copy.md`. This file is the steering summary, not the build spec.

## TL;DR

Two follow-ups from the chrome design system audit:
- **Stacked pins (F-115):** pins whose tips land on the same point now line up side by side instead of covering each other. This also closes F-108.
- **Empty copy (F-116):** a copy that marked nothing sent no longer shows an enabled-looking "Nothing new to send" button.

## What you will see

- **Two or more comments on one element** (or on nested elements that share a corner): the first pin keeps the corner, and the next ones step 30px to the left. Each opens its own thread.
- **Copy-all with nothing new:** the button stays in its disabled look, and only the screen-reader announcement plays.

## Decisions locked

- **Order and spacing:** earlier comments keep the corner. The step is 30 screen px (a pin, its ring and a 2px gap).
- **Placement checks:** clipping and visibility still use the true corner.
- **Exact-pixel match only:** tips a few px apart still overlap. This is noted as `ponytail:` in `layoutPins` (F-117), with the upgrade path.

## Done means

| Check | Result |
|---|---|
| `pnpm verify` | 556 unit tests |
| `pnpm test:browser` | 124 passed, incl. two pins on one element, each opening its own thread |
| `pnpm knip` | clean |
| `/audit current` | F-108, F-115, F-116 closed; F-117 (P3, comment) logged |
