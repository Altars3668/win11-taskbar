/* attentionToasts.js — no "is ready" toast when a window asks for attention.
 *
 * GNOME answers a window that demands attention, or is marked urgent, with
 * a notification: the app's name over "“<window title>” is ready". WeChat
 * marks its window urgent for every message it receives, so each message
 * came as a notification that said only that WeChat was ready. Windows has
 * no such toast: the app's taskbar button flashes and stays lit until the
 * window is used, which taskButton.js does. GNOME's handler is unhooked
 * while the extension runs and hooked up again after.
 */
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class AttentionToasts {
    constructor() {
        this._handler = Main.windowAttentionHandler;
        global.display.disconnectObject(this._handler);
    }

    destroy() {
        const handler = this._handler;
        if (!handler)
            return;
        this._handler = null;
        // As GNOME's own constructor connects it.
        global.display.connectObject(
            'window-demands-attention', handler._onWindowDemandsAttention.bind(handler),
            'window-marked-urgent', handler._onWindowDemandsAttention.bind(handler),
            handler);
    }
}
