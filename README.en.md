# Tailorbird Rig

[简体中文](README.md) | [English](README.en.md)

**A local design review harness for AI agents: create interfaces, review multiple device sizes, annotate designs, hand off feedback, publish revisions, and update the same browser tab.**

The harness provides stable review tools. Each project owns its pages, target dimensions, assets, component definitions, and revisions. A design agent analyzes requirements, creates screens, and addresses feedback. The harness does not call an AI model, read conversations, or send messages to other chats by itself.

This repository contains the generic framework, synthetic examples, tests, and documentation. Product designs, character artwork, private project configurations, feedback, and uploaded images stay in separate local workspaces.

## Quick start

Requires Python 3.10+ and Pillow 10+. There is no frontend build step. The Lottie player is bundled locally; no CDN is required.

```sh
git clone https://github.com/Namunaka/tailorbird-rig.git
cd tailorbird-rig
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e .

tailorbird-rig init workspaces/demo
tailorbird-rig check workspaces/demo/rig.json
tailorbird-rig start workspaces/demo/rig.json --port 18766
```

Open [http://127.0.0.1:18766/](http://127.0.0.1:18766/). `start` launches a background service or reuses a matching one without opening a browser tab. Logs and the process ID are stored in the project's `.rig/` directory. For foreground operation, use `tailorbird-rig serve workspaces/demo/rig.json --port 18766` and stop it with Ctrl+C.

The service listens only on loopback. One feedback directory can have only one HTTP service; use a different port for each project. Remote multi-user hosting and account management are not included.

The starter contains 3 page states, 7 size/form presets, 21 synthetic images, and one Lottie animation. These are **synthetic layout fixtures**, not manufacturer device specifications. Verify physical dimensions, logical units, safe areas, and foldable forms for real targets. See [example presets](docs/device-presets.json).

## Reviewing and giving feedback

1. Select a page on the left and a target size or foldable form at the top. Open the original image or switch to a historical revision when needed.
2. Use the pen, rectangle, or location marker on the right. Write a comment, attach screenshots, and save it. Comments can also apply to the entire page without a drawn marker.
3. Use **Copy pending feedback to chat** or **Download handoff** and give the result to an agent that can access the project files.
4. The agent addresses issues by their original numbers, records results and evidence, creates a separate design revision, and publishes it.
5. The view following the latest revision updates in the same tab. Continue reviewing there.

The tools include pen, rectangle, arrow, location comments, color, stroke width, undo, and deletion. Browsing is the default: click existing annotations to select them and drag to move them. Drawing ends automatically after a stroke; clicking the active tool again or pressing Esc also exits drawing. There are no separate Browse or Select/Move buttons.

The entire central area, including margins around the image, can be annotated. Delete edits text while an input is focused. Images can be uploaded, pasted, or dropped into the comment area.

Feedback is scoped by **page × device/size × revision**. Records preserve the source image SHA256, comment edits, geometry history, withdrawals, and stable issue numbers. New feedback on a completed issue reopens the same number. Saving a comment records feedback; an agent starts the actual design work when instructed in a conversation.

Each page button shows its confirmed-device percentage, with green filling from left to right. A mark on any device needing review turns the page button yellow, even without a comment. Confirmations for other devices still count. **Confirm review** applies only to the current page and device. The overall progress above the page list reaches 100% only when every page–device pair is confirmed. Confirmations survive reloads; changed content or linked animations invalidate affected confirmations.

## Creating interfaces and continuing in a new chat

Example request for an existing project:

> Use Tailorbird Rig to add a plan details screen to `workspaces/demo/rig.json`. Read the existing design and requirements first. Cover the project's target dimensions and foldable forms, preserve existing pages, add the screen to navigation, publish a new revision, and keep the existing review URL. Modify only the project layer.

For a new product:

> Create an independent Tailorbird Rig workspace for this product and design welcome and profile setup screens. Keep its configuration, designs, issues, and revisions separate from other products.

A new chat can read `/api/handoff` from a running review page to find the absolute project configuration path, current revision, pending issues, coordinates, and attachment paths. **The most reliable handoff is the copied feedback bundle plus the review URL.** A screenshot alone does not reliably identify a project. The new agent must have access to the same files and local service. Moving to another computer requires migrating the workspace and assets.

Example continuation request:

> Read this Tailorbird Rig handoff, locate the original project, and address issues one by one using their original numbers. Preserve approved designs, validate the changes, publish a new revision, and keep the existing URL and tab. Do not modify framework internals.

See [AGENTS.md](AGENTS.md) for the agent workflow contract.

## Connecting your designs

```text
workspaces/demo/
├── rig.json
├── designs/
│   ├── v1/
│   │   ├── coverage.json
│   │   ├── screens/phone/welcome.png
│   │   └── animations/feedback/animation.json
│   └── v2/...
└── .rig/                 # Feedback, issues, attachments, service logs
```

Minimal `rig.json`:

```json
{
  "schema_version": 1,
  "id": "demo",
  "title": "Example product design",
  "current_revision": "v1",
  "data_dir": ".rig",
  "issue_prefix": "DEMO",
  "revisions": [{"id": "v1", "root": "designs/v1"}],
  "groups": [{"label": "Onboarding", "states": ["welcome"]}],
  "links": []
}
```

Matching `designs/v1/coverage.json`:

```json
{
  "states": ["welcome"],
  "labels": {"welcome": "Welcome"},
  "devices": [{"id": "phone", "name": "Phone · example size", "w": 402, "h": 874}],
  "image_template": "screens/{device}/{state}.png"
}
```

Supply a PNG for every page/size combination. `w/h` describe layout dimensions; higher-resolution exports can declare `physicalW/physicalH` matching their image dimensions. Add new states to `states`, `labels`, groups, and all target image folders, then run `check`.

Relative paths resolve against the configuration or revision root; explicit absolute paths are supported. `groups` is an array of `{label, states}`. Ungrouped pages appear under the default page group. `links` accepts `{label, url}` entries for project documentation or interaction demos. `mounts` exposes explicitly configured read-only resource roots; do not mount directories containing credentials or unrelated private files.

See the complete [starter configuration](tailorbird_rig/starter/rig.json) and [manifest](tailorbird_rig/starter/designs/v1/coverage.json).

## Issue resolution and publishing

```sh
tailorbird-rig feedback workspaces/demo/rig.json --format markdown

# Generate v2 in a separate directory; retain v1 and its feedback.
tailorbird-rig publish workspaces/demo/rig.json \
  --revision v2 --root workspaces/demo/designs/v2

# Record actual results and evidence; leave unresolved issues pending.
tailorbird-rig resolve workspaces/demo/rig.json 12 \
  --resolution 'Adjusted title and button spacing' \
  --evidence 'designs/v2/screens/phone/welcome.png'
```

Never reuse revision IDs or overwrite images already under review. Publishing validates configuration, images, and declared animations before atomically switching the current revision. Historical designs and feedback remain available.

`resolve` binds the result to the current design content: publish the updated design first, then record resolutions. It marks the page yellow for review and does not confirm it on the user's behalf. Only the user's confirmation action marks it green.

The latest view checks for updates every 3 seconds and refreshes the same tab while preserving page and size selections. Unsaved comments, uploads, or active drawing defer the update. An explicitly selected historical revision stays pinned. Design completion and user acceptance are separate states.

## Shared component library and consistency

The **Shared component library** link opens a version-aware catalog with tokens, named variants, state previews, search, reusable definitions, and JSON export. The starter includes back buttons, primary/secondary actions, text fields, checkboxes, cards, segmented controls, notices, and composed action groups. Default, disabled, loading, focused, error, and checked states are named variants rather than independent drawings on each page.

Each revision owns a `design-system.json`. The framework supplies the renderer. Tokens cover colors, radii, control heights, type size, spacing, and borders, with registered component/variant overrides. A `stack` composes existing child component IDs. Reuse existing IDs first; register a newly reusable pattern before using it across pages.

Declare the system and references in `coverage.json`:

```json
"design_system": "design-system.json",
"require_component_usage": true,
"component_usage": {
  "welcome": ["back-button", "primary-action:default"]
}
```

`check` and `publish` reject duplicate IDs, invalid tokens, circular compositions, and unknown component/variant references. With `require_component_usage`, every page must declare references. Inspect a library with `tailorbird-rig components workspaces/demo/rig.json`. Existing projects without a registry explicitly show the generic example; it is not presented as an approved product design system.

HTML designs can use the same renderer as the catalog:

```html
<link rel="stylesheet" href="/assets/component-kit.css">
<div id="actions"></div>
<script src="/assets/component-kit.js"></script>
<script>
fetch('/api/components').then(r => r.json()).then(({system}) => {
  document.querySelector('#actions').append(
    RigComponents.render(system, 'back-button'),
    RigComponents.render(system, 'primary-action', {variant: 'default', label: 'Save'})
  );
});
</script>
```

Content can vary by page; style/state differences belong in registered components or named variants. Historical pages must request their matching system using `?revision=REVISION_ID`. Native implementations should use the same specification, but native component code generation is not included.

Copy and version the registry with new design revisions; preserve historical definitions. Registry changes invalidate old page acceptance. Reference declarations cannot prove that every pixel in a PNG follows the specification: retain rendering sources and perform visual checks.

## Lottie authoring studio

The **Lottie studio** uses bundled lottie-web **5.12.2** and supports:

- JSON import/editing, structural inspection, and generated motion starters.
- Real SVG/Canvas playback, play/pause/replay, frame scrubbing, speed, and explicit looping.
- JSON and Python generator downloads, plus animations declared in project revisions.

```sh
tailorbird-rig lottie create workspaces/demo/animations/feedback \
  --motion draw --color '#1478ff' --duration 1.8
tailorbird-rig lottie inspect workspaces/demo/animations/feedback/animation.json
python workspaces/demo/animations/feedback/generator.py
```

Starters include `bounce`, `pulse`, and `draw`. Build more complex motion with project-specific generators using standard layers, keyframes, and fixed-topology paths. Reuse `tailorbird_rig/lottie_core.py` without changing the generic player for one product.

Generated bundles include `animation.json`, `generator.py`, `parameters.json`, and `inspection.json`. Put animations under a revision and add this manifest field:

```json
"animations": [
  {"id": "feedback", "label": "Completion feedback", "path": "animations/feedback/animation.json"}
]
```

Structural inspection does not replace visual or target-native-player validation. The studio rejects expressions and remote assets. See the [official loadAnimation documentation](https://github.com/airbnb/lottie-web/wiki/loadAnimation-options) for player parameters.

## Importing older feedback

```sh
tailorbird-rig import-review \
  --store /path/to/legacy-review-store \
  --workspace /path/to/design-workspace \
  --output workspaces/imported
```

Compatible with `issues.json + annotations.json + images/`. Feedback is copied with its numbers, status, hashes, attachments, and history; design revisions are referenced read-only. The stores are independent after import, with no bidirectional synchronization. Use one adopted entry point for new reviews. The legacy `current_revision` value must locate the revision directory relative to `--workspace`.

## Framework maintenance boundary

| Layer | Contents | Ordinary design tasks |
| --- | --- | --- |
| Project | Configuration, designs, project generators, animations, feedback | May update |
| Framework | `tailorbird_rig/`, stable tools, storage protocol, contracts, tests | Requires explicit framework maintenance |

Startup and resource loading check `framework.lock.json` for unregistered changes. For explicitly requested framework maintenance, make the change, run the relevant tests, then record the reason:

```sh
tailorbird-rig framework verify
tailorbird-rig framework seal --maintenance --reason 'Change and validation details'
```

This is a maintenance contract and integrity check, not an OS permission sandbox. An owner with write access can intentionally change the baseline. Ordinary design tasks must not reseal it to bypass protection. See the [feature contract](docs/feature-contract.md).

`workspaces/`, `.rig/`, local environments, build outputs, and test screenshots are ignored by Git by default. Still inspect staged files before publishing. The framework repository does not back up private design workspaces.

## Development and validation

```sh
python -m unittest discover -s tests -v

# Browser test development dependencies
npm install --no-save --package-lock=false playwright
npx playwright install chromium
node tests/browser.cjs
```

Tests use temporary projects and random ports, not real feedback. `PLAYWRIGHT_MODULE`, `CHROME_EXECUTABLE`, and `PYTHON` can select existing runtimes. Rebuild synthetic screenshots with `python tests/generate_starter.py`, then update the integrity baseline through the maintenance workflow.

Modules: `config.py` handles configuration and path boundaries; `store.py` feedback transactions and history; `server.py` the local service; `workflow.py` handoff and publishing; `web/` stable interactions; `starter/` synthetic examples. See [validation scope](docs/validation.md).

## License

The framework is [MIT licensed](LICENSE). Bundled lottie-web retains its [MIT license](tailorbird_rig/web/vendor/lottie-LICENSE.md). Connecting your own designs, assets, and feedback does not change their ownership or licensing.
