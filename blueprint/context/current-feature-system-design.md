# Canvas export - system design

> Architecture of feature **6e**. Spec SoT: [`current-feature.md`](current-feature.md). Steering one-pager: [`current-feature-overview.md`](current-feature-overview.md).
>
> Open this file in **Markdown preview**. Every diagram is Mermaid.

Two entry points. One disk function. One stale rule. Disk is the only source of truth.

```mermaid
mindmap
  root((6e Canvas export))
    Entry
      MCP export_artboard
      Command Export Handoff
    Shared disk lib
      exportArtboard
      compareCanvasHandoff
      resolveCanvasFrames
    Handoff leaf
      IMPLEMENT.md
      canvas.html
      tokens.json
      group / id / index.html
    Stale
      hash + add + remove
      layout ignored
```

---

## Color key

| Color | Meaning |
|---|---|
| Indigo | Host / command / chrome |
| Violet | MCP process |
| Amber | Disk SoT (read, write, hash) |
| Teal | Pure planners (no fs) |
| Emerald | View-only preview |
| Rose | Fail closed |

---

## 1. Runtime map

Host and MCP are separate processes. Both import `src/disk/`. Chrome never touches disk. `canvas.html` is a file opened in Chrome, not the panel.

```mermaid
flowchart TB
  subgraph Cursor["Cursor"]
    Agent["Cursor Agent"]
    Host["Extension host<br/>dist/extension.js"]
    Chrome["Webview chrome<br/>live stage"]
    Cmd["Export Handoff"]
  end

  subgraph McpBox["MCP process"]
    Tools["export_artboard<br/>handoff_status"]
    Queue["runQueued<br/>one op for whole export"]
  end

  Disk[(".cursor-design/<br/>workspace disk")]
  Preview["canvas.html<br/>opened from disk"]

  Agent -->|"stdio"| Tools
  Tools --> Queue
  Queue --> Disk
  Cmd --> Disk
  Host -->|"watch + snapshot"| Disk
  Host -->|"postMessage"| Chrome
  Host -.->|"registerServer"| Tools
  Disk --> Preview

  classDef host fill:#EEF2FF,stroke:#6366F1,stroke-width:1.5px,color:#312E81
  classDef mcp fill:#F5F3FF,stroke:#7C3AED,stroke-width:1.5px,color:#4C1D95
  classDef disk fill:#FFFBEB,stroke:#D97706,stroke-width:2px,color:#78350F
  classDef preview fill:#ECFDF5,stroke:#059669,stroke-width:1.5px,color:#064E3B
  classDef agent fill:#F8FAFC,stroke:#64748B,stroke-width:1.5px,color:#0F172A
  class Agent agent
  class Host,Chrome,Cmd host
  class Tools,Queue mcp
  class Disk disk
  class Preview preview
  style Cursor fill:#F8FAFC,stroke:#CBD5E1,color:#0F172A
  style McpBox fill:#F5F3FF,stroke:#DDD6FE,color:#4C1D95
```

| Who | Owns in 6e | Must not |
|---|---|---|
| **Host** | Command, watcher, badge | Pick the export set, or a second stale rule |
| **MCP** | Tools, one queued disk op | UI, chrome messages |
| **Disk lib** | Scan, plan, write, compare | `vscode.*`, JSON-RPC |
| **Chrome** | Live stage + badge the host posts | Handoff I/O, MCP |
| **`canvas.html`** | Offline layout preview | Be an implement source |

---

## 2. Module graph

Planning is pure. `exportArtboard` is the only writer of a handoff leaf.

```mermaid
flowchart LR
  subgraph Entry["Entry"]
    Cmd["exportHandoff.ts"]
    Tools["artboardTools.ts"]
    Snap["artboardDisk.ts<br/>badge"]
  end

  subgraph DiskLib["src/disk shared"]
    Fs["artboardFs.ts<br/>exportArtboard"]
    Scan["scan + resolve"]
    Parse["parse.ts zod"]
    Plan["handoff.ts<br/>folders · IMPLEMENT.md · stale"]
    Html["handoffCanvasHtml.ts"]
  end

  subgraph Reuse["string sources"]
    Runtime["artboardCanvasRuntime.ts"]
    Geom["stageGeometry.ts"]
  end

  Cmd --> Fs
  Tools --> Fs
  Snap --> Plan
  Tools --> Plan
  Fs --> Scan
  Fs --> Parse
  Fs --> Plan
  Fs --> Html
  Html --> Runtime
  Html --> Geom

  classDef host fill:#EEF2FF,stroke:#6366F1,stroke-width:1.5px,color:#312E81
  classDef mcp fill:#F5F3FF,stroke:#7C3AED,stroke-width:1.5px,color:#4C1D95
  classDef disk fill:#FFFBEB,stroke:#D97706,stroke-width:1.5px,color:#78350F
  classDef pure fill:#F0FDFA,stroke:#0D9488,stroke-width:1.5px,color:#134E4A
  class Cmd,Snap host
  class Tools mcp
  class Fs,Scan,Parse disk
  class Plan,Html,Runtime,Geom pure
  style Entry fill:#F8FAFC,stroke:#CBD5E1,color:#0F172A
  style DiskLib fill:#FFFBEB,stroke:#FCD34D,color:#78350F
  style Reuse fill:#F0FDFA,stroke:#5EEAD4,color:#134E4A
```

String sources in `src/panel/` stay free of `vscode` and of DOM at module load, so the MCP bundle can import them.

---

## 3. Data model

Height is never stored. Stale never reads `canvas.json`. Manifest version stays **1**; `frames` is additive.

```mermaid
erDiagram
  MANIFEST ||--o| LAST_EXPORT : lastExport
  LAST_EXPORT ||--|{ EXPORTED_FRAME : frames
  CANVAS_JSON ||--|{ FRAME : frames
  ARTBOARD_HTML ||--o| ARTBOARD_META : "same id"
  FRAME ||--|| ARTBOARD_HTML : "id matches file"
  HANDOFF_LEAF ||--|{ FRAME_INDEX : "group/id/index.html"
  HANDOFF_LEAF ||--|| CANVAS_PREVIEW : "canvas.html"
  LAST_EXPORT ||--|| HANDOFF_LEAF : exportId

  MANIFEST {
    int version "always 1"
    string activeArtboardId
    string updatedAt
  }
  LAST_EXPORT {
    string exportId "canvas-ISO"
    string artboardId "legacy"
    string artboardHash "legacy"
    string exportedAt
  }
  EXPORTED_FRAME {
    string artboardId
    string artboardHash "sha256"
  }
  FRAME {
    string id
    string label
    float x
    float y
    int width
    string group "optional"
  }
  ARTBOARD_HTML {
    string id "pixels SoT"
  }
  ARTBOARD_META {
    int generation
    string hash
  }
```

### Workspace tree

```mermaid
flowchart TB
  Root[".cursor-design/"]
  Root --> Manifest["manifest.json<br/>active + lastExport · written last"]
  Root --> Canvas["canvas.json<br/>layout only · not hashed"]
  Root --> Tokens["tokens.json<br/>copied or stub"]
  Root --> Artboards["artboards/"]
  Root --> Handoff["handoff/"]

  Artboards --> HtmlFile["id.html · hashed"]
  Artboards --> MetaFile["id.meta.json · optional"]

  Handoff --> Leaf["canvas-timestamp/"]
  Leaf --> Impl["IMPLEMENT.md"]
  Leaf --> Preview["canvas.html · measuring copies"]
  Leaf --> TokCopy["tokens.json"]
  Leaf --> Group["desktop/hero/index.html"]
  Leaf --> Ungrouped["ungrouped/id/index.html"]

  classDef disk fill:#FFFBEB,stroke:#D97706,stroke-width:1.5px,color:#78350F
  classDef preview fill:#ECFDF5,stroke:#059669,stroke-width:1.5px,color:#064E3B
  classDef html fill:#F0FDFA,stroke:#0D9488,stroke-width:1.5px,color:#134E4A
  class Root,Manifest,Canvas,Tokens,Artboards,Handoff,Leaf,TokCopy,MetaFile disk
  class Preview preview
  class HtmlFile,Impl,Group,Ungrouped html
```

Old handoff leaves are never deleted. Orphan `canvas.json` rows (fixture `t5-mobile`) never reach the tree.

---

## 4. Frame set

Same list `list_artboards` returns. Missing `canvas.json` auto-places every artboard.

```mermaid
flowchart LR
  Scan["Strict HTML scan<br/>artboards/*.html"]
  Layout["Read canvas.json<br/>missing = empty"]
  Resolve["resolveCanvasFrames"]
  Stored["Keep stored rows<br/>whose file exists"]
  Auto["Append auto-placed<br/>files with no row"]
  Drop["Orphans dropped"]
  Out["Export order"]

  Scan --> Resolve
  Layout --> Resolve
  Resolve --> Stored --> Drop --> Auto --> Out

  classDef disk fill:#FFFBEB,stroke:#D97706,stroke-width:1.5px,color:#78350F
  classDef pure fill:#F0FDFA,stroke:#0D9488,stroke-width:1.5px,color:#134E4A
  class Scan,Layout disk
  class Resolve,Stored,Auto,Drop,Out pure
```

Folder names: lowercase slug of `group`; `ungrouped/` when there is no group (empty string counts as none; whitespace-only is a real group). Collisions take the first free `-2`, `-3`. Ids `.` and `..` refuse to export.

---

## 5. Export pipeline

All-or-nothing **reads**, then writes. MCP wraps the whole thing in one `runQueued`. No `artboardId` input.

```mermaid
flowchart TB
  Start(["MCP or command"])
  Read["READ · no writes"]
  Assert["assertLayoutDirsOwned"]
  Strict["strict scan + canvas.json"]
  Zero{"any frames and every read ok?"}
  Fail["Authored error<br/>nothing written"]
  Plan["Build in memory<br/>IMPLEMENT.md · canvas.html<br/>folders · hashes"]
  Mkdir["mkdir leaf · non-recursive"]
  Files["IMPLEMENT.md · canvas.html · tokens.json"]
  Indexes["each group/id/index.html<br/>exact scan string"]
  Meta["stamp meta if missing or hash drift"]
  Man["WRITE manifest.lastExport last"]
  Done(["exportId · handoffPath · frames"])

  Start --> Read --> Assert --> Strict --> Zero
  Zero -->|"no"| Fail
  Zero -->|"yes"| Plan --> Mkdir --> Files --> Indexes --> Meta --> Man --> Done

  classDef host fill:#EEF2FF,stroke:#6366F1,stroke-width:1.5px,color:#312E81
  classDef disk fill:#FFFBEB,stroke:#D97706,stroke-width:1.5px,color:#78350F
  classDef pure fill:#F0FDFA,stroke:#0D9488,stroke-width:1.5px,color:#134E4A
  classDef error fill:#FFF1F2,stroke:#E11D48,stroke-width:1.5px,color:#881337
  classDef ok fill:#ECFDF5,stroke:#059669,stroke-width:1.5px,color:#064E3B
  class Start host
  class Read,Assert,Strict,Mkdir,Files,Indexes,Meta,Man disk
  class Plan pure
  class Zero,Fail error
  class Done ok
```

```mermaid
sequenceDiagram
  autonumber
  actor Entry as MCP / command
  participant Export as exportArtboard
  participant Scan as Strict scan
  participant Plan as Pure planners
  participant FS as Handoff leaf
  participant Man as manifest.json

  Entry ->> Export: workspaceRoot only
  Export ->> Scan: list HTML, resolve frames
  alt any read error
    Scan -->> Entry: authored error · no files
  else
    Scan ->> Plan: html + layout + hashes once
    Plan -->> Export: tree text + lastExport
    Export ->> FS: mkdir, then files, then indexes
    Export ->> Man: lastExport last
    Export -->> Entry: exportId, frames
  end
```

Durability: `lastExport` never points at a leaf whose write failed before the manifest. Mid-tree failure may leave an orphan folder (`ponytail:` no journal). Same-millisecond `mkdir` collision: retry.

---

## 6. Two documents per frame

Pristine lock covers every `index.html`. Only the view-only preview may inject a measuring script.

```mermaid
flowchart TB
  SoT["artboards/id.html<br/>one string, read once"]
  SoT -->|"identity"| Index["handoff/.../id/index.html<br/>byte-equal · implement from this"]
  SoT -->|"buildPreviewFrameHtml"| Copy["preview copy<br/>base + runtime injected"]
  Copy --> Iframe["canvas.html iframe<br/>sandbox=allow-scripts · srcdoc"]
  Runtime["ARTBOARD_CANVAS_RUNTIME_SOURCE"] --> Copy
  Geom["STAGE_GEOMETRY_SOURCE"] --> Parent
  Iframe -->|"cd:frame-height"| Parent["parent script"]
  Iframe -->|"cd:frame-wheel"| Parent
  Parent --> Grow["grow iframe · recompute page<br/>20000 clamp · 100vh freeze"]
  Parent --> Scroll["plain wheel scrolls the page<br/>ctrl / pinch ignored"]

  classDef disk fill:#FFFBEB,stroke:#D97706,stroke-width:1.5px,color:#78350F
  classDef html fill:#F0FDFA,stroke:#0D9488,stroke-width:1.5px,color:#134E4A
  classDef preview fill:#ECFDF5,stroke:#059669,stroke-width:1.5px,color:#064E3B
  class SoT disk
  class Index,Runtime,Geom html
  class Copy,Iframe,Parent,Grow,Scroll preview
```

```mermaid
flowchart TB
  Heading["group heading · 32px<br/>at minX, minY - 56"]
  Label["label · 24px<br/>at x, y - 24"]
  Frame["iframe · width x measured height<br/>at x, y · starts 800"]
  Heading --- Label --- Frame
  Pad["page padding 48px<br/>shift so every box is on-canvas"]
  Frame --- Pad

  classDef preview fill:#ECFDF5,stroke:#059669,stroke-width:1.5px,color:#064E3B
  class Heading,Label,Frame,Pad preview
```

| File | What it is | Audience |
|---|---|---|
| `<group>/<id>/index.html` | Exact disk HTML | Agent implementing |
| `canvas.html` `srcdoc` | Copy + `<base>` + height runtime | Human in Chrome |

`canvas.html` is not the panel: no `--vscode-*`, no pan/zoom, no CSP meta (`srcdoc` inherits parent CSP). Isolation is the iframe sandbox. Parent accepts only allowlisted messages from its own frames' `contentWindow`.

---

## 7. Stale state

One function. Two callers. Same hashes: `hashHtml` of HTML just read, never a stored meta hash. Layout does not count.

```mermaid
stateDiagram-v2
  [*] --> NeverExported
  NeverExported --> Fresh: export succeeds
  Fresh --> Stale: HTML change / add / remove / unreadable
  Stale --> Fresh: re-export
  Fresh --> Fresh: place_frame / relabel / reorder / set_active
  NeverExported --> NeverExported: layout-only change

  note right of NeverExported
    MCP stale = true
    chrome badge = off
  end note
  note right of Fresh
    badge off
  end note
  note right of Stale
    badge on
  end note
```

```mermaid
flowchart LR
  HostScan["Host: canvas view frames"]
  McpScan["MCP: tolerant scan<br/>no canvas.json"]
  Last["lastExport.frames<br/>or legacy one frame"]
  Now["ids + hashHtml"]
  Cmp["compareCanvasHandoff<br/>pair by id"]
  Status["handoff_status.stale"]
  Badge["badge = exported AND stale"]

  HostScan --> Now
  McpScan --> Now
  Last --> Cmp
  Now --> Cmp
  Cmp --> Status
  Cmp --> Badge

  classDef host fill:#EEF2FF,stroke:#6366F1,stroke-width:1.5px,color:#312E81
  classDef mcp fill:#F5F3FF,stroke:#7C3AED,stroke-width:1.5px,color:#4C1D95
  classDef disk fill:#FFFBEB,stroke:#D97706,stroke-width:1.5px,color:#78350F
  classDef pure fill:#F0FDFA,stroke:#0D9488,stroke-width:1.5px,color:#134E4A
  class HostScan,Badge host
  class McpScan,Status mcp
  class Last,Now disk
  class Cmp pure
```

`handoff_status` still requires an active artboard (`activeArtboardId` / `activeHash`). Export itself does not.

---

## 8. Fail closed

Read errors fire before `mkdir`. Authored copy only at the MCP/UI boundary.

```mermaid
flowchart TB
  Err["Failure"]
  Read{"Read phase?"}
  None["Write nothing"]
  Typed{"CursorDesignError?"}
  Agent["MCP isError<br/>+ next step"]
  UI["Command shows<br/>error.message"]
  Log["OutputChannel / MCP stderr"]
  Generic["Generic UI copy"]

  Err --> Read
  Read -->|"yes"| None
  None --> Typed
  Read -->|"write already started"| Typed
  Typed -->|"yes"| Agent
  Typed -->|"yes"| UI
  Typed -->|"no"| Log --> Generic

  classDef error fill:#FFF1F2,stroke:#E11D48,stroke-width:1.5px,color:#881337
  classDef ok fill:#ECFDF5,stroke:#059669,stroke-width:1.5px,color:#064E3B
  classDef disk fill:#FFFBEB,stroke:#D97706,stroke-width:1.5px,color:#78350F
  class Err,Read,Typed error
  class None disk
  class Agent,UI,Log,Generic ok
```

| Code | When |
|---|---|
| `ARTBOARD_NOT_FOUND` | Zero frames (`NoArtboardsToExportError`) |
| `INVALID_ARGS` | MCP passed `artboardId` |
| `CORRUPT_CANVAS` / `CORRUPT_META` | Broken layout or existing meta |
| `DISK_ERROR` | Unreadable HTML, `.` / `..` id, leaf collision |

Labels and groups are Agent text: HTML-escaped in `canvas.html`, newline-collapsed in `IMPLEMENT.md`, never used as paths.

---

## 9. Zod, scoped

```mermaid
flowchart LR
  In["parse.ts only"]
  In --> M[manifest]
  In --> X[lastExport + frames]
  In --> Meta[meta]
  Out["safeParse then authored error<br/>ZodError as cause only"]
  In --> Out

  Skip["Not zod"]
  Skip --> S1["MCP inputSchema"]
  Skip --> S2["chrome script"]
  Skip --> S3["canvas.json"]

  classDef ok fill:#ECFDF5,stroke:#059669,stroke-width:1.5px,color:#064E3B
  classDef skip fill:#F8FAFC,stroke:#94A3B8,stroke-width:1.5px,color:#475569
  class In,M,X,Meta,Out ok
  class Skip,S1,S2,S3 skip
```

A strict zod MCP schema would replace authored `{ code, message }` with the SDK's generic validation text.

---

## 10. Ceilings and non-goals

```mermaid
flowchart LR
  subgraph Ponytail["Marked ponytail in code"]
    C1["canvas.html carries HTML twice · no size cap"]
    C2["scripts off: frames stay 800 tall"]
    C3["assets/ not copied"]
    C4["orphan handoff dirs kept"]
    C5["MCP queue is process-wide"]
  end

  subgraph OutOf["Out of 6e"]
    N1["Edit mode · frame drag"]
    N2["pan/zoom in canvas.html"]
    N3["copy assets · delete old handoffs"]
    N4["6f dogfood"]
  end

  C3 ~~~ N1
  style Ponytail fill:#FFFBEB,stroke:#F59E0B,color:#78350F
  style OutOf fill:#F8FAFC,stroke:#94A3B8,color:#334155
```

Active artboard still exists for the badge, stage highlight, and `set_active_artboard`. It is no longer the export target.
