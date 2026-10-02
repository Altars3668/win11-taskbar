#!/usr/bin/env node
// Checks lib/clickSemantics.js against the Windows rules, with no compositor
// involved. Run with: node tools/test-semantics.mjs
import {Action, Button, decide} from '../lib/clickSemantics.js';

let pass = 0;
const fails = [];

function check(label, got, want) {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (ok)
        pass++;
    else
        fails.push(`${label}\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`);
}

// Pinned but not running: a click starts the app.
check('pinned, click -> launch',
    decide({button: Button.PRIMARY, windowCount: 0}),
    {action: Action.LAUNCH});

// One window that is not focused: raise it.
check('one window unfocused -> activate',
    decide({button: Button.PRIMARY, windowCount: 1, focusedIndex: -1}),
    {action: Action.ACTIVATE, windowIndex: 0});

// The Windows signature move: click the focused app to minimise it.
check('one window focused -> minimise',
    decide({button: Button.PRIMARY, windowCount: 1, focusedIndex: 0}),
    {action: Action.MINIMIZE, windowIndex: 0});

// Several windows: show the flyout rather than switching.
check('three windows -> preview',
    decide({button: Button.PRIMARY, windowCount: 3, focusedIndex: 1}),
    {action: Action.SHOW_PREVIEW});

check('three windows, preview open -> close it',
    decide({button: Button.PRIMARY, windowCount: 3, previewOpen: true}),
    {action: Action.HIDE_PREVIEW});

// New instances.
check('middle click, running -> new window',
    decide({button: Button.MIDDLE, windowCount: 2}),
    {action: Action.NEW_WINDOW});

check('middle click, not running -> launch',
    decide({button: Button.MIDDLE, windowCount: 0}),
    {action: Action.LAUNCH});

check('shift+click, running -> new window',
    decide({button: Button.PRIMARY, shift: true, windowCount: 1}),
    {action: Action.NEW_WINDOW});

// Ctrl walks the group and wraps.
check('ctrl+click from window 0 of 3 -> window 1',
    decide({button: Button.PRIMARY, ctrl: true, windowCount: 3, focusedIndex: 0}),
    {action: Action.CYCLE, windowIndex: 1});

check('ctrl+click wraps from the last window',
    decide({button: Button.PRIMARY, ctrl: true, windowCount: 3, focusedIndex: 2}),
    {action: Action.CYCLE, windowIndex: 0});

check('ctrl+click with nothing focused -> first window',
    decide({button: Button.PRIMARY, ctrl: true, windowCount: 3, focusedIndex: -1}),
    {action: Action.CYCLE, windowIndex: 0});

// Ctrl must not launch a second copy when the app is not running.
check('ctrl+click, not running -> launch',
    decide({button: Button.PRIMARY, ctrl: true, windowCount: 0}),
    {action: Action.LAUNCH});

// Right click always means the jump list.
check('right click -> menu',
    decide({button: Button.SECONDARY, windowCount: 0}),
    {action: Action.MENU});

check('right click while running -> menu',
    decide({button: Button.SECONDARY, windowCount: 2, focusedIndex: 0}),
    {action: Action.MENU});

for (const f of fails)
    console.log(`  FAIL ${f}`);
console.log(`\n${pass} semantics checks passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
