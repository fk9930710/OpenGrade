# OpenGrade

OpenGrade is a local-first image grading prototype built around one unusual
idea: the first user is an AI agent.

Instead of hiding automated edits behind a black box, OpenGrade turns agent
decisions into visible, editable grading operations. A human can ask for a
look, the agent can apply a structured command batch, and every step appears
in the operation stack, mask layers, scopes, and assistant log.

This is currently an interaction prototype for still images. Video, timeline
editing, and external AI API integration are intentionally out of scope for now.

## Why It Exists

Most creative AI tools jump straight from prompt to result. OpenGrade explores
a different workflow:

- the agent analyzes the image and reference
- the agent applies real grading controls
- the user can inspect and revise every operation
- the final grade remains understandable instead of becoming a mystery output

For non-technical audiences, think of it as a color grading desk where an AI
assistant can move the controls for you, but leaves every knob and mask exactly
where you can see it.

## Current Highlights

- Local desktop app built with React, TypeScript, Tauri, and Rust.
- Real still-image preview and export pipeline.
- Agent Bridge via `.opengrade-agent.json`.
- Traceable operation stack with user/agent command metadata.
- Project save/load with `.opengrade.json`.
- Professional-style monitoring tools:
  - Waveform
  - RGB Parade
  - Vectorscope
  - Histogram
  - Hue Histogram
  - numeric image stats
- Core grading operations:
  - Exposure
  - BasicAdjustments
  - WhiteBalance
  - ChannelBalance
  - HueRange
  - HSV
  - point-based Curve
  - `.cube` LUT
- Reusable mask layers:
  - Ellipse
  - Rectangle
  - Linear gradient
  - Pen/Polygon mask
- Multi-mask applicators per operation with `add` and `subtract` modes.
- Undo/redo and image export.

## Product Direction

OpenGrade is not trying to become a generic photo editor first. The product
question is:

> What does a creative tool look like when an AI agent can operate it directly,
> while the user still gets professional, inspectable controls?

The current architecture is built around commands so the GUI, local agent
batches, and future automation surfaces can share the same editing model.

## Screens At A Glance

The main workspace is split into panels:

- Media Pool: imported source images.
- Viewer: graded preview, mask view, and matte view.
- Effects Library: grading operations and presets.
- Operation Stack: editable effects, curves, masks, LUT intensity, blends.
- Layers / Masks: reusable mask layers.
- Assistant: agent command log and prompt-style command entry.
- Scopes: technical monitoring views for judging the grade.

## Agent Bridge

The running app polls this file:

```text
.opengrade-agent.json
```

When the `id` changes, the app applies the command batch and writes a visible
assistant log entry.

Minimal example:

```json
{
  "id": "warm-grade-001",
  "title": "Warm Grade",
  "description": "Add a simple warm base grade.",
  "source": "agent",
  "commands": [
    {
      "type": "operation.clear",
      "source": "agent",
      "commandText": "clear current operation stack"
    },
    {
      "type": "operation.add",
      "operationId": "op-base-warmth",
      "operationType": "WhiteBalance",
      "values": {
        "Temperature": 360,
        "Tint": 4,
        "Blend": 100
      },
      "source": "agent",
      "commandText": "warm the image slightly"
    },
    {
      "type": "assistant.apply",
      "prompt": "Applied a gentle warm white balance as the base look.",
      "source": "agent"
    }
  ]
}
```

Masks can also be created and attached in the same batch by using stable IDs:

```json
{
  "commands": [
    {
      "type": "layer.addMask",
      "layerId": "mask-subject",
      "layer": {
        "name": "Subject Mask",
        "shape": "ellipse",
        "x": 0.5,
        "y": 0.52,
        "width": 0.34,
        "height": 0.46,
        "feather": 0.32,
        "opacity": 1
      },
      "source": "agent"
    },
    {
      "type": "operation.add",
      "operationId": "op-subject-pop",
      "operationType": "HueRange",
      "values": {
        "Center": 20,
        "Range": 28,
        "Feather": 18,
        "Hue": 8,
        "Saturation": 12,
        "Value": 4,
        "Blend": 100
      },
      "masks": [
        {
          "layerId": "mask-subject",
          "mode": "add"
        }
      ],
      "source": "agent",
      "commandText": "add warm color pop inside the subject mask"
    }
  ]
}
```

## How To Connect A Real AI Agent

OpenGrade does not require an AI API key today. The current integration model
is deliberately simple: an external agent writes a command batch, and the app
applies it through the same reducer used by the GUI.

### Current Local Bridge

For the desktop app, the bridge is file-based:

```text
AI agent / script / Codex
    writes .opengrade-agent.json
        ↓
Tauri app polls the file
        ↓
AssistantEditor validates the batch id
        ↓
commands are dispatched into MockOpenGradeClient
        ↓
operation stack, masks, preview, scopes, and assistant log update
```

The important implementation points are:

- `src/editors/Editors.tsx`
  The Assistant panel polls `.opengrade-agent.json` and applies new batches.
- `src/core/commandProtocol.ts`
  Defines `CommandBatch`, `AgentCommand`, and preset helpers.
- `src/types.ts`
  Defines all command/state shapes the agent is allowed to emit.
- `src/core/mockClient.ts`
  Applies commands to project state.
- `src/core/coreBackend.ts`
  Calls Tauri for image open/render/export.

### What The Agent Should Do

A practical agent loop looks like this:

1. Inspect the source image and optional reference image.
2. Compute useful stats:
   - mean RGB
   - luma percentiles
   - saturation/value averages
   - hue concentration
   - clipping risk
3. Decide on a grading plan:
   - base correction
   - secondary HueRange cleanup
   - mask refinement
   - LUT/look
   - final trims
4. Write `.opengrade-agent.json` with a new `id`.
5. Include `assistant.apply` commands explaining the reasoning.
6. Let the running app apply the batch.
7. Inspect the resulting image/scopes and write a revised batch if needed.

The batch `id` must change every time. If it does not change, the running app
will assume it already applied that batch.

### Minimal Agent Output Contract

An agent should output JSON like this:

```json
{
  "id": "unique-revision-id",
  "title": "Readable title",
  "description": "What the agent is trying to do.",
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
      "commandText": "clear before applying a new grade"
    },
    {
      "type": "operation.add",
      "operationId": "op-base-contrast",
      "operationType": "BasicAdjustments",
      "values": {
        "Contrast": 10,
        "Highlights": -8,
        "Shadows": 4,
        "Whites": 2,
        "Blacks": -6,
        "Blend": 100
      },
      "source": "agent",
      "commandText": "add a controlled base contrast pass"
    },
    {
      "type": "assistant.apply",
      "prompt": "I reduced highlights and deepened blacks after checking the luma distribution.",
      "source": "agent"
    }
  ]
}
```

For reliable targeting, agents should use stable IDs:

- `operationId` for operations created by `operation.add`
- `layerId` for masks created by `layer.addMask`
- `masks` on `operation.add` when attaching masks immediately

### Connecting Codex Today

For the current local workflow, Codex can act as the agent by editing:

```text
.opengrade-agent.json
```

The desktop app must already be running:

```bash
npx tauri dev
```

Then the agent writes a new batch with a new `id`. The Assistant panel applies
it automatically and logs the process.

This works without a server because both Codex and the desktop app can access
the same local project folder.

### Connecting Another Agent Or Script

Any local agent can integrate by writing the same JSON file. For example, a
Python or Node process can:

1. read/analyze images
2. generate a `CommandBatch`
3. write `.opengrade-agent.json`
4. increment the `id` on every revision

No OpenGrade-specific SDK is required yet. The JSON command protocol is the
SDK.

### Connecting A Web Version Later

A hosted Web version cannot poll a local `.opengrade-agent.json` file. The same
command protocol can still work, but the transport has to change:

- Paste/upload bridge:
  Let the user paste or upload an agent batch JSON in the browser.
- Local WebSocket bridge:
  Run a small localhost server. The agent sends batches to the server, and the
  browser subscribes to updates.
- Cloud session bridge:
  The agent posts batches to a backend session API, and the browser subscribes
  by session id.

In all three cases, the core idea stays the same: the agent emits structured
commands, and OpenGrade turns those commands into visible, editable operations.

More detailed contributor and agent instructions live in `AGENTS.md`.

## Run Locally

Install dependencies:

```bash
npm install
```

Run the web prototype:

```bash
npm run dev
```

Run the desktop app with Tauri:

```bash
npx tauri dev
```

If a port is occupied, the local dev script can choose another available port:

```bash
npm run dev -- --port 4174
```

## Build And Check

Type-check the frontend:

```bash
npm run check
```

Build the frontend:

```bash
npm run build
```

Check the Rust/Tauri backend:

```bash
cd src-tauri
cargo check
```

## Project Structure

```text
src/
  App.tsx                 App shell, topbar, save/load/export
  editors/                Viewer, stack, masks, assistant, scopes
  core/
    commandProtocol.ts    Agent batch types and presets
    coreBackend.ts        Tauri bridge and render queue
    mockClient.ts         Local state engine and command reducer
  layout/                 Workspace split layout model
  types.ts                Shared state and command types

src-tauri/
  src/lib.rs              Rust image processing, masks, LUTs, export
  tauri.conf.json         Desktop app configuration

test-assets/              Local grading/reference images, ignored by Git
AGENTS.md                 First-read guide for AI agents and contributors
CHANGELOG.md              Handoff log for every meaningful change
```

## Current Limitations

- Still-image workflow only.
- No brush mask yet.
- Pen masks are polygon-based, not Bezier curves.
- Color management is simplified.
- The agent operates through `.opengrade-agent.json`, not direct OS-level
  mouse/keyboard automation.
- Saved projects remember source paths instead of embedding media.
- The prototype is not production-hardened yet.

## Repository Size Notes

Generated and machine-local files should stay out of Git:

- `node_modules/`
- `dist/`
- `src-tauri/target/`
- `*.tsbuildinfo`
- `config/storage.local.json`
- `data/`
- `test-assets/`

The Rust `src-tauri/target/` directory can be several gigabytes. It is build
cache, not source code.

## Status

OpenGrade is an active prototype. The strongest implemented idea is already
working: an AI agent can apply a visible, editable grading recipe through a
local command protocol. The next important steps are better masking, stronger
color monitoring, cleaner editor module boundaries, and more reliable
agent-driven visual evaluation.
