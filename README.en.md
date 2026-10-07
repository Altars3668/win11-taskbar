# win11-taskbar · Windows 11-style Taskbar for GNOME

[简体中文](README.md) | **English**

An independent extension for **GNOME Shell 50** providing a taskbar, Start menu, search, tray, quick settings, notification centre and snap layouts. This is more than an icon or theme replacement: I rebuilt application-button behaviour, window flyouts, system controls and snapping from measurements of Windows 11, while retaining GNOME's network, audio, brightness and power backends.

> Not a Microsoft product, Windows compatibility layer or GNOME fork. The extension does not replace GTK, Mutter or the kernel; system-level context-menu patches are separate optional components.

[![Build](https://github.com/Altars3668/win11-taskbar/actions/workflows/build.yml/badge.svg)](https://github.com/Altars3668/win11-taskbar/actions/workflows/build.yml)

## My implementation and highlights

| Area | Implemented work |
| --- | --- |
| **Taskbar layout and application behaviour** | Centred / left alignment, pinned and running apps, four screen edges, thickness, auto-hide and monitor / workspace filtering. Buttons launch, activate, minimise or show previews according to window count and focus. |
| **Start and search** | Pinned apps, folders, recent documents, account / power menus; hidden, icon, icon-with-label and search-box modes. |
| **Window previews and effects** | Live thumbnails, Aero Peek, jump lists, attention flashing, open / close / minimise / restore animations, corners and shadows. |
| **Unified snapping** | `Super+Z`, maximise-button hover, top-edge layouts, edge / corner snapping and snap assist with consistent previews. |
| **Tray and system icons** | StatusNotifierItem / DBusMenu, per-app overflow, rotating chevron; network / volume / battery share one button and hover surface. |
| **Separate quick settings and notifications** | Connected toggle / arrow cards, subpages and volume / brightness sliders; notifications and calendar remain a separate panel. |
| **Input and desktop actions** | GNOME / Fcitx 5 input switching, clipboard history and the show-desktop separator with click / hover behaviour. |
| **Optional GTK styling** | Explicitly enabled Windows-style title bars and Mica; disabling removes the extension's CSS block and restores layout rather than replacing system libraries. |
| **System context-menu patches** | Separate GTK 3 / 4 and Mutter patches implement release-timed menus and outside-press delivery. Installing the extension does not install those patches. |
| **Measurements and regressions** | Windows measurements, an isolated GNOME testbed and deterministic ZIP validation, distinguishing pure logic, packaging and complete UI evidence. |

See [behaviour](docs/behavior.md), [Windows measurements](docs/windows-spec.md) and [native patches](patches/README.md) for mechanisms and boundaries.

## Compatibility

- Declares **GNOME Shell 50**, not unverified support for GNOME 48 / 49.
- Primarily tested on Wayland, with Xwayland window-frame coverage. Hardware controls depend on capabilities exposed by GNOME services.
- A desktop without a battery does not receive a substitute shutdown icon. Combined system-icon interactions follow the Windows 11 model.
- An extension cannot rewrite every application's internal menus. Evaluate, build and install GTK / Mutter patches separately, with a rollback plan.

## Installation

### Released ZIP

Download a compatible `win11-taskbar@altarscn.com.shell-extension.zip` and `SHA256SUMS` from [Releases](https://github.com/Altars3668/win11-taskbar/releases). `v0.1.0` is available; branch documentation updates neither move its tag nor republish old artifacts.

```sh
sha256sum --check SHA256SUMS
gnome-extensions install --force win11-taskbar@altarscn.com.shell-extension.zip
# Log out and back in before enabling; do not forcibly restart a working desktop.
gnome-extensions enable win11-taskbar@altarscn.com
```

### Source installation

```sh
git clone https://github.com/Altars3668/win11-taskbar.git
cd win11-taskbar
make install
# Log out and back in after installation or JavaScript updates.
gnome-extensions enable win11-taskbar@altarscn.com
```

Requires `make` and `glib-compile-schemas` (`libglib2.0-bin` on Debian / Ubuntu). Installation and activation are explicit user actions; documentation maintenance does not restart or alter the live desktop.

## Conflicts and settings

The main taskbar and `org.kde.StatusNotifierWatcher` each need a single primary provider:

- Avoid concurrent Dash to Panel, Dash to Dock or Ubuntu Dock. Disable competing AppIndicator implementations when this extension owns the tray.
- While Tiling Assistant is enabled, it retains edge-drag handling. Disable it to use this extension's unified snapping.
- Blur my Shell popup blur can cause black corners; disable the relevant blur setting if necessary.
- `tools/enable.sh` previews changes by default; only `--apply` changes conflicting extensions. `tools/disable.sh` restores recorded state. Read before running.

```sh
gnome-extensions prefs win11-taskbar@altarscn.com
```

Settings cover layout, alignment, thickness, search, tray, Start, themes, shortcuts and window effects. GTK title bars / Mica default off; enabling them changes user GTK CSS and button layout, generally requiring applications to restart. GTK 3 cannot distinguish per-app dark themes for Mica strength.

## Common shortcuts

| Shortcut | Action |
| --- | --- |
| `Super` / `Super+Z` | Start / snap layouts. |
| `Super+A` / `Super+N` | Quick settings / notifications. |
| `Super+X` / `Super+V` | Quick Link / clipboard history. |
| `Super+D` | Show desktop. |
| `Super+Space` / `Shift+Super+Space` | Next / previous input method. |
| `Super+E` / `Super+I` / `Super+R` | Files / Settings / Run. |
| `Super+T` / `Super+1…9` | Cycle / activate taskbar apps. |

Disabling restores intercepted bindings; some shortcuts can be turned off. `Ctrl+click` cycles windows, `Shift+click` / middle-click opens another window, and right-click opens the jump list.

## Build and verification

```sh
make check         # Syntax, pure logic, schemas and ordering; no desktop launch.
make test-package  # ZIP layout, bilingual docs, checksums, determinism and safety.
make pack          # Installable ZIP and SHA256SUMS under dist/.
```

Requires Node.js 22+, Python 3, GJS, `glib-compile-schemas` and ICU `uconv`. Packaging includes the Chinese homepage, English version and legacy Chinese entrypoint so ZIP language-switch links remain valid.

[Actions](.github/workflows/build.yml) performs portable validation and packaging, **not full GNOME 50 graphical qualification**. The isolated headless UI suite and synthetic network / audio controls are documented in [development.md](docs/development.md), separately from real-device and desktop-effects checks. Releases require a `metadata.json` version update and matching tag.

## Limits and attribution

Not a pixel-identical reproduction of every Windows release. News / widgets, daily search images and drag-reordering taskbar application buttons are not implemented. Maximise-button hover recognises supported GTK, Chromium / Electron geometry, not every custom toolkit. Suggested snap groups and some dragged-window effects remain incomplete.

Maintained by Altars3668 using GNOME / GJS interfaces, not copied Windows internals. Licensed [GPL-3.0-or-later](LICENSE), retaining component terms. Microsoft / Windows trademarks belong to their owners; there is no official affiliation or endorsement.
