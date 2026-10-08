/* 显示桌面、各显示器的窗口预览共用透明度记录，不把其他 Peek 的结果当原始值。 */
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {duration, DURATION, EASE} from './motion.js';
import {PeekState} from './peekState.js';

let state = null;

function controller() {
    state ??= new PeekState({
        alive: actor => actor.get_parent() !== null,
        busy: actor => Main.wm._mapping.has(actor) || Main.wm._minimizing.has(actor) ||
            Main.wm._unminimizing.has(actor) || Main.wm._destroying.has(actor),
        transition: actor => actor.get_transition('opacity'),
        track: (actor, drop) => {
            let id = actor.connect('destroy', () => {
                id = 0;
                drop();
            });
            return () => {
                if (id)
                    actor.disconnect(id);
                id = 0;
            };
        },
        fade: (actor, opacity, done, immediate) => {
            // 状态机先确认当前过渡属于自己；绝不取消窗口的 scale／position。
            actor.remove_transition('opacity');
            const ms = immediate ? 0 : duration(DURATION.normal);
            if (ms === 0) {
                actor.opacity = opacity;
                done();
                return null;
            }
            actor.ease({opacity, duration: ms, mode: EASE, onComplete: done});
            return actor.get_transition('opacity');
        },
    });
    return state;
}

export function setWindowPeek(owner, actors, opacity = 0) {
    controller().set(owner, actors, opacity);
}

export function clearWindowPeek(owner, immediate = false) {
    state?.clear(owner, immediate);
}

export function clearAllWindowPeeks() {
    state?.clearAll();
    state = null;
}

/** 只供关闭的诊断接口测试自己的窗体，不用于记录用户窗口内容。 */
export function peekWindows() {
    return [...state?.records ?? []].map(([actor, record]) => ({
        title: actor.meta_window?.get_title() ?? null,
        base: record.base, target: record.target, opacity: actor.opacity,
        owners: record.requests.size,
    }));
}
