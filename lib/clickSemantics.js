/* clickSemantics.js — what a gesture on a task button should do.
 *
 * This is deliberately a pure function over plain data: no actors, no Meta,
 * no side effects. The Windows rules it encodes are the heart of "behaves
 * like Windows", so they are kept where they can be read in one screen and
 * tested without a compositor.
 *
 * The rules, as observed on Windows 11 with the default "always combine"
 * taskbar:
 *
 *   nothing running            -> launch
 *   middle click / Shift+click -> open another window
 *   Ctrl+click                 -> raise the next window of the group
 *   one window, not focused    -> activate it
 *   one window, focused        -> minimise it
 *   two or more windows        -> open the thumbnail flyout
 *                                 (clicking again closes it)
 */

/** Mouse buttons, matching Clutter's numbering. */
export const Button = {
    PRIMARY: 1,
    MIDDLE: 2,
    SECONDARY: 3,
};

/** What the caller should carry out. */
export const Action = {
    LAUNCH: 'launch',
    NEW_WINDOW: 'new-window',
    ACTIVATE: 'activate',
    MINIMIZE: 'minimize',
    CYCLE: 'cycle',
    SHOW_PREVIEW: 'show-preview',
    HIDE_PREVIEW: 'hide-preview',
    MENU: 'menu',
    NOTHING: 'nothing',
};

/**
 * Decide what a click means.
 *
 * @param {object} input the gesture and the state it lands on
 * @param {number} input.button which mouse button (see Button)
 * @param {boolean} [input.ctrl] Ctrl held
 * @param {boolean} [input.shift] Shift held
 * @param {number} input.windowCount how many windows the app has here
 * @param {number} [input.focusedIndex] index of the focused window, or -1
 * @param {boolean} [input.previewOpen] the flyout is already open for this button
 * @returns {{action: string, windowIndex?: number}} what to do
 */
export function decide(input) {
    const {
        button = Button.PRIMARY,
        ctrl = false,
        shift = false,
        windowCount = 0,
        focusedIndex = -1,
        previewOpen = false,
    } = input;

    if (button === Button.SECONDARY)
        return {action: Action.MENU};

    // Windows opens a fresh window for the middle button and for Shift+click,
    // whether or not the app is already running.
    if (button === Button.MIDDLE || shift) {
        return {
            action: windowCount === 0 ? Action.LAUNCH : Action.NEW_WINDOW,
        };
    }

    if (button !== Button.PRIMARY)
        return {action: Action.NOTHING};

    if (windowCount === 0)
        return {action: Action.LAUNCH};

    if (ctrl) {
        // Walk the group in thumbnail order, wrapping around.
        const next = focusedIndex < 0 ? 0 : (focusedIndex + 1) % windowCount;
        return {action: Action.CYCLE, windowIndex: next};
    }

    if (windowCount === 1) {
        return focusedIndex === 0
            ? {action: Action.MINIMIZE, windowIndex: 0}
            : {action: Action.ACTIVATE, windowIndex: 0};
    }

    // Two or more: the flyout, which toggles.
    return {action: previewOpen ? Action.HIDE_PREVIEW : Action.SHOW_PREVIEW};
}
