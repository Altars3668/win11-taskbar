/* inputSwitcher.js — Win+Space switches input methods, as on Windows.
 *
 * GNOME binds Super+Space to its own input sources, and does nothing at all
 * with fewer than two of them — the case whenever Fcitx does the switching.
 * The taskbar's input indicator knows Fcitx's methods as well as GNOME's
 * sources, so it takes the two bindings over while the extension runs
 * (inputMethodPanel.js: cycle) and hands them back to GNOME's own handler
 * afterwards, exactly as GNOME made them.
 */
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Keyboard from 'resource:///org/gnome/shell/ui/status/keyboard.js';

const BINDINGS = [
    ['switch-input-source', Meta.KeyBindingFlags.NONE, '_keybindingAction'],
    ['switch-input-source-backward', Meta.KeyBindingFlags.IS_REVERSED, '_keybindingActionBackward'],
];

export class InputSwitcher {
    /**
     * @param {Function} button returns the input indicator to switch with
     */
    constructor(button) {
        this._settings = new Gio.Settings({schema_id: 'org.gnome.desktop.wm.keybindings'});
        for (const [name, flags] of BINDINGS) {
            Main.wm.removeKeybinding(name);
            Main.wm.addKeybinding(name, this._settings, flags, Shell.ActionMode.ALL,
                (_display, _window, _event, binding) =>
                    button()?.cycle(binding.is_reversed() ? -1 : 1, binding.get_mask()));
        }
    }

    destroy() {
        const manager = Keyboard.getInputSourceManager();
        for (const [name, flags, field] of BINDINGS) {
            Main.wm.removeKeybinding(name);
            // GNOME's switcher popup cycles by these actions, so its
            // manager keeps them.
            manager[field] = Main.wm.addKeybinding(name, this._settings, flags,
                Shell.ActionMode.ALL, manager._switchInputSource.bind(manager));
        }
    }
}
