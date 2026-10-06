/* 材质只采样壁纸和应用窗口，不读取含自身 UI 的上一帧。
 * 阴影留在独立宿主上；隐藏材质不监听每帧绘制，也不保留窗口克隆。
 */
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

/*
 * Rounds the material's corners. The effect renders the actor into a texture
 * larger than the actor: mutter rounds the actor's box to whole pixels and
 * grows it by 3px — ceil(width + 0.75) on the right, the rest on the left
 * (_clutter_actor_box_enlarge_for_effects) — so a texture coordinate is not
 * a fraction of the actor. Map it back to the actor's own coordinates
 * first, or the corners land ~2px outside the actor and are barely cut,
 * which shows wherever the backdrop differs from what is behind the popup.
 * The mask also stops one border width inside the edge: St paints the
 * tint's background inside its border, so the backdrop must not reach the
 * border either.
 */
const RoundedMaterial = GObject.registerClass(
class RoundedMaterial extends Shell.GLSLEffect {
    _init() {
        super._init();
        this._sizeUniform = this.get_uniform_location('w11_size');
        this._radiusUniform = this.get_uniform_location('w11_radius');
        this._originUniform = this.get_uniform_location('w11_origin');
        this._extentUniform = this.get_uniform_location('w11_extent');
        this._insetUniform = this.get_uniform_location('w11_inset');
        this.update(1, 1, 0, 0);
    }

    vfunc_build_pipeline() {
        this.add_glsl_snippet(Cogl.SnippetHook.FRAGMENT,
            'uniform vec2 w11_size; uniform float w11_radius; uniform vec2 w11_origin; ' +
            'uniform vec2 w11_extent; uniform float w11_inset;', `
            vec2 pos = w11_origin + cogl_tex_coord_in[0].xy * w11_extent;
            float radius = max(w11_radius - w11_inset, 0.0);
            vec2 q = abs(pos - w11_size * 0.5) - (w11_size * 0.5 - vec2(w11_inset + radius));
            float d = length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - radius;
            cogl_color_out *= 1.0 - smoothstep(-0.5, 0.5, d);
        `, false);
    }

    update(width, height, radius, inset) {
        const extentX = Math.round(width) + 3;
        const extentY = Math.round(height) + 3;
        this.set_uniform_float(this._sizeUniform, 2, [width, height]);
        this.set_uniform_float(this._radiusUniform, 1, [radius]);
        this.set_uniform_float(this._originUniform, 2,
            [Math.ceil(width + 0.75) - extentX, Math.ceil(height + 0.75) - extentY]);
        this.set_uniform_float(this._extentUniform, 2, [extentX, extentY]);
        this.set_uniform_float(this._insetUniform, 1, [inset]);
    }
});

export function contactShadow() {
    return new St.Widget({style_class: 'w11-contact-shadow', x_expand: true,
        y_expand: true, reactive: false});
}

export const AcrylicSurface = GObject.registerClass(
class AcrylicSurface extends St.Widget {
    _init(radius, enabled = true, tintClass = 'w11-surface-material') {
        super._init({layout_manager: new Clutter.BinLayout(),
            x_expand: true, y_expand: true, reactive: false, clip_to_allocation: true});
        this._backdrop = new Clutter.Actor({clip_to_allocation: true,
            x_expand: true, y_expand: true, reactive: false});
        this._clones = new Map();
        this._paintId = 0;
        this._cornerRadius = tintClass === 'w11-taskbar-material' ? 0 : 8;
        this.add_child(this._backdrop);
        this._tint = new St.Widget({style_class: tintClass, x_expand: true,
            y_expand: true, reactive: false, clip_to_allocation: true});
        this.add_child(this._tint);
        this._backdrop.add_effect_with_name('w11-scene-blur', new Shell.BlurEffect({
            radius, brightness: 1, mode: Shell.BlurMode.ACTOR}));
        if (this._cornerRadius) {
            this._mask = new RoundedMaterial();
            this.add_effect_with_name('w11-rounded-material', this._mask);
        }
        this.connect('notify::mapped', () => this._syncSubscription());
        this.connect('notify::allocation', () => {
            const [width, height] = this.get_size();
            const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
            // The tint's border is 1px; see RoundedMaterial.
            if (width > 0 && height > 0)
                this._mask?.update(width, height, this._cornerRadius * scale, scale);
        });
        this.connect('destroy', () => {
            if (this._paintId)
                global.stage.disconnect(this._paintId);
            this._paintId = 0;
            this._clearScene();
        });
        this.setEnabled(enabled);
    }

    // 背景克隆是绘制数据，不是布局内容；否则屏幕大小会反向撑大 PopupMenu。
    vfunc_get_preferred_width() {
        return [0, 0];
    }

    vfunc_get_preferred_height() {
        return [0, 0];
    }

    setEnabled(enabled) {
        this._backdrop.visible = enabled;
        this._syncSubscription();
    }

    _syncSubscription() {
        if (this.mapped && this._backdrop.visible) {
            if (!this._paintId)
                this._paintId = global.stage.connect('before-paint', () => this._syncScene());
        } else {
            if (this._paintId)
                global.stage.disconnect(this._paintId);
            this._paintId = 0;
            this._clearScene();
        }
    }

    _clearScene() {
        for (const [source, record] of this._clones) {
            source.disconnect(record.destroyId);
            record.clone.destroy();
        }
        this._clones.clear();
    }

    _syncScene() {
        if (!this.mapped || !this._backdrop.visible)
            return;
        const [x, y] = this.get_transformed_position();
        const [width, height] = this.get_transformed_size();
        const intersects = source => {
            const [sx, sy] = source.get_transformed_position();
            const [sw, sh] = source.get_transformed_size();
            return sx < x + width && sx + sw > x && sy < y + height && sy + sh > y;
        };
        // Meta.WindowGroup 有特殊剔除语义，不能整体克隆；保留窗口真实叠放顺序。
        const actors = global.get_window_actors().filter(actor => actor.visible &&
            actor.meta_window.showing_on_its_workspace() && intersects(actor));
        const byWindow = new Map(actors.map(actor => [actor.meta_window, actor]));
        const sources = [
            ...Main.layoutManager._bgManagers.map(manager => manager.backgroundActor)
                .filter(actor => actor && intersects(actor)),
            ...global.display.sort_windows_by_stacking([...byWindow.keys()]).map(win => byWindow.get(win)),
        ];
        const keep = new Set(sources);
        for (const [source, record] of this._clones) {
            if (!keep.has(source)) {
                source.disconnect(record.destroyId);
                record.clone.destroy();
                this._clones.delete(source);
            }
        }
        sources.forEach((source, index) => {
            let record = this._clones.get(source);
            if (!record) {
                const clone = new Clutter.Clone({source, reactive: false});
                record = {clone, rect: []};
                record.destroyId = source.connect('destroy', () => {
                    this._clones.delete(source);
                    clone.destroy();
                });
                this._backdrop.add_child(clone);
                this._clones.set(source, record);
            }
            const [sx, sy] = source.get_transformed_position();
            const [sw, sh] = source.get_transformed_size();
            const rect = [Math.round(sx - x), Math.round(sy - y), sw, sh, source.get_paint_opacity()];
            // 不对未变的演员反复赋值/重排，避免 before-paint 制造新的整屏重绘。
            if (rect.some((value, i) => value !== record.rect[i])) {
                record.clone.set_position(rect[0], rect[1]);
                record.clone.set_size(sw, sh);
                record.clone.opacity = rect[4];
                record.rect = rect;
            }
            if (this._backdrop.get_child_at_index(index) !== record.clone)
                this._backdrop.set_child_at_index(record.clone, index);
        });
    }
});

/** PopupMenu 的原生 box 是借来的；停用时应完整归还，不能级联销毁它。 */
export class PopupSurface {
    constructor(menu, settings, radius) {
        this._menu = menu;
        this._settings = settings;
        this.surface = new AcrylicSurface(radius, settings.get_boolean('acrylic'));
        this._wrapper = new St.Widget({style_class: 'w11-flyout-shadow',
            layout_manager: new Clutter.BinLayout(), x_expand: true, y_expand: true});
        menu._boxPointer.bin.set_child(null);
        this._wrapper.add_child(contactShadow());
        this._wrapper.add_child(this.surface);
        this._wrapper.add_child(menu.box);
        menu.box.add_style_class_name('w11-surface-content');
        menu._boxPointer.bin.set_child(this._wrapper);
        menu._w11Material = this.surface;
        this._settingsId = settings.connect('changed::acrylic', () =>
            this.surface.setEnabled(settings.get_boolean('acrylic')));
        this._destroyId = menu.actor.connect('destroy', () => this._disconnect());
    }

    _disconnect() {
        if (this._settingsId)
            this._settings.disconnect(this._settingsId);
        this._settingsId = 0;
        this._destroyId = 0;
    }

    destroy() {
        if (this._destroyId)
            this._menu.actor.disconnect(this._destroyId);
        this._disconnect();
        this._wrapper.remove_child(this._menu.box);
        this._menu.box.remove_style_class_name('w11-surface-content');
        this._menu._boxPointer.bin.set_child(this._menu.box);
        this._wrapper.destroy();
        delete this._menu._w11Material;
        this.surface = null;
        this._wrapper = null;
    }
}
