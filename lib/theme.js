/* theme.js — follow the desktop's light/dark preference.
 *
 * The taskbar's own actors get a `dark` style class from the panel, but
 * menus and flyouts are parented to Main.uiGroup instead, so they are not
 * descendants of anything the panel marks. They have to be tagged
 * individually or they keep the shell's default dark menu styling while the
 * taskbar above them is light.
 */

import Gio from 'gi://Gio';

let _settings = null;

function settings() {
    if (!_settings) {
        _settings = new Gio.Settings({
            schema_id: 'org.gnome.desktop.interface',
        });
    }
    return _settings;
}

/** True when the desktop asks for a dark appearance. */
export function isDark() {
    return settings().get_string('color-scheme') === 'prefer-dark';
}

/**
 * Tag an actor with the current appearance.
 *
 * @param {Clutter.Actor} actor the actor to tag
 */
export function applyThemeClass(actor) {
    if (!actor)
        return;
    if (isDark())
        actor.add_style_class_name('dark');
    else
        actor.remove_style_class_name('dark');
}

/** Drop the cached settings object; called when the extension unloads. */
export function cleanup() {
    _settings = null;
}
