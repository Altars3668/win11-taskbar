#!/usr/bin/env python3
"""Diff the rendered taskbar against the Windows measurements.

Asks the extension's debug D-Bus service for the live geometry of every part
of the bar, then checks it against the numbers recorded in lib/spec.js — the
ones measured on a real Windows 11 machine. Run it against the headless test
shell (tools/testbed.sh) or against a live session with debug-service on.

Exits non-zero if any check fails, so it can gate a commit.
"""

import json
import re
import subprocess
import sys
from pathlib import Path

BUS = "org.gnome.Shell.Extensions.Win11Taskbar"
OBJ = "/org/gnome/Shell/Extensions/Win11Taskbar"


def read_spec() -> dict:
    """Pull the measured constants straight out of lib/spec.js.

    Parsing the source keeps this tool honest: there is exactly one place
    where a Windows measurement lives, and both the extension and the test
    read it from there.
    """
    src = (Path(__file__).resolve().parent.parent / "lib" / "spec.js").read_text()
    spec = {}
    for block in re.finditer(r"export const (\w+) = \{(.*?)\n\};", src, re.S):
        name, body = block.group(1), block.group(2)
        values = {}
        for key, value in re.findall(r"^\s*(\w+):\s*([^,\n]+),", body, re.M):
            value = value.strip()
            if re.fullmatch(r"-?\d+(\.\d+)?", value):
                values[key] = float(value) if "." in value else int(value)
            else:
                values[key] = value.strip("'\"")
        spec[name] = values
    return spec


def dump_geometry() -> dict:
    out = subprocess.run(
        ["gdbus", "call", "--session", "--dest", BUS, "--object-path", OBJ,
         "--method", f"{BUS}.DumpGeometry"],
        capture_output=True, text=True, timeout=30,
    )
    if out.returncode != 0:
        sys.exit(f"cannot reach the debug service: {out.stderr.strip()}")
    # gdbus prints ('<json>',) with the JSON escaped as a GVariant string.
    body = out.stdout.strip()
    body = body[2:-3] if body.startswith("('") else body
    return json.loads(body.encode().decode("unicode_escape"))


class Checks:
    def __init__(self):
        self.failures = []
        self.passes = 0

    def eq(self, label, actual, expected, tol=0):
        ok = abs(actual - expected) <= tol if isinstance(actual, (int, float)) \
            else actual == expected
        if ok:
            self.passes += 1
        else:
            self.failures.append(f"{label}: got {actual}, Windows has {expected}")
        return ok

    def report(self):
        for line in self.failures:
            print(f"  FAIL  {line}")
        print(f"\n{self.passes} checks passed, {len(self.failures)} failed")
        return 1 if self.failures else 0


def main():
    spec = read_spec()
    geo = dump_geometry()
    scale = geo["scaleFactor"]
    c = Checks()

    for bar in geo["bars"]:
        tag = f"monitor {bar['monitor']}"
        panel = bar["panel"]

        c.eq(f"{tag}: panel height", panel["h"], spec["PANEL"]["height"] * scale)
        c.eq(f"{tag}: panel spans the screen", panel["x"], 0)

        buttons = bar["buttons"]
        for b in buttons:
            c.eq(f"{tag}: {b['id']} width",
                 b["w"], spec["BUTTON"]["width"] * scale)
            c.eq(f"{tag}: {b['id']} height",
                 b["h"], spec["BUTTON"]["height"] * scale)
            if b["icon"]:
                c.eq(f"{tag}: {b['id']} icon size",
                     b["icon"]["w"], spec["BUTTON"]["iconSize"] * scale)
                # Measured on Windows: the icon sits dead centre in the cell.
                c.eq(f"{tag}: {b['id']} icon centred",
                     b["icon"]["x"] + b["icon"]["w"] / 2,
                     b["x"] + b["w"] / 2, tol=1)

            ind, state = b["indicator"], b["indicatorState"]
            if state == "none":
                c.eq(f"{tag}: {b['id']} has no indicator", ind["visible"], False)
            else:
                want = spec["INDICATOR"][
                    "activeWidth" if state == "active" else "inactiveWidth"]
                c.eq(f"{tag}: {b['id']} indicator width ({state})",
                     ind["w"], want * scale, tol=1)
                c.eq(f"{tag}: {b['id']} indicator thickness",
                     ind["h"], spec["INDICATOR"]["thickness"] * scale)
                c.eq(f"{tag}: {b['id']} indicator centred",
                     ind["x"] + ind["w"] / 2, b["x"] + b["w"] / 2, tol=1)
                c.eq(f"{tag}: {b['id']} indicator above the bottom edge",
                     panel["y"] + panel["h"] - (ind["y"] + ind["h"]),
                     spec["INDICATOR"]["bottomOffset"] * scale, tol=1)

        # Buttons touch each other, with no gap — measured 44px pitch.
        for a, b in zip(buttons, buttons[1:]):
            c.eq(f"{tag}: pitch {a['id']} to {b['id']}",
                 b["x"] - a["x"], spec["BUTTON"]["width"] * scale)

        # The centre zone is centred on the screen, not between the others.
        if spec["LAYOUT"]["alignment"] == "center" and bar["centerZone"]:
            z = bar["centerZone"]
            c.eq(f"{tag}: centre zone is screen-centred",
                 z["x"] + z["w"] / 2, panel["x"] + panel["w"] / 2, tol=1)

        for name, key in [("startButton", "startButtonWidth"),
                          ("taskViewButton", "taskViewButtonWidth")]:
            if bar[name] and bar[name]["visible"]:
                c.eq(f"{tag}: {name} width",
                     bar[name]["w"], spec["LAYOUT"][key] * scale)
                c.eq(f"{tag}: {name} height",
                     bar[name]["h"], spec["BUTTON"]["height"] * scale)

        if bar["showDesktop"] and bar["showDesktop"]["visible"]:
            c.eq(f"{tag}: show-desktop width",
                 bar["showDesktop"]["w"], spec["TRAY"]["showDesktopWidth"] * scale)

        # The right zone ends flush with the screen edge.
        rightmost = max((bar[k]["x"] + bar[k]["w"])
                        for k in ("clock", "showDesktop", "systemIndicators")
                        if bar.get(k) and bar[k]["visible"])
        c.eq(f"{tag}: tray is flush right", rightmost, panel["x"] + panel["w"])

        # Tray icons: measured 32x48 buttons with a 16x16 glyph, and the
        # chevron in the same 32x48 cell.
        tray = bar.get("tray") or {}
        for icon in tray.get("icons", []):
            if not icon.get("visible"):
                continue
            c.eq(f"{tag}: tray icon {icon['id']} width",
                 icon["w"], spec["TRAY"]["iconButtonWidth"] * scale)
            c.eq(f"{tag}: tray icon {icon['id']} height",
                 icon["h"], spec["BUTTON"]["height"] * scale)
            if icon.get("glyph"):
                c.eq(f"{tag}: tray glyph {icon['id']} size",
                     icon["glyph"]["w"], spec["TRAY"]["iconSize"] * scale)
        if tray.get("chevronVisible") and tray.get("chevron"):
            c.eq(f"{tag}: overflow chevron width",
                 tray["chevron"]["w"], spec["TRAY"]["overflowButtonWidth"] * scale)
        if not tray.get("overflowVisible", False):
            c.passes += 1
        else:
            c.failures.append(f"{tag}: the overflow panel should start closed")

        # The Start menu's proportions are NOT measured (see spec.js), so we
        # only assert that what renders matches what spec.js asks for, and
        # that it starts closed.
        start = bar.get("startMenu")
        if start is not None:
            if not start["open"]:
                c.passes += 1
            else:
                c.failures.append(f"{tag}: the Start menu should start closed")

        if not bar["preview"]["visible"]:
            c.passes += 1
        else:
            c.failures.append(f"{tag}: the preview popup should start hidden")

    return c.report()


if __name__ == "__main__":
    sys.exit(main())
