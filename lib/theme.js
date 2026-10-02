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
let _own = null;

function settings() {
    if (!_settings) {
        _settings = new Gio.Settings({
            schema_id: 'org.gnome.desktop.interface',
        });
    }
    return _settings;
}

/**
 * Give the module the extension's own settings, so the user can pin the
 * appearance to light or dark instead of following the desktop.
 *
 * @param {Gio.Settings} extensionSettings the extension's settings
 */
export function setExtensionSettings(extensionSettings) {
    _own = extensionSettings;
}

/** True when the taskbar should render dark. */
export function isDark() {
    const choice = _own?.get_string('theme') ?? 'auto';
    if (choice === 'light')
        return false;
    if (choice === 'dark')
        return true;
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
    _own = null;
}
