/* shellShutdown.js — knowing that the shell is exiting.
 *
 * When the shell exits — at logout, never when this extension is disabled —
 * it destroys its whole UI, GNOME's objects and this extension's actors
 * together and in no particular order. A destroy handler that hands
 * something back to GNOME, or destroys an actor that lives elsewhere in the
 * stage, then touches objects that may already be gone. Handlers check
 * shellShuttingDown() and leave those alone: the process is ending anyway.
 *
 * uiGroup's own 'destroy' handlers run before Clutter destroys its
 * children — the signal's class handler, which does that, runs in the
 * cleanup stage — so the flag is up before any of the extension's actors
 * go.
 */
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

let shuttingDown = false;
let watchId = 0;

export function watchShellShutdown() {
    if (watchId || shuttingDown)
        return;
    watchId = Main.layoutManager.uiGroup.connect('destroy', () => {
        shuttingDown = true;
        watchId = 0;
    });
}

export function unwatchShellShutdown() {
    if (watchId)
        Main.layoutManager.uiGroup.disconnect(watchId);
    watchId = 0;
}

/** True once the shell has begun tearing its UI down to exit. */
export function shellShuttingDown() {
    return shuttingDown;
}
