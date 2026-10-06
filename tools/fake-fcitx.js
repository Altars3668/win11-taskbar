#!/usr/bin/gjs -m
/* 隔离总线上的输入法模型；不连接或修改真实 Fcitx。
 *
 * --late takes the bus name at once but answers only 1.5 s later, as Fcitx
 * does while it starts with the session.
 */
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const late = ARGV.includes('--late');
let current = 'keyboard-us';
let groupMethods = ['keyboard-us', 'rime'];
const xml = `<node><interface name="org.fcitx.Fcitx.Controller1">
<method name="CurrentInputMethodGroup"><arg type="s" direction="out"/></method>
<method name="InputMethodGroupInfo"><arg type="s" direction="in"/><arg type="s" direction="out"/><arg type="a(ss)" direction="out"/></method>
<method name="AvailableInputMethods"><arg type="a(ssssssb)" direction="out"/></method>
<method name="CurrentInputMethod"><arg type="s" direction="out"/></method>
<method name="SetCurrentIM"><arg type="s" direction="in"/></method>
<method name="Configure"/>
<method name="TestSetGroupMethods"><arg type="as" direction="in"/></method>
</interface></node>`;
const controller = {
    CurrentInputMethodGroup() { return 'Test'; },
    InputMethodGroupInfo() { return ['us', groupMethods.map(id => [id, ''])]; },
    // The fields and values real Fcitx 5 gives: unique name, name, native
    // name, icon, label, language, configurable.
    AvailableInputMethods() {
        return [['keyboard-us', 'Keyboard - English (US)', '', 'input-keyboard', 'en', 'en', true],
            ['rime', 'Rime', '', 'fcitx-rime', 'ㄓ', 'zh', true],
            ['pinyin', 'Pinyin', '拼音', 'fcitx-pinyin', '拼', 'zh_CN', true]];
    },
    CurrentInputMethod() { return current; },
    SetCurrentIM(id) { current = id; },
    Configure() {},
    // Test only: change the group, as the user would in Fcitx's settings.
    TestSetGroupMethods(ids) { groupMethods = ids; },
};
const exported = Gio.DBusExportedObject.wrapJSObject(xml, controller);
Gio.bus_own_name(Gio.BusType.SESSION, 'org.fcitx.Fcitx5', Gio.BusNameOwnerFlags.NONE,
    connection => {
        if (!late) {
            exported.export(connection, '/controller');
            return;
        }
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
            exported.export(connection, '/controller');
            return GLib.SOURCE_REMOVE;
        });
    },
    () => print('READY'), () => {});
new GLib.MainLoop(null, false).run();
