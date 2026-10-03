/* spec.js — Windows 11 taskbar metrics.
 *
 * Every number below was measured on a real Windows 11 machine
 * (build 10.0.29671, 1920x1080, DPI 96 / 100% scale, light theme)
 * via UIAutomation geometry dumps and pixel analysis of screen grabs.
 * See docs/windows-spec.md for the raw measurements and method.
 *
 * All lengths are logical pixels at scale 1; multiply by the monitor's
 * scale factor at use time. Never hardcode a derived value elsewhere —
 * this file is the single source of truth.
 */

/** Taskbar shell. */
export const PANEL = {
    /** Measured: Shell_TrayWnd height, and the strut it reserves. */
    height: 48,
    /** Measured: 1px top separator line, #B5B5B4 on light / #2E2E2E on dark. */
    borderWidth: 1,
};

/** Task buttons (the app buttons in the middle zone). */
export const BUTTON = {
    /** Measured: every app button is exactly 44x48, laid out with zero gap. */
    width: 44,
    height: 48,
    gap: 0,
    /** Measured: icon bounding box 23x23 antialiased => 24x24 nominal, centred. */
    iconSize: 24,
    /** Fluent ControlCornerRadius for the hover/pressed plate. */
    cornerRadius: 4,
    /** The hover plate is inset from the 44x48 cell. */
    plateInset: 2,
};

/** Running indicator: the pill under the icon. */
export const INDICATOR = {
    /** Measured: 6px wide when the app runs but is not focused. */
    inactiveWidth: 6,
    /** Measured: 18px wide when the app owns the focused window. */
    activeWidth: 18,
    /** Measured: core rows y=40..42 inside a 48px bar => 3px tall. */
    thickness: 3,
    /** Measured: bottom of the pill sits 5px above the taskbar bottom edge. */
    bottomOffset: 5,
    /** Measured colour of the inactive pill on light theme: rgb(121,120,124). */
    inactiveColorLight: 'rgb(121,120,124)',
    inactiveColorDark: 'rgb(154,153,150)',
    /** Measured colour of the active pill: rgb(0,120,212) = Windows #0078D4. */
    activeColorLight: 'rgb(0,120,212)',
    activeColorDark: 'rgb(76,194,255)',
    /** Observed mid-animation width (8px) while a button was activating,
     *  i.e. the pill animates its width rather than snapping. */
    widthTransitionMs: 150,
};

/** Three-zone layout. Measured on a 1920px screen:
 *  widgets button at x=6 (left), app strip centred on the screen midpoint
 *  (Start at 606 .. last button right edge 1315, midpoint 960.5 ≈ 960),
 *  system tray from x=1592 to the right edge. */
export const LAYOUT = {
    /** 'center' reproduces the Windows 11 default; 'left' is Windows 10 style. */
    alignment: 'center',
    /** Measured: Start button 45x48. */
    startButtonWidth: 45,
    /** Measured: 44x48, same cell as an app button. */
    taskViewButtonWidth: 44,
    /** Measured: 2px between the Start button and the search box. */
    startToSearchGap: 2,
    /** Measured: left zone starts 6px from the screen edge. */
    edgePadding: 6,
};

/** System tray / notification area. */
export const TRAY = {
    /** Measured: chevron ("show hidden icons") is 32x48. */
    overflowButtonWidth: 32,
    /** Measured: each tray icon button is 32x48 with a 16x16 glyph. */
    iconButtonWidth: 32,
    iconSize: 16,
    /** Measured: the merged network/volume glyphs are 24x48 each. */
    systemGlyphWidth: 24,
    /** Measured: clock cell 62x48, two stacked lines (time over date). */
    clockWidth: 62,
    /** Measured: the "show desktop" sliver at the far right is 12x48. */
    showDesktopWidth: 12,
};

/** Interaction timings. */
export const TIMING = {
    /** Measured: HKCU\Control Panel\Mouse\MouseHoverTime = 400ms.
     *  Windows uses it as the delay before a taskbar thumbnail appears. */
    thumbnailShowDelayMs: 400,
    /** Grace period after the pointer leaves before the preview closes,
     *  so the pointer can travel from the button into the popup. */
    thumbnailHideDelayMs: 120,
    /** Measured: HKCU\Control Panel\Desktop\MenuShowDelay = 400ms. */
    menuShowDelayMs: 400,
    /** Fluent motion: fade/scale for popups. */
    popupFadeMs: 150,
};

/** Hover thumbnail popup. */
export const THUMBNAIL = {
    /** Windows caps a single thumbnail's width and scales to aspect. */
    maxWidth: 200,
    maxHeight: 128,
    spacing: 8,
    padding: 8,
    cornerRadius: 8,
    /** Gap between the popup and the taskbar edge. */
    offsetFromPanel: 8,
    titleHeight: 20,
};

/** Surface colours.
 *
 * The real taskbar is acrylic: sampling one row at different x gave
 * rgb(232,222,215), rgb(245,244,248) and rgb(218,220,233) — a spread of
 * about 13/22/33 per channel, which is the wallpaper showing through.
 *
 * That spread is what fixes the opacity. If the fill is #F3F3F3 at alpha a
 * over a wallpaper varying by Δ, the result varies by Δ(1-a). A spread of
 * ~30 against a wallpaper spread of ~100 puts 1-a near 0.3, i.e. **a ≈ 0.7**
 * — considerably more transparent than it looks at a glance, which is why
 * an 0.85 fill reads as flat grey next to the real thing.
 */
export const SURFACE = {
    lightBg: 'rgba(243,243,243,0.70)',
    darkBg: 'rgba(32,32,32,0.72)',
    lightBorder: 'rgb(181,181,180)',
    darkBorder: 'rgb(46,46,46)',
    /** Fluent SubtleFillColorSecondary / Tertiary — the hover and pressed plates. */
    hoverLight: 'rgba(0,0,0,0.0373)',
    pressedLight: 'rgba(0,0,0,0.0241)',
    hoverDark: 'rgba(255,255,255,0.0605)',
    pressedDark: 'rgba(255,255,255,0.0419)',
};

/** Start menu.
 *
 * Measured on the same machine, which runs Windows 11 build 29671
 * (Insider Preview). Note its Start menu is the NEW design, not the one
 * most Windows 11 installs have: 832px wide with an 8-column pinned grid
 * and a separate "your phone" side panel, where the shipping build is
 * 640px with 6 columns. docs/windows-spec.md spells this out.
 *
 * The side panel has no GNOME equivalent and is not reproduced; the main
 * panel is. `sidePanelWidth` is recorded only because it is part of how the
 * whole thing is centred on screen.
 */
export const START_MENU = {
    measured: true,
    /** Measured: main panel x=403..1234. */
    width: 832,
    /** Measured: y=155..1018. */
    height: 864,
    /** Measured: 13px between the panel's bottom edge and the taskbar. */
    gapFromPanel: 13,
    /** Measured: the phone companion panel, x=1241..1516, 6px to the right
     *  of the main panel. Not reproduced — recorded for the centring maths,
     *  since Windows centres the pair (403..1516 → centre 959.5 ≈ 960). */
    sidePanelWidth: 276,
    sidePanelGap: 6,
    cornerRadius: 8,
    /** Measured: first tile centre 480, panel left edge 403, tile pitch 96
     *  → (832 - 8*96) / 2 = 32. */
    padding: 32,
    /** Measured: 8 columns at a 96px pitch (centres 480, 576, 672 … 1152). */
    pinnedColumns: 8,
    pinnedRows: 2,
    /** Measured: tile pitch 96 across, 84 down (icon rows centred 311, 395). */
    tileWidth: 96,
    tileHeight: 84,
    /** Measured: icon bounding box 31px → 32px nominal. */
    tileIconSize: 32,
    /** Not separately measured; the list view is ours, not Windows'. */
    listRowHeight: 44,
    listIconSize: 24,
    searchHeight: 36,
    footerHeight: 56,
    sectionSpacing: 16,
};

/** The two system flyouts.
 *
 * Measured by diffing full-screen grabs taken before and after opening each
 * one through its shell URI (`ms-availablenetworks:` and `ms-actioncenter:`),
 * with the taskbar's own rows excluded from the diff so a flashing task
 * button could not widen the result.
 *
 * Windows 11 keeps these separate — quick settings on the network/volume/
 * battery glyphs, notifications on the clock. (Windows 10's single Action
 * Centre combined them; 11 does not.)
 */
export const FLYOUT = {
    /** 2026-10-03 主页面截图：约 360×386，三列 96×48 卡片；更多项目可增高。 */
    quickSettingsWidth: 360,
    quickSettingsHeight: 386,
    /** Measured: 12px from the right screen edge for both flyouts. */
    edgeMargin: 12,
    /** Measured: 6px above the taskbar. */
    quickSettingsGap: 6,

    /** Notification centre: measured 338 wide, running nearly the full
     *  height of the screen (y=8..1024 on a 1080p screen). */
    notificationWidth: 338,
    /** Measured: 8px from the top of the screen. */
    notificationTopMargin: 8,
    /** Measured: 7px above the taskbar. */
    notificationGap: 7,

    cornerRadius: 8,
};

/** The acrylic material.
 *
 * Windows composes it in four layers, and getting any one of them wrong
 * is visible: a blurred backdrop, a luminosity blend that keeps the
 * surface legible over anything, a tint, and a noise tile. The noise is
 * the layer people notice without being able to name — it is what stops a
 * blurred panel reading as flat plastic.
 *
 * The tint figures are Microsoft's published AcrylicBrush values. The
 * taskbar's own tint is lower because we measured it: see SURFACE.
 */
export const ACRYLIC = {
    /** Gaussian radius.
     *
     * Windows documents 30 for in-app surfaces. St's BlurEffect takes a
     * box-blur radius rather than a gaussian sigma, and samples past the
     * actor's own bounds, so a large value smears bright content outward
     * into a halo around the panel edge. 60 was visibly too much; these
     * keep the softness without the glow. */
    blurRadiusFlyout: 24,
    blurRadiusPanel: 30,

    /** AcrylicBackgroundFillColorDefault, light and dark. */
    tintLight: 'rgba(252,252,252,0.85)',
    tintDark: 'rgba(44,44,44,0.90)',

    /** The noise tile: 128x128, applied at roughly 2%. Encoded into the
     *  PNG's alpha channel rather than applied as an opacity, because St
     *  has no way to set a per-layer opacity on a background image. */
    noiseTile: 'assets/acrylic-noise.png',
    noiseSize: 128,
};

/** Control elevation.
 *
 * What makes a Fluent control look like an object rather than a coloured
 * rectangle is its border, which is darker along the bottom than the top —
 * light falling from above. Flat-filled buttons read as stickers next to
 * it, which is exactly the complaint this answers.
 *
 * Measured on the real Wi-Fi flyout, x=1755 through a button:
 *   y=735 panel  rgb(223,217,217)
 *   y=736 top    rgb(210,204,204)   13/223 darker → alpha 0.058
 *   y=737 fill   rgb(246,244,244)
 *   y=767 bottom rgb(187,183,185)   36/223 darker → alpha 0.161
 *
 * Those land on Microsoft's published ControlStrokeColorDefault (0.0588)
 * and ControlStrokeColorSecondary (0.161), so the measurement confirms the
 * documented figures rather than replacing them. Dark mode inverts the
 * idea: the brighter edge goes on top.
 */
export const ELEVATION = {
    lightTop: 'rgba(0,0,0,0.0588)',
    lightBottom: 'rgba(0,0,0,0.161)',
    darkTop: 'rgba(255,255,255,0.094)',
    darkBottom: 'rgba(255,255,255,0.0706)',
    /** Measured: the button was 32px tall including both borders. */
    buttonHeight: 32,
};
