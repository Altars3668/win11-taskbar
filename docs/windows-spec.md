# What the Windows 11 taskbar actually measures

Every number this extension renders came from a real Windows 11 machine
rather than from a screenshot eyeballed in an image editor. This file records
the measurement setup, the raw results, and the few places where measurement
was impossible and a published value was used instead.

The numbers themselves live in [`lib/spec.js`](../lib/spec.js), which is the
single source of truth: `tools/verify-geometry.py` parses that same file, so
a check can never drift from what the extension draws.

## The machine

| | |
|---|---|
| OS | Windows 11, build 10.0.29671.1000 |
| Screen | 1920 × 1080 |
| DPI | 96 (100% scale) |
| Theme | Light (`SystemUsesLightTheme = 1`, `AppsUseLightTheme = 1`) |
| Transparency | On (`EnableTransparency = 1`) |
| Taskbar settings | All defaults (`TaskbarAl`, `TaskbarSi`, `TaskbarGlomLevel` all unset) |

Reached over SSH. Two things complicate that:

* **OpenSSH on Windows runs in the `Service-0x0-…` window station**, which
  cannot see the interactive desktop at all — `FindWindow("Shell_TrayWnd")`
  returns `NULL`. Measurements therefore ran through a scheduled task created
  with `schtasks /it`, which executes in `WinSta0` in session 1.
* **PowerShell 5.1 reads a `.ps1` as ANSI unless it has a UTF-8 BOM.** Without
  the BOM, every Chinese string comparison in the script silently fails. All
  measurement scripts are written with an explicit BOM.

## Geometry (UIAutomation)

Walking the `Shell_TrayWnd` automation tree gives exact bounding rectangles.

```
Pane  TaskbarFrame                      1920 × 48   @ (0, 1032)
  Button  WidgetsButton                  152 × 48   @ (6, 1032)
  Button  StartButton                     45 × 48   @ (606, 1032)
  Button  SearchButton                   220 × 32   @ (653, 1040)
  Button  TaskViewButton                  44 × 48   @ (875, 1032)
  Button  Appid: MSEdgeDev…                44 × 48   @ (919, 1032)
  Button  Appid: Microsoft.Store…          44 × 48   @ (963, 1032)
  …                                       44 × 48   every 44px
  Button  Appid: Microsoft.Terminal…       44 × 48   @ (1271, 1032)
Button  SystemTrayIcon (chevron)           32 × 48   @ (1592, 1032)
Button  NotifyItem (OneDrive)              32 × 48   @ (1624, 1032)
Button  SystemTrayIcon (network)           24 × 48   @ (1724, 1032)
Button  SystemTrayIcon (volume)            24 × 48   @ (1752, 1032)
Button  SystemTrayIcon (power)             54 × 48   @ (1780, 1032)
Button  SystemTrayIcon (clock)             62 × 48   @ (1842, 1032)
Button  SystemTrayIcon (show desktop)      12 × 48   @ (1908, 1032)
```

What this settles:

* **The bar is 48px tall** and reserves exactly that much: `SPI_GETWORKAREA`
  returned `0,0,1920,1032`.
* **Task buttons are 44 × 48 with no gap.** Consecutive buttons sit at 919,
  963, 1007, 1051, 1095, 1139, 1183, 1227, 1271 — a pitch of exactly 44.
* **The layout is three independent zones, not one row.** Widgets is pinned
  at x=6, the tray is pinned to the right edge, and the app strip is centred
  on the *screen*: Start begins at 606 and the last button ends at 1315,
  giving a midpoint of 960.5 against a screen centre of 960. The app strip's
  position is unaffected by how wide the other two zones are.
* The search box is the only element that is not full height: 220 × 32,
  vertically centred (y=1040 in a band starting at 1032).

## Pixel analysis of a screen grab

Screen grabs were taken with `Graphics.CopyFromScreen` inside the same
scheduled task, then analysed row by row against a reference column of empty
taskbar.

### Running indicators

Sampling rows y=37..47 under each button, against the taskbar background:

| Button | State | Indicator |
|---|---|---|
| Microsoft Store | pinned, not running | none |
| Edge Dev, File Explorer, Gemini | pinned, not running | none |
| Edge | running, not focused | 6px wide, rows 40–42, `rgb(121,120,124)` |
| Word | running, not focused | 6px wide, rows 40–42 |
| WinSCP | running, not focused | 6px wide, rows 40–42 |
| **WeChat** | **running, focused** | **18px wide, rows 40–42, `rgb(0,120,212)`** |
| Terminal | running, mid-animation | 8px wide, rows 40–42 |

So: nothing when merely pinned, a 6px grey pill when running, an 18px accent
pill (`#0078D4`) when the app owns the focused window. All are 3px thick,
horizontally centred, and sit 5px above the bottom edge (rows 40–42 of 48).
Rows 39 and 43 shade off, i.e. the pill has rounded ends.

Terminal's 8px reading is informative rather than noise: it was caught
mid-activation, which shows **the pill animates its width** between 6 and 18
rather than snapping. (It was flashing because the measurement script's own
console window kept appearing; later runs pass `-WindowStyle Hidden`.)

### Icons

The non-background bounding box inside a button is 23 × 23 at offset
(10, 13) — a nominal **24 × 24 icon**, antialiased, centred in the 44 × 48
cell both horizontally (centre 22 of 44) and vertically (centre 24 of 48).

### Surface

Sampling one row at different x gives `rgb(232,222,215)`, `rgb(245,244,248)`,
`rgb(218,220,233)` — the bar is translucent and **blurs what is behind it**
(acrylic), it is not a flat fill. There is a single 1px separator line along
the top edge at `rgb(181,181,180)`, and the buttons keep their full 48px
height underneath it.

## Timings (registry)

| Key | Value | Meaning |
|---|---|---|
| `HKCU\Control Panel\Mouse\MouseHoverTime` | 400 | delay before the thumbnail flyout appears |
| `HKCU\Control Panel\Desktop\MenuShowDelay` | 400 | delay before a menu opens |
| `…\Explorer\Advanced\TaskbarAnimations` | 1 | animations on |

## What could not be measured

**Hover and pressed button fills.** Injecting pointer movement into the
desktop failed: `SendInput` returned 0 and the cursor never moved, because
the scheduled task's integrity level is below that of the foreground window
and UIPI blocks the injection. `SetCursorPos` moves the cursor but does not
make the XAML taskbar react. Three successive grabs were therefore
pixel-identical.

Rather than guess, the extension uses the published Fluent values —
`SubtleFillColorSecondary` for hover and `SubtleFillColorTertiary` for
pressed — and `stylesheet.css` says so at the point of use. These are the
only appearance values in the project that are not measured.

**Multi-window stacking.** Every app on the measurement machine had exactly
one window, so the visual Windows uses for a group of two or more was never
captured. The extension approximates it with a second outline behind the
plate.

## Reproducing

`tools/` holds the Linux side; the Windows side was a handful of PowerShell
scripts run through `schtasks /it`. To re-measure, the essential shape is:

```powershell
# Must be saved with a UTF-8 BOM, and run via:
#   schtasks /create /tn M /tr "powershell -WindowStyle Hidden -NoProfile
#     -ExecutionPolicy Bypass -File %USERPROFILE%\m.ps1"
#     /sc once /st 23:59 /ru <user> /it /f
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing
$tray = [W]::FindWindow("Shell_TrayWnd", $null)
$root = [System.Windows.Automation.AutomationElement]::FromHandle($tray)
# …walk ControlViewWalker, record BoundingRectangle for each element…
```
