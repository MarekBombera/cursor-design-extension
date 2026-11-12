# Pins (8f2) - Overview for review

Source of truth: `blueprint/history/features/08f2-pins.md`. This file is the steering summary, not the build spec.

Open in Markdown preview to render the diagrams.

## TL;DR

Every comment now shows a pin on the canvas. The pin sits on its element inside the live frame and
follows scroll, resize, DOM changes, frame drag, zoom and pan. It shows its status and one warning
badge. A click opens a read-only thread. Reply, Resolve and Copy arrive in 8g and 8h.

## System map

```mermaid
flowchart LR
  Disk[(".cursor-design/<br/>comments.json, artboards/id.html")]
  Host["Host<br/>readComments, postPanelComments"]
  Chrome["Chrome<br/>App, pins.ts, Pins, CommentThread"]
  Frame["Frame runtime<br/>installPinAnchors"]
  MCP["MCP<br/>list_comments, get_comment"]
  Disk -->|comments + artboard HTML| Host
  Disk -->|same flag path| MCP
  Host -->|"comments:updated + stale, targetMissing"| Chrome
  Chrome -->|"cd:anchors"| Frame
  Frame -->|"cd:anchor-rects"| Chrome
```

## Key loop

```mermaid
sequenceDiagram
  participant D as Disk (.cursor-design)
  participant H as Host (panelComments)
  participant C as Chrome (App, Pins)
  participant F as Frame runtime (pinAnchors)
  Note over D,H: watcher refresh, comment:create success, panel opened or shown
  H->>D: readComments (comments.json + artboards/id.html)
  Note over H: parse cached by HTML text, css-select within 200 ms, then null flags
  H->>C: comments:updated {comments[ + stale|null, targetMissing|null ], error?}
  C->>F: cd:anchors {anchors[{id, selector}]} (every live frame, [] with no element comments)
  alt from a sender other than the captured parent, or any bad entry
    F->>F: message dropped
  else empty list
    F->>F: observers off, pending measurement cancelled
  else non-empty list
    F->>F: ResizeObserver, MutationObserver, scroll, resize, transitionend, animationend
  end
  F->>C: cd:anchor-rects {anchors[{id, box|null, visible|null}]} (forced once per cd:anchors)
  loop any trigger, one measurement per animation frame
    opt a target moved more than 0.5px, or a null flipped, or the id list changed
      F->>C: cd:anchor-rects {all anchors}
    end
  end
  alt not a registered iframe, or any bad entry
    C->>C: message dropped
  else valid
    C->>C: store under the sender's frame id (any mode), layoutPins from drawn frames + view
  end
  opt frame reload (cd:ready)
    F->>C: cd:ready
    C->>F: cd:mode {current}
    C->>C: drop that frame's anchors, pins fall back to the stored rect
    C->>F: cd:anchors {that frame's list}
  end
```

## Rule logic

```mermaid
flowchart TD
  Start["Comment on a live iframe frame"] --> Hidden{"Target clipped out,<br/>or point outside the frame?"}
  Hidden -->|yes| NoPin["No pin"]
  Hidden -->|no| Resolved{"Resolved?"}
  Resolved -->|yes| Plain["Pin, no badge"]
  Resolved -->|no| Missing{"Live box null,<br/>or targetMissing true?"}
  Missing -->|yes| X["× missing"]
  Missing -->|no| Stale{"stale true?"}
  Stale -->|yes| Bang["! stale"]
  Stale -->|no| Unchecked{"Both flags null?"}
  Unchecked -->|yes| Q["? unchecked"]
  Unchecked -->|no| Plain
```

## What you will see

- A 20px pin on each commented element: **open** is filled, **sent** is a hollow ring, **resolved**
  is dimmed with a ✓ and sits under the others.
- One corner badge: **!** stale, **×** target missing, **?** unchecked. Resolved pins never get one.
- A page comment pins to its fraction of the frame.
- A target scrolled out of its box hides its pin. A target the design removed shows **×** near its
  stored position.
- A pin click opens a popover with the target, status, badge text, body and replies. Escape or Close
  returns focus to the pin. If the comment or pin goes away, it closes and focus moves to the stage.
- While you write a new comment, a click on a pin picks the element under it.

## Architecture decisions

- Flags use the same `commentFlags` as `get_comment`. `null` means unchecked, never guessed.
- Live beats disk: a target the frame cannot find is missing whatever disk said.
- Untrusted ids never become object keys: payloads are arrays, and anchor state is a `Map` per frame.
- The parse is cached by HTML text (32 frames at most). Target checks stop after 200 ms per read and
  report the rest unchecked, with a hint to read again.
- Artboard `<style>` blocks no longer log chrome CSP violations (F-90): `stampArtboardHtml` parses
  into a detached root.

## Out of scope

- Reply, Resolve, Reopen, the comments panel and click to jump (8g). Copy and marking sent (8h).
- Following an element during a CSS animation: pins catch up on transition or animation end.
- Image and web-font load triggers, because `FRAME_CSP` blocks those loads.
- An HTML byte cap, or parsing in a worker.

## Glossary

| Term | Why it exists |
|---|---|
| Anchor | A comment's selector, which the frame resolves to a live element |
| `box` / `visible` | The target's full box, and the part of it you can actually see |
| Stale | The target element changed on disk since the comment |
| Unchecked | The target cannot be checked from disk, or the read ran out of budget |
| Thread | The read-only popover that shows a comment and its replies |

## Your actions

Run the `## Try it now` path in the archive. The independent review could not exercise F5, so these
were not checked there: pins across panel hide/show, a real `update_artboard` flipping a badge to
stale, and the webview console under the real CSP.

## Done means

- `pnpm verify` and `pnpm test:browser` are green.
- Pins, states, badges, page pins and the read-only thread work as described above.
- Carried forward open: F-88 (a thread can be hidden but still open after a `cd:frame-height`
  shrink), F-91 (a twin clamp) and F-92 (an out-of-date `postToFrame` comment).
