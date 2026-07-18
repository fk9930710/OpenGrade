# OpenGrade Agent Guide

This is the first file an incoming AI agent or contributor should read.
It explains how OpenGrade is structured, how the app is operated by an agent,
where important data lives, and what to verify before reporting work as done.

## Product Intent

OpenGrade is a local-first image grading prototype.

The primary user is an AI agent. The agent should be able to:

- inspect a source image and a reference image
- analyze color/luma differences
- apply grading operations to the running app
- leave a traceable operation stack and assistant log
- let the human user inspect, tweak, save, load, and export the result

Do not treat this as a generic photo editor. The important product idea is that
agent actions become visible, editable grading operations.

## Read These First

1. `AGENTS.md`
2. `CHANGELOG.md`
3. `src/types.ts`
4. `src/core/commandProtocol.ts`
5. `src/core/mockClient.ts`
6. `src/core/coreBackend.ts`
7. `src/editors/Editors.tsx`
8. `src-tauri/src/lib.rs`

`CHANGELOG.md` is the handoff log. Update it after every code, behavior, asset,
or agent-batch change.

## Current Architecture

### Frontend

- `src/App.tsx`
  Topbar, workspace layout, save/load/export buttons.

- `src/editors/Editors.tsx`
  All editor panels:
  - Media Pool
  - Viewer
  - Effects Library
  - Operation Stack
  - Layers / Masks
  - Assistant
  - Scopes

- `src/styles.css`
  Global UI styling. Keep controls dense and professional. Avoid hover motion
  that changes layout or makes cards appear to jump.

- `src/types.ts`
  Shared app state and command types. Update this before adding operations or
  command protocol fields.

### State / Commands

- `src/core/mockClient.ts`
  Local state engine and command reducer.

- `src/core/commandProtocol.ts`
  Agent command batch shape and local presets.

### Tauri / Rust

- `src/core/coreBackend.ts`
  Frontend bridge to Tauri commands:
  - open image
  - render preview
  - export image
  - save/load project
  - read agent inbox
  - open LUT dialog

- `src-tauri/src/lib.rs`
  Rust image processing:
  - Exposure
  - BasicAdjustments
  - WhiteBalance
  - ChannelBalance
  - HueRange
  - HSV
  - Curve
  - LUT
  - masks
  - export

## Agent Bridge

The running app polls this file:

```text
.opengrade-agent.json
```

When the `id` changes, the Assistant panel applies the command batch.

Use `.opengrade-agent.example.json` as the minimal schema example.

Typical batch:

```json
{
  "id": "unique-batch-id",
  "title": "Readable Batch Title",
  "description": "What this batch is trying to do.",
  "source": "agent",
  "commands": [
    {
      "type": "media.openPath",
      "path": "/absolute/path/to/image.jpg",
      "name": "image.jpg",
      "palette": "warm",
      "source": "agent"
    },
    {
      "type": "operation.clear",
      "source": "agent",
      "commandText": "agent clear existing stack"
    },
    {
      "type": "operation.add",
      "operationId": "op-base-exposure",
      "operationType": "Exposure",
      "values": { "Exposure": 0, "Blend": 100 },
      "source": "agent",
      "commandText": "agent add exposure"
    },
    {
      "type": "assistant.apply",
      "prompt": "Human-readable reasoning step.",
      "source": "agent"
    }
  ]
}
```

Important:

- Always change the batch `id`; otherwise the running app will not reapply it.
- Use `assistant.apply` commands to explain analysis and decisions.
- Use `operation.clear` before a new grade unless intentionally layering.
- `media.openPath` must use an absolute path.
- Use stable `operationId` / `layerId` values in agent batches when a later
  command needs to target something created earlier in the same batch.
- `operation.add` can include an initial `masks` array, so a batch can create a
  mask layer and immediately attach it to a newly created operation:

```json
{
  "commands": [
    {
      "type": "layer.addMask",
      "layerId": "mask-dress-subject",
      "layer": {
        "name": "Dress Subject",
        "shape": "ellipse",
        "x": 0.52,
        "y": 0.55,
        "width": 0.34,
        "height": 0.46,
        "feather": 0.32,
        "opacity": 1
      },
      "source": "agent"
    },
    {
      "type": "operation.add",
      "operationId": "op-dress-warmth",
      "operationType": "WhiteBalance",
      "values": { "Temperature": 260, "Tint": 5, "Blend": 100 },
      "masks": [{ "layerId": "mask-dress-subject", "mode": "add" }],
      "source": "agent",
      "commandText": "warm only the dress subject mask"
    }
  ]
}
```

- The app must be running for polling to apply the batch.
- If a new Rust operation was added, restart `npx tauri dev`.

## Project Files

Project save/load uses:

```text
.opengrade.json
```

Project files are JSON and include:

- schema version
- media records and source paths
- selected media
- operation stack
- mask layers
- assistant logs
- revision

## Test Assets

Use this folder for local grading experiments:

```text
test-assets/
```

Current color-transfer test assets:

```text
test-assets/color-transfer/madmax-reference.jpeg
test-assets/color-transfer/parasite-source.jpg
test-assets/color-transfer/analysis/color-stats.json
```

Do not leave ad hoc test files scattered in the project root.

## Current Operations

### Exposure

Global exposure in stops.

### BasicAdjustments

Common luma controls:

- Contrast
- Highlights
- Shadows
- Whites
- Blacks
- Blend

### WhiteBalance

Temperature and tint. This is not a full color-management model.

### ChannelBalance

RGB channel offset. Useful for small channel imbalance fixes, but dangerous as
a look-transfer tool because it affects the whole frame.

### HueRange

Secondary HSV correction. Use this for targeted hue ranges:

- Center
- Range
- Feather
- Hue
- Saturation
- Value
- Blend

The UI includes a spectrum control. Prefer this over guessing numeric hue
ranges blindly.

### HSV

Global HSV. Use gently. Global HSV can amplify the wrong colors.

### Curve

Point-based master/R/G/B LUT curve.

### LUT

Loads `.cube` 3D LUT files with trilinear interpolation and Intensity.

Recommended order:

1. Base correction
2. Secondary cleanup with HueRange
3. LUT/look
4. Final trims

Do not use LUTs to fix bad exposure, bad white balance, or uncontrolled green
casts. LUTs usually amplify those problems.

## Masks

Mask layers are reusable and can be attached to operations via mask applicators.
Agent batches should provide explicit `layerId` values for masks that need to
be referenced later in the same batch.

Current mask shapes:

- ellipse
- rectangle
- linear
- polygon (`Pen` in the UI)

Mask commands:

- `layer.addMask`
- `layer.updateMask`
- `layer.deleteMask`

Polygon/Pen masks use normalized `points`:

```json
{
  "type": "layer.addMask",
  "layerId": "mask-subject-pen",
  "layer": {
    "name": "Subject Pen Mask",
    "shape": "polygon",
    "x": 0.5,
    "y": 0.5,
    "feather": 0.05,
    "opacity": 1,
    "points": [
      { "x": 0.42, "y": 0.3 },
      { "x": 0.62, "y": 0.34 },
      { "x": 0.68, "y": 0.62 },
      { "x": 0.48, "y": 0.72 }
    ]
  },
  "source": "agent"
}
```

Brush masks are not complete yet. They should be implemented with stroke data,
brush radius, hardness, erase mode, and Rust-side rasterization rather than
being forced into the current parametric or polygon mask models.

## Scopes / Monitoring

Current Scopes panel includes:

- Waveform
- RGB Parade
- Vectorscope
- Histogram
- Hue Histogram
- numeric stats

Use scopes when grading:

- Waveform: check clipping and luma distribution.
- RGB Parade: check red/green/blue imbalance.
- Vectorscope: check hue/saturation direction.
- Hue Histogram: check whether problematic hue ranges remain dominant.

If an agent changes a grade and does not inspect scope data or image statistics,
call that out as an incomplete pass.

## Color-Grading Workflow For Agents

1. Load or identify source image.
2. Load or identify reference image.
3. Compute or inspect:
   - mean RGB
   - luma percentiles
   - saturation/value averages
   - hue concentration
   - likely clipped shadows/highlights
4. Decide whether this is:
   - base correction
   - style/look transfer
   - targeted secondary cleanup
   - LUT application
5. Write `.opengrade-agent.json`.
6. Let the app apply it.
7. Inspect the result visually and via scopes.
8. Update the batch id for every revision.
9. Update `CHANGELOG.md`.

Do not blindly stack global Exposure/HSV/ChannelBalance to chase a reference.
That caused earlier green/red/washed-out failures.

## Commands To Verify

Frontend/type check:

```bash
npm run check
```

Frontend build:

```bash
npm run build
```

Rust check:

```bash
cd src-tauri
cargo check
```

Run the app:

```bash
npx tauri dev
```

Launching Tauri opens a GUI window and may require desktop approval.

## Known Product Gaps

- No brush mask yet.
- No timeline/video support should be worked on right now.
- No external AI API integration should be added right now.
- Color management is still simplified.
- The agent can operate through `.opengrade-agent.json`, not direct OS-level
  mouse/keyboard control.
- Project save remembers source paths, not embedded media.

## Handoff Rules

- Keep changes scoped.
- Preserve `CHANGELOG.md`.
- Update `CHANGELOG.md` every time behavior, commands, assets, or workflow
  changes.
- Prefer real operations over fake UI.
- If a control is numeric but hard to reason about, add visualization.
- If a grade looks wrong, analyze before retuning.
