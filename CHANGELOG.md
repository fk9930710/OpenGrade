# OpenGrade Development Log

This file is a handoff log for future contributors. Keep entries concise and
focused on what changed, why it changed, which files moved, and how the change
was verified.

## 2026-07-18 — README Agent Integration Guide

### Goal

Make the public README explain how a real AI agent should connect to OpenGrade,
not just what the Agent Bridge JSON looks like.

### Changes

- Added `How To Connect A Real AI Agent` to `README.md`.
- Documented the current local file-based bridge:
  - agent writes `.opengrade-agent.json`
  - Tauri app polls it
  - Assistant panel validates new batch ids
  - commands dispatch into the shared state reducer
- Listed the source files involved in the bridge:
  - `src/editors/Editors.tsx`
  - `src/core/commandProtocol.ts`
  - `src/types.ts`
  - `src/core/mockClient.ts`
  - `src/core/coreBackend.ts`
- Added an agent workflow:
  - inspect image/reference
  - compute color/luma stats
  - plan the grade
  - write a new command batch
  - log reasoning with `assistant.apply`
  - inspect and revise
- Added a minimal agent output contract and clarified stable
  `operationId`/`layerId` usage.
- Explained how Codex can connect today through the local project folder.
- Explained future Web transport options:
  - paste/upload JSON
  - local WebSocket bridge
  - cloud session bridge

### Files Changed

- `README.md`
- `CHANGELOG.md`

### Verification

- Not run; documentation only.

## 2026-07-18 — GitHub README And Ignore Cleanup

### Goal

Prepare the project for a GitHub push with a clearer public-facing README and
safer ignore rules for generated build artifacts.

### Changes

- Rewrote `README.md` as a polished project overview:
  - explains the AI-first grading concept
  - lists current image grading, mask, scope, LUT, export, and Agent Bridge
    capabilities
  - documents local run/build commands
  - summarizes project structure
  - calls out current limitations
  - explains why large generated folders should stay out of Git
- Updated `.gitignore` so Rust/Tauri build cache and TypeScript build info do
  not get committed:
  - `src-tauri/target/`
  - `*.tsbuildinfo`
- Added public-repo safety ignores for local/private or potentially unsuitable
  files:
  - `.claude/`
  - `.opengrade-agent.json`
  - `test-assets/`
- Clarified in `README.md` that `test-assets/` is a local ignored folder.

### Files Changed

- `README.md`
- `.gitignore`
- `CHANGELOG.md`

### Verification

- Not run; documentation and ignore-rule update only.

## 2026-07-15 — Pen Mask And Mask Delete

### Goal

Move masking closer to a real grading/compositing workflow by adding the first
pen-style mask shape and making mask layers removable.

### Changes

- Added a new `polygon` mask shape, shown as `Pen` in the Mask panel.
- Added `points` to `MaskLayer` for normalized polygon vertices.
- Added `layer.deleteMask`.
- Deleting a mask now removes that layer and also clears references to it from
  operation mask applicators so stale links do not remain in the stack.
- Added a Pen button in the Mask panel.
- Added polygon point editing in the Mask panel:
  - add point
  - delete point, keeping at least 3 points
  - direct numeric X/Y editing
- Added viewer-side polygon visualization:
  - closed polygon fill/outline
  - draggable vertex handles
  - draggable center handle to move the whole polygon
- Added Rust-side polygon rasterization for real preview/export masking:
  point-in-polygon fill with inner feather falloff.
- Updated `AGENTS.md` with polygon mask command examples and the new
  `layer.deleteMask` command.

### Files Changed

- `src/types.ts`
- `src/core/mockClient.ts`
- `src/editors/Editors.tsx`
- `src/styles.css`
- `src-tauri/src/lib.rs`
- `AGENTS.md`
- `CHANGELOG.md`

### Verification

- `npm run check`
- `cargo check`
- `cargo fmt`
- `npm run build`

## 2026-07-15 — Green Room Grade V6: Contrast And Painting Mask Fix

### Goal

Fix a regression the user caught in the V1-V5 green-room-to-Wes-Anderson
grade: the result read as washed-out/hazy with low contrast, the Hopper-style
painting on the wall lost its color, and the dress orange was not vivid
enough. The user's core critique: I was judging the grade from whole-image
mean statistics instead of breaking it down region by region.

### Root causes (found by per-region comparison, not averages)

- `BasicAdjustments` (`Shadows: +10, Blacks: +6`) stacked with a
  shadow-lifting `Curve` control point were compounding. Luma p1 (near-black
  point) went from 18 in the source to 47 in the graded result, while the
  reference actually has real blacks (p1=0). This was the main cause of the
  washed-out look.
- The wall `HueRange` chain's per-pass `Value: +3` and its wide `Range`/
  `Feather` were bleeding into the Hopper painting embedded in the wall
  (a framed picture, not a real window), pushing its sand region to
  val=0.96 (nearly blown white) and stripping its blue/teal.
- The warm dress/bench/chair cluster's `HueRange` used a saturation
  *reduction*, which was backwards -- the reference's warm swatches
  (0.82-0.98 saturation) are more saturated than the source dress
  (0.69-0.85), not less.

### Changes

- `BasicAdjustments` and `Curve` now add contrast (a real S-curve, shadows
  down / highlights up) instead of flattening.
- Added a rectangle mask (`Hopper Painting Area`) around the painting's
  actual bounding box and used the new stable-ID mask workflow to
  `subtract` it from all three wall-desaturation `HueRange` passes, plus a
  dedicated `add`-masked pass that gives the painting its own small,
  independent blue/teal enrichment so it keeps density instead of washing
  out.
- Note: the painting's frame has a slight perspective tilt in the source
  photo, so an axis-aligned rectangle mask can't match it exactly. The mask
  boundary was pulled in ~2.5% past the tightest measured edge to clear the
  tilt; this trades a thin sliver of the painting getting the wall
  treatment instead of a wrong-color triangular wedge appearing at the
  frame corner (verified by cropping and zooming into the boundary in a
  simulated render before and after the fix).
- Warm cluster `HueRange` saturation changed from a reduction to `+22`.
- Updated `.opengrade-agent.json` to batch id
  `green-room-to-wes-anderson-20260715-0006`.

### Verification

- Reproduced the exact Rust `apply_operation` math (including rectangle
  mask alpha) in a standalone Python simulation and rendered the full
  source image through the corrected pipeline. Luma p1 back to ~15 (source
  18, reference 0) instead of 47; luma stdev rose from 57.2 (source) to
  67.0 (more contrast, not less); dress saturation reached ~1.0 (reference
  dress 0.82-0.98); painting sky/sand kept density instead of blowing out.
- Not run through `npx tauri dev` end-to-end (no accessibility/screen
  recording permission available in this session to inspect the live
  Scopes panel). User should verify via Waveform (real black floor, not
  lifted haze), RGB Parade (painting region shows real channel separation),
  and Vectorscope (dress vector long/saturated, not pulled toward center).

## 2026-07-15 — Agent Bridge Stable Mask Linking

### Goal

Remove the agent bridge limitation that prevented a single command batch from
creating a new mask layer and attaching it to a newly created operation.

### Changes

- Extended `operation.add` commands with:
  - `operationId`
  - initial `masks`
- Extended `layer.addMask` commands with `layerId`.
- Updated the mock client reducer so agent-supplied IDs are used instead of
  always generating random internal IDs.
- Made `operation.add` and `layer.addMask` idempotent for explicit IDs:
  reusing the same ID replaces the existing operation/layer instead of adding
  duplicates.
- Updated the agent bridge example to create a mask and immediately attach it
  to a WhiteBalance operation in the same batch.
- Updated the current `.opengrade-agent.json` green-room batch to use
  `layerId: "mask-dress-subject"` and attach that mask to
  `operationId: "op-dress-hero-pop"` in the same batch.
- Updated `AGENTS.md` with the recommended stable-ID workflow for agent
  batches.
- Updated the command preset helper so future agent presets can emit stable
  operation IDs, LUT paths, and mask applicators from the same helper.

### Files Changed

- `src/types.ts`
- `src/core/mockClient.ts`
- `src/core/commandProtocol.ts`
- `.opengrade-agent.json`
- `.opengrade-agent.example.json`
- `AGENTS.md`
- `CHANGELOG.md`

### Verification

- JSON parse check for `.opengrade-agent.json` and
  `.opengrade-agent.example.json`
- `npm run check`
- `npm run build`

## 2026-07-15 — Green Room Wes Anderson Style Transfer

### Goal

Style/look transfer: grade `test-assets/green-room-source.jpg` (a yellow-green
cast interior scene) to match the pastel orange/teal palette of
`test-assets/wes-anderson-reference.png`.

### Analysis

Computed RGB/luma/saturation/hue stats for both images (mean RGB, luma
percentiles, mean saturation, 12-bucket hue histogram), then grid-sampled the
source to locate the wall cluster (hue ~76-90deg, sat 0.4-0.5) and the warm
subject cluster (dress/bench/chair, hue 0-25deg, sat 0.7-0.9).

### Key finding: HueRange selection strength is capped by pixel saturation

A first single-pass HueRange on the walls (Hue +72) barely moved the hue from
87deg to 114deg instead of the intended ~160deg teal. Root cause: in
`apply_operation`'s HueRange branch (`src-tauri/src/lib.rs`), the per-pixel
blend factor is `blend * mask_alpha * hue_range_weight * saturation`, and the
result is a linear RGB blend between the original color and the fully
hue-shifted target — not a hue rotation. With wall saturation ~0.45, only
~45% of the RGB distance to the target hue is covered, and because RGB-space
blending between distant hues desaturates/muddies rather than rotating
linearly, large single-step hue shifts plateau well short of the target.

Fix: a 4-pass chain — (1) boost saturation only, no hue change, to raise the
pixel's own saturation so later passes have more leverage; (2)-(4) three
chained hue-shift passes that recenter progressively (88 -> 130 -> 170deg),
each acting on the already-shifted output of the previous pass. Verified in a
Python simulation of the exact Rust math that this moves the wall cluster
from ~87deg to ~150-160deg (teal) while leaving wood trim, floor base, and
the dress essentially untouched (side-effect check on 5 representative
sampled pixels).

### Changes

- Updated `.opengrade-agent.json` with a new batch:
  - opens `test-assets/green-room-source.jpg`
  - base correction: Exposure +0.12, WhiteBalance (mild warm nudge),
    BasicAdjustments (matte tone, lifted shadows/blacks)
  - 4-pass HueRange wall chain (green/olive -> sage/teal)
  - HueRange on the warm cluster (red -> orange, matching reference)
  - narrow high-saturation-weighted HueRange as a soft hue/sat mask for the
    dress ("hero pop")
  - mild matte Curve trim
  - a prepared ellipse mask layer over the dress region for optional manual
    refinement (see Known Gaps below)
  - assistant.apply logs documenting analysis, the HueRange dilution finding,
    and a known floor-rug oversaturation caveat

### Known Gaps

- Resolved by `2026-07-15 — Agent Bridge Stable Mask Linking`: the
  agent-bridge protocol (`.opengrade-agent.json`) can now attach a
  freshly created mask layer to a freshly created operation within a single
  batch by using explicit `layerId`, `operationId`, and `operation.add.masks`.
- A small yellow-green floor rug patch near the suitcase still reads more
  saturated/neon-green than the rest of the pastel palette after the wall
  chain's saturation boost. Tuning pass 1's saturation gain down (150 -> 90)
  softened but did not fully fix this. Flagged in the final assistant log
  with a suggested manual mask fix.

### Verification

- Not run through `npx tauri dev` end-to-end by this session (no
  accessibility/screen-recording permission available to inspect the live
  Scopes panel). Instead verified by reproducing the exact Rust
  `apply_operation` math (Exposure, WhiteBalance, BasicAdjustments, HueRange,
  Curve) in a standalone Python simulation and rendering the full source
  image through it. Before/after/reference stats:
  - Yellow hue-bucket share: 46.3% -> 6.2% (reference has 5.7%)
  - Teal+Cyan hue-bucket share: 8.0% -> ~22% (reference has 28.4%)
  - Mean saturation: 0.499 -> ~0.42 (reference 0.340)
  - Mean RGB: (108,107,66) -> ~(111,131,91) (reference (136,124,109); R gap
    is expected since this scene's dominant background is a wall, not sky)
  - Visually inspected the simulated output image: teal walls, warm wood
    trim preserved as contrast, dress reads as rust-orange matching the
    reference swatch.
  - The user should re-verify inside the running app via Waveform, RGB
    Parade, and Hue Histogram once the agent inbox applies the batch, per
    the standard workflow.

## 2026-07-15 — Extract Scopes Editor

### Goal

Reduce the size and responsibility of `Editors.tsx` by moving the professional
scope monitor implementation into its own editor module.

### Changes

- Added `src/editors/ScopesEditor.tsx`.
- Moved scope UI and analysis logic out of `Editors.tsx`, including:
  - Waveform
  - RGB Parade
  - Vectorscope
  - Histogram
  - Hue Histogram
  - Scope statistics and image sampling helpers
- Kept the public editor registry entry unchanged, so existing layout and app
  imports still use `EditorContent` from `src/editors/Editors.tsx`.
- Reduced `Editors.tsx` from 1794 lines to 1391 lines as a first pass toward
  splitting the large editor file.

### Files Changed

- `src/editors/Editors.tsx`
- `src/editors/ScopesEditor.tsx`
- `CHANGELOG.md`

### Verification

- `npm run check`
- `npm run build`

## 2026-07-15 — Agent Handoff Guide

### Goal

Add a single first-read document for incoming AI agents and contributors so
they do not need to rediscover the project architecture, command bridge, test
assets, and grading workflow by scanning the whole repository.

### Changes

- Added `AGENTS.md` at the project root.
- Documented:
  - product intent
  - first files to read
  - frontend/backend architecture
  - local Agent Bridge
  - `.opengrade-agent.json` command batch format
  - project save/load format
  - test asset locations
  - current operations
  - masks
  - scopes
  - recommended grading workflow for agents
  - verification commands
  - known product gaps
  - handoff rules

### Files Changed

- `AGENTS.md`
- `CHANGELOG.md`

### Verification

- Not run; documentation only.

## 2026-07-14 — Parasite Wes Anderson Grade V2

### Goal

Retune the Wes Anderson-inspired Parasite grade after the first pass appeared
too white, hazy, and washed out.

### Changes

- Updated `.opengrade-agent.json` to Wes Anderson V2.
- Reduced the causes of haze:
  - exposure changed from a small lift to a slight pull
  - shadow lift reduced
  - black lift removed
  - global value boost removed
  - matte curve black floor lowered substantially
- Preserved the intended style:
  - restrained cream warmth
  - softened contrast
  - muted greens with HueRange
  - softened cyan/teal with HueRange
  - subtle peach/cream warm range
  - lower global saturation
- Assistant log now explains why V1 looked washed out and what V2 changes.

### Files Changed

- `.opengrade-agent.json`
- `CHANGELOG.md`

### Verification

- Not run; agent batch JSON only.

## 2026-07-14 — Parasite Wes Anderson Agent Grade

### Goal

Try a different reference style for `parasite-source.jpg`: a Wes
Anderson-inspired pastel grade with lower contrast and softer color separation.

### Changes

- Updated `.opengrade-agent.json` with a new Wes Anderson pastel batch.
- The batch:
  - opens `parasite-source.jpg`
  - clears the existing operation stack
  - logs the target look analysis
  - applies subtle exposure and warm/tint correction
  - flattens contrast and lifts shadows
  - uses a matte curve
  - uses HueRange to soften greens into yellow/olive pastels
  - uses HueRange to soften cyan/teal glass and shadows
  - uses HueRange to gently enrich warm cream/peach tones
  - applies global pastel desaturation
- Assistant log now instructs checking Waveform, RGB Parade, and Hue scopes
  after the grade is applied.

### Files Changed

- `.opengrade-agent.json`
- `CHANGELOG.md`

### Verification

- Not run; agent batch JSON only.

## 2026-07-14 — Professional Scope Monitor Upgrade

### Goal

Replace the lightweight scope mockups with more useful grading monitors that
can expose overexposure, RGB imbalance, hue concentration, and saturation
problems during agent-driven grading.

### Changes

- Added scope tabs:
  - `Waveform`
  - `RGB Parade`
  - `Vectorscope`
  - `Histogram`
  - `Hue`
- Added luma waveform samples across image width.
- Added RGB parade samples split into red, green, and blue panels.
- Added hue histogram with spectrum background and R/Y/G/C/B/M/R labels.
- Kept histogram and vectorscope but restyled them as monitor panels.
- Added bottom scope stats:
  - mean luma
  - mean RGB
  - min/max luma
  - shadow clipping percentage
  - highlight clipping percentage
- Expanded scope analysis data to compute waveform, parade, hue histogram, and
  numeric image stats from the processed preview.

### Files Changed

- `src/editors/Editors.tsx`
- `src/styles.css`
- `CHANGELOG.md`

### Verification

- `npm run check`
- `npm run build`

## 2026-07-14 — Hue Range Spectrum Control

### Goal

Make HueRange selection visible and directly adjustable instead of requiring
users to imagine `Center`, `Range`, and `Feather` from numeric sliders.

### Changes

- Added a HueRange spectrum control above HueRange numeric parameters.
- The spectrum shows:
  - full 0-360 hue gradient
  - selected core hue range
  - feathered falloff range
  - draggable center marker
  - draggable range edge markers
  - R/Y/G/C/B/M/R hue labels
- Dragging the spectrum updates `Center`.
- Dragging range handles updates `Range`.
- Numeric controls remain available for precise values.

### Files Changed

- `src/editors/Editors.tsx`
- `src/styles.css`
- `CHANGELOG.md`

### Verification

- `npm run check`
- `npm run build`

## 2026-07-14 — Real Cube LUT Support

### Goal

Make the `LUT` operation functional so look application can be separated from
base correction and secondary color cleanup.

### Changes

- Added `lutPath` to operations.
- Added `operation.setLutPath` command.
- Added a `Load .cube LUT` control inside LUT operation cards.
- Added a Tauri file dialog for selecting `.cube` LUT files.
- Project save/load now preserves operation `lutPath`.
- Rust render now supports 3D `.cube` LUT files:
  - `LUT_3D_SIZE`
  - `DOMAIN_MIN`
  - `DOMAIN_MAX`
  - trilinear interpolation
  - `Intensity`
  - operation `Blend`
  - mask applicators
- Agent command helpers can carry `lutPath` on `operation.add`.

### Files Changed

- `src/types.ts`
- `src/core/mockClient.ts`
- `src/core/coreBackend.ts`
- `src/core/commandProtocol.ts`
- `src/editors/Editors.tsx`
- `src/styles.css`
- `src-tauri/src/lib.rs`
- `CHANGELOG.md`

### Verification

- `npm run check`
- `cargo check`
- `npm run build`

## 2026-07-14 — Parasite Agent Grade V5

### Goal

Retune the Parasite-to-Mad-Max agent batch after V3 was too red and V4 still
needed a more restrained, reviewable grade.

### Changes

- Updated `.opengrade-agent.json` to V5.
- Removed exposure lift entirely.
- Reduced global white-balance push.
- Softened green and cyan HueRange corrections:
  - less hue rotation
  - less saturation reduction
  - lower blend
  - wider feather
- Added a subtle yellow/orange HueRange boost for warmth instead of a global
  red shift.
- Strengthened highlight/white protection to reduce clipping.
- Softened the curve and capped the top end further.
- Added Assistant log notes explaining why the pass avoids global color pushes.

### Files Changed

- `.opengrade-agent.json`
- `CHANGELOG.md`

### Verification

- Not run; agent batch JSON only.

## 2026-07-14 — Hue Range Secondary HSV

### Goal

Fix the overly global color-correction problem exposed by the Parasite to Mad
Max test, where ChannelBalance removed green but pushed the whole image red.

### Changes

- Added `HueRange` as a real operation type.
- Added Effect Library entry under `COLOR`.
- Added default controls:
  - `Center`
  - `Range`
  - `Feather`
  - `Hue`
  - `Saturation`
  - `Value`
  - `Blend`
- Added Rust rendering for hue-range secondary correction:
  - selects pixels by circular hue distance
  - supports range and feather falloff
  - scales selection by saturation so neutral colors are less affected
  - supports masks and operation blend
- Updated `.opengrade-agent.json` to V4:
  - removed global red-heavy ChannelBalance from the agent grade
  - added one HueRange for green foliage/grass
  - added one HueRange for cyan glass/shadows
  - kept only subtle global white balance and HSV changes

### Files Changed

- `.opengrade-agent.json`
- `src/types.ts`
- `src/core/mockClient.ts`
- `src/editors/Editors.tsx`
- `src-tauri/src/lib.rs`
- `CHANGELOG.md`

### Verification

- `npm run check`
- `cargo check`
- `npm run build`

## 2026-07-14 — Parasite Grade V3 And Channel Balance

### Goal

Correct the first Parasite-to-Mad-Max agent grade after visual review showed it
was still too green and badly overexposed.

### Changes

- Added image-stat analysis for the Mad Max reference and Parasite source:
  - `test-assets/color-transfer/analysis/color-stats.json`
- Added `ChannelBalance` as a real operation type.
- Added ChannelBalance defaults and Effect Library entry.
- Added Rust rendering for ChannelBalance:
  - `Red`
  - `Green`
  - `Blue`
  - `Blend`
  - mask-aware like other operations
- Updated `.opengrade-agent.json` to V3:
  - exposure reduced from the original aggressive lift
  - highlights and whites protected
  - direct red/green/blue channel correction added
  - global saturation/value reduced to keep grass/glass from glowing green
  - curve top end capped more aggressively
- Assistant log steps now mention the measured RGB/luma issue and why V1 failed.

### Files Changed

- `.opengrade-agent.json`
- `test-assets/color-transfer/analysis/color-stats.json`
- `src/types.ts`
- `src/core/mockClient.ts`
- `src/editors/Editors.tsx`
- `src-tauri/src/lib.rs`
- `CHANGELOG.md`

### Verification

- `npm run check`
- `cargo check`
- `npm run build`

## 2026-07-14 — Parasite To Mad Max Agent Test

### Goal

Use the local Agent Bridge to drive a real grading test: load `parasite.jpg`
and apply a first-pass grade inspired by the warm desert look of `madmax.jpeg`.

### Changes

- Added a project-local test asset folder:
  - `test-assets/color-transfer/madmax-reference.jpeg`
  - `test-assets/color-transfer/parasite-source.jpg`
- Added an agent-only `media.openPath` command so Agent Bridge batches can load
  a source image without manual import.
- Added `operation.clear` so agent batches can start from a clean operation
  stack.
- Updated the Assistant Agent Bridge executor to handle `media.openPath` before
  applying operation commands.
- Wrote `.opengrade-agent.json` with the Parasite-to-Mad-Max test batch:
  - open Parasite source image
  - clear existing operations
  - log look-analysis steps
  - add Exposure
  - add WhiteBalance
  - add BasicAdjustments
  - add Curve
  - add HSV

### Files Changed

- `.opengrade-agent.json`
- `test-assets/color-transfer/madmax-reference.jpeg`
- `test-assets/color-transfer/parasite-source.jpg`
- `src/types.ts`
- `src/core/commandProtocol.ts`
- `src/core/mockClient.ts`
- `src/editors/Editors.tsx`
- `CHANGELOG.md`

### Verification

- `npm run check`
- `npm run build`

## 2026-07-13 — Reduce Corner Split Hover Interference

### Goal

Stop hover affordances from visually popping up during normal grading
interactions.

### Changes

- Reduced the corner split hot zone from `17px` to `10px`.
- Lowered the corner split control z-index so it does not dominate panel
  interactions.
- Removed the hover scale animation that made the split affordance feel like a
  random preview enlargement.
- Kept the split affordance available while actively dragging a corner split.
- Removed the Effect Library card hover lift so effect cards no longer appear
  to jump or enlarge when hovered.

### Files Changed

- `src/styles.css`
- `CHANGELOG.md`

### Verification

- `npm run check`
- `npm run build`

## 2026-07-13 — Local Agent Command Bridge

### Goal

Let Codex/agent-driven grading apply directly inside the running app so the
user can see the resulting grade instead of manually copying slider values.

### Changes

- Added a local Agent Bridge that reads `.opengrade-agent.json` from the
  project root.
- The Assistant panel now polls the agent inbox while the app is open.
- New command batches are applied automatically when their `id` changes.
- Applied agent batches create real operation stack entries and assistant log
  entries.
- Added an Agent Bridge status row to the Assistant panel.
- Added Rust support for locating the workspace root and reading the agent
  inbox file.
- Added `.opengrade-agent.example.json` as a documented command batch example.
- This is a local file bridge, not an external API connection.

### Files Changed

- `.opengrade-agent.example.json`
- `src/core/coreBackend.ts`
- `src/editors/Editors.tsx`
- `src/styles.css`
- `src-tauri/src/lib.rs`
- `CHANGELOG.md`

### Verification

- `npm run check`
- `cargo check`
- `npm run build`

## 2026-07-13 — Project Save And Load

### Goal

Add a lightweight project file format so grading work can be saved, restored,
and inspected later as part of the AI-agent-first workflow.

### Changes

- Added `.opengrade.json` project save/load support.
- Project files use JSON with:
  - `schemaVersion`
  - `app`
  - `savedAt`
  - `project`
- Saved project state includes:
  - project name
  - media records and source paths
  - selected media id
  - operation stack
  - mask layers
  - assistant/log history
  - revision
- History flags are reset on save/load so loaded files start from a clean
  baseline.
- Added `Save Project` and `Load Project` buttons to the topbar.
- Loading a project restores app state and reloads the selected source image
  into the Tauri image slot when a `sourcePath` is available.
- Added Rust commands for reading and writing project JSON files.

### Files Changed

- `src/types.ts`
- `src/core/mockClient.ts`
- `src/core/coreBackend.ts`
- `src/App.tsx`
- `src-tauri/src/lib.rs`
- `CHANGELOG.md`

### Verification

- `npm run check`
- `cargo check`
- `npm run build`

## 2026-07-13 — Rectangle And Linear Mask Shapes

### Goal

Expand mask layers beyond ellipse so real image grading can target more common
local adjustment regions before reference-image matching work begins.

### Changes

- Expanded mask layer shape types:
  - `ellipse`
  - `rectangle`
  - `linear`
- Added mask creation buttons for Ellipse, Rect, and Linear in the mask layer
  panel.
- Added a shape selector to each mask layer's expanded controls.
- Added an `Angle` control for linear gradient masks.
- Updated viewer mask overlays so rectangle and linear masks have distinct
  visual frames.
- Updated frontend matte/overlay gradients for the new mask shapes.
- Updated Rust mask rendering:
  - ellipse masks keep the previous radial falloff behavior
  - rectangle masks use edge feathering
  - linear masks use directional gradient alpha
  - all mask shapes work with existing add/subtract mask applicators
- Brush masks were intentionally not exposed yet because they require stroke
  storage, pointer drawing, brush hardness/radius controls, and Rust-side
  rasterization rather than the current parametric mask model.

### Files Changed

- `src/types.ts`
- `src/core/mockClient.ts`
- `src/editors/Editors.tsx`
- `src/styles.css`
- `src-tauri/src/lib.rs`
- `CHANGELOG.md`

### Verification

- `npm run check`
- `cargo check`
- `npm run build`

## 2026-07-13 — Presets In Effect Library

### Goal

Move the local grading presets out of startup/demo surfaces and make them
available as user-selectable Effect Library items.

### Changes

- Added a `PRESETS` category to the Effects Library.
- Presets can be expanded/collapsed like other effect groups.
- Presets can be double-clicked or dragged into the Operation Stack.
- The Operation Stack `＋ Add` menu now includes a `PRESETS` category.
- Selecting a preset adds its real operation commands to the stack:
  - `Warm cinematic`
  - `Cool clean`
  - `High contrast B&W`
- Kept startup state clean with no default operations or masks.

### Files Changed

- `src/editors/Editors.tsx`
- `src/styles.css`
- `CHANGELOG.md`

### Verification

- `npm run check`
- `npm run build`

## 2026-07-12 — Clean Startup And Add Effect Menu

### Goal

Start new sessions from a clean grading state and replace the single-purpose
stack add button with a categorized effect picker.

### Changes

- Removed default operations from the initial project state.
- Removed the default mask layer from the initial project state.
- Cleared initial assistant logs.
- Kept imported media behavior unchanged.
- Replaced the Operation Stack `＋ Add` behavior:
  - no longer adds only `Exposure`
  - opens a two-column effect menu
  - left column shows effect groups
  - hovering/focusing a group shows its effects
  - clicking an effect adds it to the stack
- Added an empty state for the Operation Stack.
- Simplified the Assistant panel so it starts with an empty agent log instead
  of local preset/demo content.

### Files Changed

- `src/core/mockClient.ts`
- `src/editors/Editors.tsx`
- `src/styles.css`
- `CHANGELOG.md`

### Verification

- `npm run check`
- `cargo check`
- `npm run build`

## 2026-07-12 — Basic Adjustments Operation

### Goal

Fill out the first set of common photo grading controls beyond exposure and
white balance.

### Changes

- Added `BasicAdjustments` as a new operation type.
- Added default controls:
  - `Contrast`
  - `Highlights`
  - `Shadows`
  - `Whites`
  - `Blacks`
  - `Blend`
- Added `BasicAdjustments` to the Effects Library.
- Added an initial basic-adjustments operation to the default stack.
- Updated local agent presets so they can emit basic contrast and tonal-range
  adjustments.
- Added Rust processing for `BasicAdjustments`:
  - Contrast pivots around midpoint.
  - Highlights and Whites target brighter luminance ranges.
  - Shadows and Blacks target darker luminance ranges.
  - Blend and mask applicators are supported.

### Files Changed

- `src/types.ts`
- `src/core/mockClient.ts`
- `src/core/commandProtocol.ts`
- `src/editors/Editors.tsx`
- `src-tauri/src/lib.rs`
- `CHANGELOG.md`

### Verification

- `npm run check`
- `cargo check`
- `npm run build`

## 2026-07-12 — Real Histogram And Vectorscope

### Goal

Replace the placeholder Scopes editor with useful grading analysis views for
the current preview image.

### Changes

- Replaced the fake waveform bars with real scope analysis.
- Added a Histogram view based on the current processed preview image.
- Histogram displays:
  - luma distribution
  - red channel
  - green channel
  - blue channel
- Added a Vectorscope view based on sampled preview pixels.
- Added vectorscope grid rings and axes.
- Added a skin tone reference line and label.
- Added a sample-count and average hue readout for the vectorscope.
- Scope analysis runs in the frontend from the current image data URL, so it
  updates as the preview updates without changing the Rust render pipeline.

### Files Changed

- `src/editors/Editors.tsx`
- `src/styles.css`
- `CHANGELOG.md`

### Verification

- `npm run check`
- `cargo check`
- `npm run build`

## 2026-07-12 — Undo Redo And Image Export

### Goal

Add the two missing editor fundamentals needed before broader grading work:
command-level undo/redo and full-resolution image export.

### Changes

- Added history state flags to `ProjectState`:
  - `history.canUndo`
  - `history.canRedo`
- Added history commands:
  - `history.undo`
  - `history.redo`
- Added local project history stacks in the current state client.
- Connected topbar Undo and Redo buttons to project history.
- Added keyboard shortcuts:
  - `Cmd/Ctrl+Z` for undo
  - `Cmd/Ctrl+Shift+Z` for redo
  - `Cmd/Ctrl+Y` for redo
- Added `exportImage` in the Tauri backend bridge.
- Added a save dialog for PNG, JPEG, and TIFF export.
- Added Rust `export_grade`, which renders from the original loaded image at
  full resolution instead of saving the 960px preview.
- Shared the Rust render path between preview and export to keep operation
  behavior consistent.
- Added export status text to the bottom status bar.

### Files Changed

- `src/types.ts`
- `src/core/mockClient.ts`
- `src/core/coreBackend.ts`
- `src/App.tsx`
- `src-tauri/src/lib.rs`
- `CHANGELOG.md`

### Verification

- `npm run check`
- `cargo check`
- `npm run build`

## 2026-07-10 — Unified Mask Layer Cards And Media List

### Goal

Make mask layer editing visually consistent with effect operation editing, and
remove unreliable imported thumbnails from the Media Pool.

### Changes

- Removed `thumbnailUrl` from media state.
- Changed Media Pool imported items back to a clean list with numeric indexes
  instead of image thumbnails.
- Rebuilt the Mask editor list using the same `operation-card` structure as
  effect controls:
  - shared header layout
  - shared collapse affordance
  - shared active toggle visual
  - shared expanded controls area
- Removed the separate `Editing`/`Expand` style from mask rows.
- Viewer mask mode now keeps inactive masks as visible outlines only.
- Only the active mask overlay receives pointer events and edit handles, which
  reduces accidental mask selection while editing.

### Files Changed

- `src/types.ts`
- `src/editors/Editors.tsx`
- `src/styles.css`
- `CHANGELOG.md`

### Verification

- `npm run check`
- `cargo check`
- `npm run build`

## 2026-07-10 — Mask And Control UX Cleanup

### Goal

Reduce visual clutter in the mask applicator UI, fix slider dragging being
captured by operation-card dragging, and make mask editing less constrained.

### Changes

- Changed media import state to keep a `thumbnailUrl` for imported images.
- Updated Media Pool thumbnails to show the imported source image instead of
  generated palette blocks.
- Moved operation drag behavior from the whole operation card to the left drag
  handle only, so sliders can be dragged normally.
- Flattened the mask applicator UI:
  - removed nested framed boxes
  - changed each applicator into a compact row group
  - kept inline layer/mode selectors and remove action
- Added Viewer zoom controls for shrinking or enlarging the preview canvas.
- Moved mask overlays into the image canvas instead of the whole viewer stage.
- Mask edit mode now visualizes all mask layers at once.
- The active mask shows resize/feather handles; inactive masks remain visible
  and can be clicked to select.
- Expanded mask coordinate ranges:
  - `X` and `Y` can move from `-1` to `2`
  - `Width` and `Height` can scale up to `3`
- Added numeric mask parameter fields next to sliders.
- Changed mask layer selection so clicking the layer row selects it.
- Replaced the explicit `Editing` button with collapsible mask parameter
  sections.

### Files Changed

- `src/types.ts`
- `src/editors/Editors.tsx`
- `src/styles.css`
- `CHANGELOG.md`

### Verification

- `npm run check`
- `cargo check`
- `npm run build`

## 2026-07-10 — App Icon Optical Balance Refresh

### Goal

Refine the app icon so the two main logo blocks sit comfortably inside the
rounded frame and the background feels closer to a polished Apple-style app
surface.

### Changes

- Reduced the two rotated logo blocks so their visual bounds no longer press
  against the outer rounded frame.
- Moved both blocks inward to create more optical breathing room.
- Added a subtler multi-layer background treatment:
  - diagonal dark surface gradient
  - soft violet radial glow
  - warm lower-corner glow
  - gentle top-to-bottom surface sheen
- Increased the frame stroke slightly and softened its opacity.
- Regenerated Tauri icon assets from `logo.svg` using `npx tauri icon`.
- Synced the root `OpenGrade.icns` from the regenerated macOS icon.

### Files Changed

- `logo.svg`
- `OpenGrade.icns`
- `src-tauri/icons/*`
- `CHANGELOG.md`

### Verification

- `npx tauri icon logo.svg`
- `file logo.svg OpenGrade.icns src-tauri/icons/icon.icns src-tauri/icons/icon.png src-tauri/icons/128x128.png`

## 2026-07-10 — Curve Points And RGB Channels

### Goal

Extend the real curve editor so it behaves more like a grading tool: users can
add and remove curve points, and curves can target Master, Red, Green, or Blue
channels.

### Changes

- Added `operation.replaceValues` so curve point sets can be rewritten cleanly
  when adding/removing/reindexing points.
- Added curve channel tabs:
  - Master
  - Red
  - Green
  - Blue
- Kept Master curve keys backward-compatible as `Point0X`, `Point0Y`, etc.
- Added RGB channel curve keys with prefixes such as `RedPoint0X` and
  `BluePoint1Y`.
- Added click-to-add curve points in the curve graph.
- Added selected-point state in the curve editor.
- Added point deletion for interior points.
- Kept endpoints protected from deletion and locked on the X axis.
- Limited each channel curve to eight points for now.
- Updated the curve editor UI so each channel has a distinct line/point color.
- Updated Rust curve rendering so:
  - Master LUT is applied first.
  - Red/Green/Blue LUTs are applied per channel when present.
  - Blend and mask applicators still apply to the final curve result.

### Files Changed

- `src/types.ts`
- `src/core/mockClient.ts`
- `src/editors/Editors.tsx`
- `src/styles.css`
- `src-tauri/src/lib.rs`
- `CHANGELOG.md`

### Verification

- `npm run check`
- `cargo check`
- `npm run build`

## 2026-07-10 — Real Curve Editor And LUT Rendering

### Goal

Replace the placeholder shadows/highlights `Curve` operation with a real
point-based tone curve that users and agent commands can edit.

### Changes

- Changed default `Curve` values from `Shadows` / `Highlights` to five curve
  control points:
  - `Point0X` / `Point0Y`
  - `Point1X` / `Point1Y`
  - `Point2X` / `Point2Y`
  - `Point3X` / `Point3Y`
  - `Point4X` / `Point4Y`
- Kept `Blend` as the curve operation strength control.
- Updated the initial operation stack to use real curve point values.
- Updated local agent presets so generated `Curve` commands use point values
  instead of placeholder shadows/highlights values.
- Added a draggable SVG curve editor inside the operation controls.
- Fixed endpoint X positions while allowing endpoint Y changes.
- Constrained interior curve points so they cannot cross neighboring points.
- Added a compact curve point readout under the graph.
- Added Rust-side curve point parsing and 256-entry LUT generation.
- Changed Rust `Curve` rendering to apply the LUT to RGB channels with blend
  and mask support.
- Kept the older shadows/highlights branch as a fallback for legacy payloads.

### Files Changed

- `src/core/mockClient.ts`
- `src/core/commandProtocol.ts`
- `src/editors/Editors.tsx`
- `src/styles.css`
- `src-tauri/src/lib.rs`
- `CHANGELOG.md`

### Verification

- `npm run check`
- `cargo check`
- `npm run build`

## 2026-07-10 — Render Queue And Preview Cache

### Goal

Reduce preview stutter without replacing the renderer yet. The app still uses
the Rust CPU/PNG preview path, but render requests should no longer pile up
while a user drags sliders or mask handles.

### Changes

- Added a frontend render queue in `src/core/coreBackend.ts`.
- Limited Tauri preview rendering to one active Rust `apply_grade` call at a
  time.
- Added latest-request-wins behavior for pending preview renders:
  - If a render is already active, only the newest pending request is kept.
  - Older pending requests resolve to `null` and do not update the Viewer.
- Added a small LRU-style preview cache for identical operation/layer payloads.
- Included `previewMaxDimension`, operations, and layers in the render cache
  key.
- Cloned queued render inputs before invoking Tauri so later React state
  changes cannot mutate a queued request.
- Cleared the preview cache whenever a new image is loaded into the backend.

### Files Changed

- `src/core/coreBackend.ts`
- `CHANGELOG.md`

### Verification

- `npm run check`
- `cargo check`
- `npm run build`

## 2026-07-10 — White Balance And Preview Load Reduction

### Goal

Combine temperature and tint into one color-balance operation, and reduce the
worst interactive preview cost while the renderer is still CPU/PNG based.

### Changes

- Replaced the frontend `Temperature` operation type with `WhiteBalance`.
- Added `Tint` next to `Temperature` in the default white-balance values.
- Updated the initial operation stack to use `WhiteBalance`.
- Updated local agent command presets so they emit `WhiteBalance` commands
  instead of old `Temperature` commands.
- Updated the effects library label/type to show `WhiteBalance`.
- Added Rust-side `WhiteBalance` processing:
  - Temperature shifts red/blue balance.
  - Tint shifts green/magenta balance.
  - Blend and mask applicators still apply.
- Kept Rust support for old `Temperature` payloads as a compatibility path.
- Reduced interactive Tauri preview render size from `1600px` to `960px` on
  the longest edge.
- Increased Viewer render debounce from `140ms` to `240ms` to avoid launching
  too many CPU renders while dragging controls.

### Files Changed

- `src/types.ts`
- `src/core/mockClient.ts`
- `src/core/commandProtocol.ts`
- `src/core/coreBackend.ts`
- `src/editors/Editors.tsx`
- `src-tauri/src/lib.rs`
- `CHANGELOG.md`

### Verification

- `npm run check`
- `cargo check`
- `npm run build`

## 2026-07-10 — Multi-Mask Applicators Per Operation

### Goal

Allow one effect operation to use multiple reusable mask layers, so `add` and
`subtract` modes can build a real combined matte instead of replacing one
single mask slot.

### Changes

- Added `masks?: MaskReference[]` to operations as the primary multi-mask
  applicator model.
- Kept the old single `mask` field as a deprecated compatibility path.
- Added operation commands for:
  - `operation.addMask`
  - `operation.updateMask`
  - `operation.removeMask`
- Updated the mock client reducer to copy, add, update, and remove multiple
  mask applicators per operation.
- Updated effect controls so the mask applicator section can contain multiple
  mask rows.
- Changed the applicator `Add` button so it appends another mask instead of
  replacing the existing one.
- Added per-mask remove actions in the operation UI.
- Updated Rust grading so operation masks are combined before applying an
  effect:
  - `add` unions mask alpha into the operation matte
  - `subtract` cuts alpha out of the current matte
  - operations with only `subtract` masks apply outside the subtracted masks
- Kept Rust support for legacy single `mask` payloads.

### Files Changed

- `src/types.ts`
- `src/core/mockClient.ts`
- `src/editors/Editors.tsx`
- `src/styles.css`
- `src-tauri/src/lib.rs`
- `CHANGELOG.md`

### Verification

- `npm run check`
- `cargo check`
- `npm run build`

## 2026-07-10 — Drawable Mask Preview And HSV Controls

### Goal

Turn masks into reusable drawable layers instead of standalone effects, and
make the first real effect controls easier to operate by hand and by agent
commands.

### Changes

- Removed the standalone `Mask` effect from the effect library and initial
  operation stack.
- Replaced separate Hue/Saturation operations with one `HSV` operation.
- Added editable numeric inputs next to operation sliders.
- Added live slider updates through input events so dragging controls previews
  continuously.
- Added active mask layer selection to project state with `layer.select`.
- Added Viewer modes:
  - `IMG` for the graded image
  - `MSK` for drawing/editing the selected ellipse mask
  - `MAT` for black-and-white mask matte preview
- Added draggable ellipse mask overlay controls in the Viewer:
  - Drag inside the ellipse to move the mask
  - Drag the side handle to resize
  - Drag the feather handle to adjust softness
- Updated the Layers / Masks editor so one mask can be marked as the active
  editable layer.
- Added Rust-side `HSV` image processing with hue, saturation, value, blend,
  and existing mask applicator support.
- Kept Rust support for the older `Saturation` operation as a compatibility
  fallback for old operation payloads.

### Files Changed

- `src/types.ts`
- `src/core/mockClient.ts`
- `src/core/commandProtocol.ts`
- `src/editors/Editors.tsx`
- `src/styles.css`
- `src-tauri/src/lib.rs`
- `CHANGELOG.md`

### Verification

- `npm run check`
- `cargo check`
- `npm run build`

## 2026-07-10 — Icon Refresh And Preview Responsiveness

### Goal

Replace the temporary app icon with the OpenGrade UI logo, reduce preview
stutter while adjusting sliders, and make mask controls feel like optional
effect modifiers instead of always-visible default fields.

### Changes

- Added a dark rounded background and subtle glow to `logo.svg` so the app icon
  does not look like floating transparent shapes in the Dock.
- Regenerated Tauri app icons from `logo.svg` using `npx tauri icon`.
- Updated macOS, Windows, and PNG app icon assets.
- Copied the generated macOS icon to the root `OpenGrade.icns`.
- Changed effect controls so mask selection is not shown by default.
- Added a bottom `Add mask applicator` control inside each operation.
- Mask applicator now expands into a styled modifier block with:
  - Layer selector
  - Mode selector
  - Remove action
- Added a short Viewer render debounce so slider changes do not trigger a Rust
  render on every input tick.
- Added a `RENDERING` badge while a preview render is pending/running.
- Added `previewMaxDimension` to the Tauri render command and capped interactive
  previews at 1600px on the longest edge.
- Added Rust-side preview downscaling before CPU operation rendering.
- Measured current development workspace size:
  - Project: about `2.3G`
  - `src-tauri/target`: about `2.3G`
  - `node_modules`: about `57M`
  - `dist`: about `2.9M`

### Files Changed

- `logo.svg` was used as the icon source.
- `OpenGrade.icns`
- `src-tauri/icons/*`
- `src/core/coreBackend.ts`
- `src/editors/Editors.tsx`
- `src/styles.css`
- `src-tauri/src/lib.rs`

### Verification

- `file src-tauri/icons/icon.icns src-tauri/icons/icon.ico src-tauri/icons/icon.png src-tauri/icons/32x32.png src-tauri/icons/128x128.png src-tauri/icons/128x128@2x.png`
- `npm run check`
- `npm run build`
- `cargo check`
- `npx tauri dev`

### Notes For Next Person

The large workspace size is development cache, mostly Rust/Tauri `target`.
It is not representative of final app bundle size. Keep the current CPU preview
path for now, but the long-term fix is still a GPU/wgpu render path.

## 2026-07-09 — Tauri Preview Launch Fix

### Goal

Fix the desktop preview path so `npx tauri dev` can launch the OpenGrade window
for real image import and Rust-backed rendering tests.

### Changes

- Diagnosed the preview failure as a Tauri runtime icon panic, not a frontend
  build failure.
- Converted Tauri PNG icons from 16-bit RGBA to 8-bit RGBA:
  - `32x32.png`
  - `128x128.png`
  - `128x128@2x.png`
- Cleared stale Rust/Tauri build artifacts so generated icon resources were
  rebuilt from the corrected PNG files.
- Confirmed `npx tauri dev` now compiles and runs `target/debug/opengrade`
  without the previous icon panic.

### Files Changed

- `src-tauri/icons/32x32.png`
- `src-tauri/icons/128x128.png`
- `src-tauri/icons/128x128@2x.png`
- `src-tauri/target` was cleaned via `cargo clean`

### Verification

- `file src-tauri/icons/32x32.png src-tauri/icons/128x128.png src-tauri/icons/128x128@2x.png`
- `cargo check`
- `npx tauri dev`

### Notes For Next Person

If Tauri reports `invalid icon` with a pixel-count mismatch, check PNG bit depth
as well as dimensions. Tauri/macOS expects 8-bit RGBA icon buffers at runtime.

## 2026-07-09 — Mask Layers And Mask Applicator

### Goal

Add the first reusable layer-style mask system for image grading. Masks should
live as project layers and be referenced by effect controls, so the model can
later grow into real timeline/adjustment layers.

### Changes

- Added reusable ellipse mask layers to project state.
- Added commands:
  - `layer.addMask`
  - `layer.updateMask`
  - `operation.setMask`
- Added `MaskReference` on operations with modes:
  - `none`
  - `add`
  - `subtract`
- Repurposed the Mask editor into a Layers / Masks panel with sliders for:
  - `X`
  - `Y`
  - `Width`
  - `Height`
  - `Feather`
  - `Opacity`
- Added mask selector and mode selector to every operation control panel.
- Rust `apply_grade` now receives both operations and mask layers.
- Implemented ellipse gradient mask evaluation in Rust:
  - `add` applies an operation inside the mask.
  - `subtract` applies an operation outside the mask.
  - `feather` and `opacity` affect per-pixel operation blend.

### Files Changed

- `src/types.ts`
- `src/core/mockClient.ts`
- `src/core/coreBackend.ts`
- `src/editors/Editors.tsx`
- `src-tauri/src/lib.rs`

### Verification

- `npm run check`
- `npm run build`
- `cargo check`

### Notes For Next Person

This is intentionally geometry-only. Do not add AI segmentation, brush painting,
tracking, or timeline behavior yet. The next useful step is a viewer overlay for
editing mask position/size directly on the image while keeping the same layer
data model.

## 2026-07-09 — Agent Command Protocol

### Goal

Establish the smallest useful command-batch flow for Codex / AI agent driven
image grading. The agent should create editable operations, not directly mutate
pixels or hide work in a chat log.

### Changes

- Added a minimal `CommandBatch` protocol for agent-generated grading actions.
- Added local agent presets in the Assistant panel:
  - `Warm cinematic`
  - `Cool clean`
  - `High contrast B&W`
- Extended `operation.add` so commands can include initial `values`, `source`,
  and `commandText`.
- Added operation provenance with `user`, `agent`, and `system` command sources.
- Operation Stack now marks agent-created operations with `AGENT` and shows the
  original command text.
- Agent command batches write assistant log entries after applying the batch.

### Files Changed

- `src/core/commandProtocol.ts`
- `src/types.ts`
- `src/core/mockClient.ts`
- `src/editors/Editors.tsx`

### Verification

- `npm run check`
- `npm run build`
- `cargo check`

### Notes For Next Person

The next useful step is to let Codex produce or inject these command batches
directly, while keeping the GUI as a visual editor for the resulting Operation
Stack. Do not add external AI API integration yet.

## 2026-07-09 — Operation Stack Rendering

### Goal

Move image rendering toward the headless architecture: GUI controls update the
Operation Stack, then Rust renders the active image from that stack.

### Changes

- Added `renderOperations(operations)` on the TypeScript backend bridge.
- Viewer now re-renders through Rust when the operation stack changes.
- Added Tauri command `apply_grade`, which accepts JSON operations and applies
  enabled operations in order.
- Implemented first CPU-backed image operations in Rust:
  - `Exposure`
  - `Temperature`
  - `Saturation`
  - `Curve`
- Kept unsupported operations as no-ops so the operation model can expand
  without breaking rendering.

### Files Changed

- `src/core/coreBackend.ts`
- `src/editors/Editors.tsx`
- `src-tauri/src/lib.rs`

### Verification

- `npm run check`
- `npm run build`
- `cargo check`

### Notes For Next Person

Rendering is still CPU-backed through the Rust `image` crate. That is acceptable
for the current image-only prototype. OpenColorIO or wgpu should be added only
after the command/render boundary stays stable.

## 2026-07-09 — Real Image Import Into Project State

### Goal

Make imported images part of project/media state instead of showing them only
through a temporary viewer URL.

### Changes

- Added optional `sourcePath` to `MediaItem`.
- Added `media.import` command.
- Imported Tauri images now appear in Media Pool.
- Selecting an imported media item reloads it through the Tauri backend.
- Rust image info now serializes as camelCase to match TypeScript.

### Files Changed

- `src/types.ts`
- `src/core/mockClient.ts`
- `src/core/coreBackend.ts`
- `src/editors/Editors.tsx`
- `src-tauri/src/lib.rs`

### Verification

- `npm run check`
- `npm run build`
- `cargo check`

### Notes For Next Person

Media state is still in the frontend mock client. Long term, this should move
behind the same Core command boundary as operations.

## 2026-07-09 — Debug And Stability Pass

### Goal

Fix the immediate build/debug blockers and prevent obvious local-state crashes.

### Changes

- Cleaned stale Tauri/Rust build cache that referenced an old absolute path.
- Added validation for workspace layout data loaded from `localStorage`.
- Added UI error feedback for image open and processing failures.

### Files Changed

- `src/App.tsx`
- `src/editors/Editors.tsx`
- `src-tauri/target` was cleaned via `cargo clean`

### Verification

- `npm run check`
- `npm run build`
- `cargo check`

### Notes For Next Person

The old `src-tauri/target` cache contained paths from a different checkout. If
similar Tauri build errors mention missing generated permissions under another
absolute path, run `cargo clean` before debugging source code.

## 2026-07-09 — Tauri Desktop Baseline

### Goal

Establish the initial React + TypeScript + Tauri desktop prototype for image
grading.

### Changes

- React interaction prototype with recursive split layouts.
- Workspaces: Grade, Mask, Review.
- Editors: Media Pool, Viewer, Effects Library, Operation Stack, Mask,
  Assistant, Scopes.
- Mock command dispatch via `MockOpenGradeClient`.
- Tauri bridge for opening images and applying initial Rust image operations.
- Basic Rust image commands:
  - `open_image`
  - `apply_exposure`
  - `apply_temperature`

### Files Changed

- `src/App.tsx`
- `src/layout/layoutModel.ts`
- `src/layout/AreaLayout.tsx`
- `src/editors/Editors.tsx`
- `src/core/mockClient.ts`
- `src/core/coreBackend.ts`
- `src/core/imageState.ts`
- `src-tauri/src/lib.rs`
- `src-tauri/tauri.conf.json`

### Verification

- `npm run check`
- `npm run build`
- `cargo check`

### Notes For Next Person

The product direction is headless-first: GUI, Codex, CLI, and future automation
should all operate through command dispatch. For now, stay focused on image
grading and local/open-source foundations. Do not start video, timeline, or
external AI integration yet.
