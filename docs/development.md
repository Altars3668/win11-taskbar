# Development, testing and releases

[English README](../README.en.md) · [简体中文说明](../README.md) · [Behavior](behavior.md)

## Portable checks

The project uses ES modules, GJS and a GSettings schema. It is not an npm package; `package.json` supplies the ES-module setting for Node-based checks. No `npm install` is required.

Install Node.js 22+, Python 3, GJS, GLib's schema compiler and ICU's `uconv`. On Debian/Ubuntu, the non-Node dependencies are:

```bash
sudo apt-get install make python3 gjs libglib2.0-bin icu-devtools
```

Then run:

```bash
make check
make test-package
make pack
```

`make check` parses extension modules without resolving their `gi://` imports, tests pure click/layout/lifecycle logic, validates schemas, checks application-name ordering through ICU, and exercises the shared asynchronous XBEL reader against temporary files/symlinks, including unknown access timestamps. It does not start a desktop or touch the user's settings.

`make test-package` checks the installable ZIP's layout, compiled schema, required resources, SHA-256 checksum, reproducibility, tag/version agreement and rejection of symbolic links. Output goes to isolated temporary directories.

The package builder is [`tools/pack-extension.py`](../tools/pack-extension.py). `make pack` writes the installable ZIP and `SHA256SUMS` under `dist/`. Required runtime directories and documented files are included explicitly; Git internals, build products, logs and local test captures are not packaged.

## GNOME 50 graphical testbed

GNOME Shell 50 removed `--nested`. The local testbed starts a headless Shell with a virtual monitor, its own session bus, runtime directory, configuration and extension copy:

```bash
tools/testbed.sh start
tools/testbed.sh apps
tools/testbed.sh verify
tools/testbed.sh shot /path/to/testbed-only.png
tools/testbed.sh errors
tools/testbed.sh stop
```

Do not use the debug service against a real user's desktop. It is off by default and enabled by the testbed.

For the complete rendered interaction suite:

```bash
tools/test-ui.sh
TESTBED_MODE=ubuntu tools/test-ui.sh
```

Both modes test real Shell actors and input dispatch. Ubuntu mode also exercises Yaru while its automatically enabled companion extensions remain disabled except for deliberate compatibility tests.

The testbed uses a private runtime directory because GNOME writes an extension-disable marker there at startup. Sharing the user's runtime directory could let a test failure affect extension loading in the real session. The entire session bus and dconf service must share the testbed's runtime so that setting-change notifications reach the test Shell. Only the Wayland test socket is linked back for its test clients.

Hardware interactions are replaced by test fixtures where needed. Wi-Fi tests use a fake connector and record calls; volume tests use a synthetic slider. Never change real networking, real volume or power state as part of a visual regression.

Useful environment variants:

```bash
TESTBED_MONITOR=3840x2160 TESTBED_SCALE=2 tools/testbed.sh start
TESTBED_MONITOR=3840x2160 TESTBED_SCALE=2 TESTBED_LOGICAL=1 tools/testbed.sh start
TESTBED_ANIMATIONS=1 tools/testbed.sh start
TESTBED_MONITOR=1920x1080 TESTBED_SECOND_MONITOR=1280x720 tools/testbed.sh start
```

The logical-monitor variant reproduces a 2× display while keeping stage coordinates logical. The other variant checks integer-scaled stage geometry. Avoid other heavy GPU workloads while running rendered tests.

### Focused suites

| Test | Scope |
| --- | --- |
| `tools/test-taskbar-options.py` | Settings, taskbar menus, tray ownership and combined system hover |
| `tools/test-controls.py` | Three-icon shared hover, visible desktop divider, connected quick-toggle/arrow geometry and actions |
| `tools/test-quick-pages.py` | Native subpages, return navigation, account/power integration |
| `tools/test-quick-edit.py` | Unpin, Add, drag reorder, editing and focus |
| `tools/test-search.py` | Manual search styles, light/dark hover and independent panel activation |
| `tools/test-search-recommendations.py` | Real keyboard search, Start independence, scope/filter separation, recommendation refresh and four-edge placement |
| `tools/test-adaptive-ui.py` | Automatic/manual size, Start columns, 50 isolated app fixtures, bounded overflow and actual wheel/shortcut reveal |
| `tools/test-multi-monitor-search.py` | 1080p + 720p virtual monitors, per-monitor size, search placement and cross-monitor grab cleanup |
| `tools/test-edges.py` | All screen edges and taskbar sizes |
| `tools/test-snap-layouts.py` | Keyboard/mouse layouts, maximize hover, edge dragging, assist and Tiling Assistant handoff |
| `tools/test-window-frames.py` | Frame, shadow and Xwayland rendering |
| `tools/test-gtk-window-style.py` | GTK CSS writes, parsing and restoration |
| `tools/test-window-mica.py` | Wallpaper material, dialogs and application filtering |
| `tools/test-shortcuts.py` | Shortcut ownership, teardown and session-end recovery |

Most of these are launched with `/usr/bin/python3 tools/<name>.py` after starting the testbed. Full UI tests also check JavaScript/GObject warnings and shutdown cleanup, not just assertion counts.

## Debug interface

With `debug-service` enabled, the extension exposes:

- `DumpGeometry()` — live actor geometry/state as JSON.
- `Screenshot(path)` — an internal screenshot of the test stage.
- `Trigger(action)` — test-only UI actions and synthetic input/fixtures.

`Screenshot()` returns before its output stream has necessarily finished writing. Wait for a new file with a stable, nonzero size before doing pixel comparisons; do not reuse a previous screenshot accidentally.

Input scripts use `pointer:<JSON>` or `keys:<JSON>`. Pointer steps support `move`, relative `by`, `press`, `release`, discrete `scroll` directions and `wait`. They are asynchronous. Tests must wait for expected state or settled geometry before clicking an animated target and release any held buttons in cleanup.

## Source map

| Modules | Responsibility |
| --- | --- |
| `spec.js`, `snapGeometry.js`, `barEdge.js` | UI metrics and pure geometry |
| `clickSemantics.js`, `applicationOrder.js` | Gesture decisions and application ordering |
| `panel.js`, `taskList.js`, `taskButton.js`, `shellButtons.js` | Taskbar layout and buttons |
| `windowPreview.js`, `jumpList.js`, `attentionToasts.js` | App previews, menus and attention feedback |
| `startMenu.js`, `startPins.js`, `startOptions.js`, `adaptiveLayout.js` | Start behavior, pins and pure automatic layouts |
| `searchPanel.js`, `applicationSearch.js`, `searchMatch.js`, `launcherPanels.js` | Independent local search, shared matching/launch and cross-monitor exclusivity |
| `recentDocuments.js`, `recommendationPolicy.js` | Asynchronous local recent snapshot and pure Start recommendation filters |
| `peekState.js`, `windowPeek.js`, `micaTarget.js`, `indicatorIcons.js` | Shared opacity ownership and pure material/network classifications |
| `statusNotifier.js`, `dbusMenu.js`, `trayArea.js` | Native Linux tray protocols and overflow |
| `systemIndicators.js`, `systemFlyouts.js` | Reuse of GNOME indicators and menus |
| `quickTileLayout.js`, `quickSettingsEditor.js`, `sliderThumb.js` | Connected cards, editing and slider appearance |
| `quickPages.js`, `wifiFlow.js` | Subpage navigation and connection flow |
| `windowAnimations.js`, `windowMotion.js` | Window effects and launch origins |
| `windowFrames.js`, `windowMica.js`, `gtkWindowStyle.js` | Frames, wallpaper material and opt-in GTK styling |
| `snapLayouts.js`, `snapPreview.js`, `captionButtons.js` | Snap entry points, preview and caption geometry |
| `notificationCentre.js`, `notificationList.js`, `notificationPersistence.js` | Calendar and notifications |
| `inputMethodPanel.js`, `inputSwitcher.js`, `clipboardHistory.js` | Input sources and clipboard history |
| `theme.js`, `motion.js`, `acrylicSurface.js` | Shared appearance and reduced motion |
| `shortcuts.js`, `superKey.js`, `quickLinks.js`, `rebootTargets.js` | Keyboard and system actions |
| `autoHide.js`, `shellMenus.js`, `shellShutdown.js` | Desktop integration and safe cleanup |
| `debugService.js` | Test geometry, fixtures and input injection |

Paths above are under `lib/`. Native patches and their build tools are separate from the extension ZIP; see [`patches/README.md`](../patches/README.md).

Explicit allocation is used where the stock layout managers ignore alignment or let content change intended cell dimensions. A shared surface carries a control's border/fill while internal hit areas preserve GNOME's real actions. Borrowed actors and properties must be restored on disable, not destroyed with the extension.

## GitHub Actions and releases

[`build.yml`](../.github/workflows/build.yml) uses immutable official action commits and minimal token permissions. Builds have read-only access; the tag-triggered publish job alone gets `contents: write`. Pull requests cannot publish releases.

The hosted runner validates the portable checks and package. It does **not** claim to run the GNOME 50 headless suite: a stock Ubuntu runner's desktop stack is not this workstation's GNOME version or patched environment.

To publish a version:

1. Update `metadata.json`: increment the integer `version` and set `version-name`, for example `0.2.0`.
2. Update both READMEs and add `docs/releases/v0.2.0.md` with English and Chinese notes.
3. Run the portable checks, package tests and the two local UI modes; record actual outcomes.
4. Commit and push the release-ready `main` branch.
5. Tag that commit and push the tag:

   ```bash
   git tag -a v0.2.0 -m "Release v0.2.0"
   git push github v0.2.0
   git push origin v0.2.0
   ```

The tag must match the metadata or the build fails. Actions uploads the exact compiled ZIP/checksum as an artifact, and the release job uses those same files rather than rebuilding a different package. Existing release assets are not silently replaced.

Before making a private development history public, inspect tracked binaries and the history for secrets. Do not commit desktop captures containing private application content. Generated acrylic noise and shadow textures are runtime assets, not desktop screenshots.
