/* 把用户启动的窗口动画锚定到实际图标；仍由 GNOME 完成 map 生命周期。 */
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import * as Windows from './windows.js';

let current = null;

export function noteLaunch(app, actor, newWindow = false) {
    current?.remember(app, actor, newWindow);
}

export class WindowMotion {
    constructor() {
        this._pending = new Map();
        this._wrapped = new Map();
        current = this;
        this._mapId = global.window_manager.connect_after('map', (_wm, actor) => this._onMap(actor));
    }

    remember(app, actor, newWindow) {
        const now = GLib.get_monotonic_time();
        for (const [id, tickets] of this._pending) {
            const alive = tickets.filter(ticket => ticket.expires >= now);
            if (alive.length)
                this._pending.set(id, alive);
            else
                this._pending.delete(id);
        }
        const id = app.get_id();
        const tickets = this._pending.get(id) ?? [];
        // 普通激活已有窗口不生成票据；连续点击正在启动的应用也不应覆盖第一次。
        if (!newWindow && (app.get_n_windows() > 0 || tickets.length > 0))
            return;
        const [x, y] = actor.get_transformed_position();
        const [width, height] = actor.get_transformed_size();
        if (width <= 0 || height <= 0)
            return;
        tickets.push({x, y, width, height, expires: now + 20_000_000});
        this._pending.set(id, tickets);
    }

    _onMap(actor) {
        const win = actor.meta_window;
        const app = Windows.windowApp(win);
        const tickets = app && this._pending.get(app.get_id());
        if (!tickets || win.get_window_type() !== Meta.WindowType.NORMAL)
            return;
        const ticket = tickets.shift();
        if (!tickets.length)
            this._pending.delete(app.get_id());
        if (!ticket || ticket.expires < GLib.get_monotonic_time() || !Main.wm._mapping.has(actor))
            return;

        const original = actor.ease;
        const ownedEase = Object.hasOwn(actor, 'ease');
        let active = true;
        let destroyId = 0;
        let wrapper;
        const restore = () => {
            if (!active)
                return;
            active = false;
            // 不删除其他扩展后来附加的包装；保留在链中的本包装会变成纯转发。
            if (actor.ease === wrapper) {
                if (ownedEase)
                    actor.ease = original;
                else
                    delete actor.ease;
            }
            if (destroyId)
                actor.disconnect(destroyId);
            destroyId = 0;
            this._wrapped.delete(actor);
        };
        this._wrapped.set(actor, restore);
        destroyId = actor.connect('destroy', () => {
            destroyId = 0;
            restore();
        });
        actor._w11LaunchOrigin = {x: ticket.x, y: ticket.y, width: ticket.width, height: ticket.height};
        wrapper = params => {
            if (!active || !Main.wm._mapping.has(actor) || params.scale_x !== 1 ||
                params.scale_y !== 1 || params.opacity !== 255)
                return original.call(actor, params);
            const rectangle = win.get_buffer_rect();
            restore();
            if (!rectangle.width || !rectangle.height)
                return original.call(actor, params);
            actor.set_pivot_point(0, 0);
            actor.set_position(ticket.x, ticket.y);
            actor.set_scale(ticket.width / rectangle.width, ticket.height / rectangle.height);
            actor._w11LaunchAnimationApplied = true;
            return original.call(actor, {
                ...params,
                x: rectangle.x,
                y: rectangle.y,
                duration: Math.min(params.duration ?? 200, 200),
                mode: Clutter.AnimationMode.EASE_OUT_QUART,
                onStopped: (...args) => {
                    if (win.get_compositor_private()) {
                        const finalRect = win.get_buffer_rect();
                        actor.set_position(finalRect.x, finalRect.y);
                    }
                    params.onStopped?.(...args);
                },
            });
        };
        actor.ease = wrapper;
    }

    destroy() {
        global.window_manager.disconnect(this._mapId);
        for (const restore of [...this._wrapped.values()])
            restore();
        this._pending.clear();
        if (current === this)
            current = null;
    }
}
