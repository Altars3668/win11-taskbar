/* superKey.js — make the Super key open the Start menu.
 *
 * On Windows the Windows key opens Start. On GNOME it opens the Overview,
 * wired up in overviewControls.js with
 *
 *     global.display.connectObject('overlay-key', …)
 *
 * There is no setting for this and no public hook, so we block the existing
 * handlers for that signal and attach our own. Blocking (rather than
 * disconnecting) means the shell's handler is untouched and comes back
 * intact the moment we unblock, which matters because we do not own it.
 *
 * If the GObject call is unavailable we leave the Super key alone and say
 * so, rather than half-working.
 */

import GObject from 'gi://GObject';

export class SuperKeyHandler {
    constructor(callback) {
        this._callback = callback;
        this._blocked = false;
        this._handlerId = 0;

        const [found, signalId] = GObject.signal_parse_name(
            'overlay-key', global.display.constructor.$gtype, true);
        if (!found) {
            this.available = false;
            return;
        }
        this._signalId = signalId;

        try {
            GObject.signal_handlers_block_matched(global.display,
                GObject.SignalMatchType.ID, signalId, 0, null, null, null);
            this._blocked = true;
        } catch (e) {
            // Without the block the Overview would open underneath us.
            log(`win11-taskbar: leaving the Super key to GNOME (${e.message})`);
            this.available = false;
            return;
        }

        // Connected after the block, so this one still fires.
        this._handlerId = global.display.connect('overlay-key',
            () => this._callback());
        this.available = true;
    }

    destroy() {
        if (this._handlerId) {
            global.display.disconnect(this._handlerId);
            this._handlerId = 0;
        }
        if (this._blocked) {
            GObject.signal_handlers_unblock_matched(global.display,
                GObject.SignalMatchType.ID, this._signalId, 0, null, null, null);
            this._blocked = false;
        }
        this._callback = null;
    }
}
