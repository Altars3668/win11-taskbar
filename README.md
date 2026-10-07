# Windows 11 Taskbar for GNOME Shell

**English** · [简体中文](README.zh-CN.md)

[![Build](https://github.com/Altars3668/win11-taskbar/actions/workflows/build.yml/badge.svg)](https://github.com/Altars3668/win11-taskbar/actions/workflows/build.yml)
[![Release](https://img.shields.io/github/v/release/Altars3668/win11-taskbar)](https://github.com/Altars3668/win11-taskbar/releases/latest)
[![License: GPL-3.0-or-later](https://img.shields.io/badge/license-GPL--3.0--or--later-blue.svg)](LICENSE)

A Windows 11-style taskbar for **GNOME Shell 50**, with a Start menu, configurable search, live window previews, a system tray, quick settings, and snap layouts. Layout and interaction timings are based on measurements from a real Windows 11 machine, not just screenshots remembered from Windows.

This is an independent GNOME extension, not a Microsoft product and not a Windows compatibility layer. It keeps GNOME's network, audio, brightness and power backends rather than replacing them.

## Highlights

| Area | Features |
| --- | --- |
| Taskbar | Centered or left-aligned applications; pinned and running apps; per-workspace filtering; multi-monitor support; auto-hide; all four screen edges |
| Start and search | Pinned apps, app folders, recent documents, account and power menus; hidden, icon, icon + label, or search-box styles |
| Windows | Live thumbnail previews, Aero Peek, jump lists, attention flashing, Windows-style open/minimize/restore animations, rounded corners and shadows |
| Snap layouts | `Super+Z`, maximize-button hover, drag-to-top layouts, edge/corner snapping, and snap assist |
| Tray | StatusNotifierItem/DBusMenu support, per-app overflow selection, rotating overflow chevron, optional hover menus |
| System controls | **One combined network/volume/battery button**, quick-settings subpages, connected toggle/arrow controls, volume and brightness sliders |
| Notifications | Notification cards and calendar, separate from quick settings; clipboard history; GNOME and Fcitx 5 input switching |
| Show desktop | A visible separator at the end of the taskbar, click-to-minimize/restore, and hover-to-peek |
| Appearance | Light/dark themes, acrylic surfaces, configurable taskbar thickness; optional GTK title bars and Mica |

### Familiar mouse behavior

| Gesture | Result |
| --- | --- |
| Click an app that is not running | Launch it |
| Click a single unfocused window | Activate it |
| Click a single focused window | Minimize it |
| Click an app with several windows | Open its thumbnail flyout |
| `Ctrl` + click | Cycle through the app's windows |
| `Shift` + click or middle-click | Open another window |
| Right-click | Open the jump list |

Network, volume and battery share one hover/pressed background, as on Windows 11. In quick settings, the toggle and its arrow share a connected card: the left side toggles the feature and the arrow opens its subpage. A desktop without a battery has no substitute power-off icon in the taskbar.

## Requirements and compatibility

- **GNOME Shell 50**. This release declares only the version validated by the project. GNOME 48/49 are not claimed as supported.
- Wayland is the primary test environment. Xwayland windows are also covered by the window-frame tests.
- Standard GNOME services provide audio, networking, brightness, notifications and power controls. Hardware-dependent controls only appear when those services expose them.
- This extension does not install or replace GTK, Mutter or the Linux kernel. Optional native patches are documented separately in [`patches/README.md`](patches/README.md).

## Install

### From a release — recommended

1. Download `win11-taskbar@altarscn.com.shell-extension.zip` and `SHA256SUMS` from [the latest GitHub release](https://github.com/Altars3668/win11-taskbar/releases/latest).
2. In the download directory, verify and install:

   ```bash
   sha256sum --check SHA256SUMS
   gnome-extensions install --force win11-taskbar@altarscn.com.shell-extension.zip
   ```

3. **Log out and log back in**, then enable the extension:

   ```bash
   gnome-extensions enable win11-taskbar@altarscn.com
   ```

On Wayland, logging back in lets GNOME discover a newly installed extension and load updated JavaScript. The project does not automatically restart your desktop or close your applications.

### From source

```bash
git clone https://github.com/Altars3668/win11-taskbar.git
cd win11-taskbar
make install
# Log out and log back in before enabling a newly installed extension.
gnome-extensions enable win11-taskbar@altarscn.com
```

Source installation needs `make` and `glib-compile-schemas` (on Debian/Ubuntu: `libglib2.0-bin`). The release ZIP already includes compiled settings schemas.

### Avoid conflicting extensions

Only one extension should draw the main taskbar and only one service can own `org.kde.StatusNotifierWatcher`.

- Avoid running this extension together with Dash to Panel, Dash to Dock or Ubuntu Dock.
- Disable AppIndicator Support / Ubuntu AppIndicators if you want this taskbar to own the tray.
- **Tiling Assistant:** while it is enabled, screen-edge dragging stays with it. Disable it to use this extension's unified edge-snap previews and snap assist.
- **Blur my Shell:** popup blur can interfere with this extension's rounded acrylic surfaces. Disable its popup blur or the extension if you see black corners.

For source installs, the optional switch-over helper previews its changes first:

```bash
tools/enable.sh          # Preview conflicting extensions.
tools/enable.sh --apply  # Disable those extensions and record what changed.
tools/disable.sh        # Restore the recorded extensions.
```

## Settings

Open the Extensions app or run:

```bash
gnome-extensions prefs win11-taskbar@altarscn.com
```

Configure the screen edge, alignment, thickness (32–96 px), auto-hide, search style, visible elements, tray overflow, Start layout/folders, themes, shortcuts, window effects and per-monitor/per-workspace behavior.

**GTK title bars and Mica are opt-in.** GTK title-bar styling adds a marked block to your GTK 3/4 user CSS and changes the GNOME window-button layout; disabling it removes that block and restores the saved layout. Existing applications usually need restarting to pick up the style. Mica additionally requires GTK title-bar styling. GTK 3 cannot distinguish application dark themes in CSS, so its Mica strength uses the light setting.

## Keyboard shortcuts

`Super` is the Windows/logo key on most keyboards.

| Shortcut | Action |
| --- | --- |
| `Super` | Start menu, when enabled |
| `Super+Z` | Snap layouts |
| `Super+A` | Quick settings |
| `Super+N` | Notification center |
| `Super+Space` / `Shift+Super+Space` | Next / previous input method |
| `Super+X` | Quick Link menu |
| `Super+V` | Clipboard history |
| `Super+D` | Show desktop |
| `Super+E` / `Super+I` / `Super+R` | Files / Settings / Run |
| `Super+T` / `Super+1…9` | Step through / activate taskbar buttons |

Bindings taken over by the extension are restored when it is disabled. Some shortcuts are configurable or can be turned off.

## Build, test and release

This extension is JavaScript/GJS, CSS and assets: cloud “compilation” means compiling GSettings schemas and building the installable ZIP, not building GNOME or native GTK packages.

```bash
make check           # Syntax, pure logic, schemas and app-name ordering; no test desktop.
make test-package    # Archive layout, checksums, determinism and packaging safety.
make pack            # dist/*.shell-extension.zip and dist/SHA256SUMS.
```

Local checks need Node.js 22+, Python 3, GJS, `glib-compile-schemas`, and an ICU `uconv` binary. On Debian/Ubuntu, install `gjs`, `libglib2.0-bin` and `icu-devtools` in addition to Node/Python.

For rendered interaction tests on a compatible GNOME 50 workstation:

```bash
tools/test-ui.sh
TESTBED_MODE=ubuntu tools/test-ui.sh
```

These tests use a separate headless shell, session bus, runtime directory and settings. Test Wi-Fi and audio controls are synthetic; the tests do not join a real network or adjust your real volume. See [development and testing](docs/development.md).

### GitHub Actions

[The build workflow](.github/workflows/build.yml) runs on pushes to `main`, pull requests, version tags and manual dispatch:

1. Check syntax and pure logic, and compile the settings schemas.
2. Test and build a deterministic installable ZIP with a SHA-256 checksum.
3. Upload the ZIP/checksum as Actions artifacts.
4. On a `v*` tag, publish a GitHub Release with those same files. The tag must match `metadata.json`'s `version-name`.

Hosted CI validates the portable build, not the GNOME 50 graphical testbed. Release notes state that distinction; local full-UI regressions are checked separately. Publishing another version requires updating `version` and `version-name`, committing, and pushing the matching tag.

## Known limits

- This is a Windows-inspired desktop experience, not a pixel-identical reproduction of every Windows build. Some material colors and dark-mode snap previews are approximations.
- There is no Windows widgets/news panel or daily search-highlight image. Taskbar search opens the extension's Start search, or GNOME search when the extension's Start menu is off.
- Drag-to-reorder **taskbar app buttons** is not implemented. Quick-settings tiles do support their own edit and reorder mode.
- Maximize-button hover depends on app-drawn button geometry. GTK apps with the optional title-bar style, Chromium and Electron are recognized; other toolkits/custom title bars are not guaranteed.
- System-wide release-timed context menus require the optional GTK/Mutter patches; the extension alone cannot rewrite application-owned menus.
- Windows' suggested snap groups, top-edge peek strip and dragged-window shrinking are not reproduced.

## Documentation and project links

- [简体中文使用说明](README.zh-CN.md)
- [Detailed behavior](docs/behavior.md)
- [Development, testbed and source map](docs/development.md)
- [Windows measurements](docs/windows-spec.md)
- [Rendering validation](docs/rendering-validation.md)
- [Optional native patches](patches/README.md)
- [GitHub releases](https://github.com/Altars3668/win11-taskbar/releases) · [Gitea source](https://git.altarscn.com/Geoffrey/win11-taskbar)

## License

[GPL-3.0-or-later](LICENSE), consistent with GNOME Shell. Windows and Microsoft are trademarks of their respective owners; this project is not affiliated with or endorsed by Microsoft.
