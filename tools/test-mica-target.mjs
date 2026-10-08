/* 浏览器加载 GTK 只用于平台集成，不能据此给整窗加 Mica。 */
import assert from 'node:assert/strict';
import {gtkMicaTarget} from '../lib/micaTarget.js';
assert(gtkMicaTarget({gtkApplicationId: 'org.gnome.TextEditor'}));
assert(gtkMicaTarget({wmClass: 'ctxprobe3'}, '/usr/lib/libgtk-3.so.0'));
assert(gtkMicaTarget({wmClass: 'ctxprobe4'}, '/usr/lib/libgtk-4.so.1'));
for (const wmClass of ['microsoft-edge', 'Google-chrome', 'Chromium', 'Firefox', 'code-insiders', 'brave-browser'])
    assert(!gtkMicaTarget({wmClass}, '/usr/lib/libgtk-3.so.0'), wmClass);
assert(!gtkMicaTarget({gtkApplicationId: 'org.example.App'}, '/opt/app/libcef.so /usr/lib/libgtk-3.so.0'));
assert(!gtkMicaTarget({wmClass: 'SomeElectronApp'}, '/opt/app/electron\n/usr/lib/libgtk-3.so.0'));
assert(!gtkMicaTarget({wmClass: 'QtApp'}, '/usr/lib/libQt6Gui.so.6\n/usr/lib/libgtk-3.so.0'));
assert(!gtkMicaTarget({wmClass: 'Other'}));
console.log('Mica 目标分类：GTK 正例与浏览器/Qt 反例通过，0 项失败');
