// 只验证生命周期与接口状态；真实布局/输入另由 Python + headless Shell 验证。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

class Actor {
    constructor(...args) {
        this.children = []; this.handlers = new Map(); this.styles = new Set();
        this.nextId = 1; this.alive = true;
        this._init(...args);
    }
    _init(params = {}) { Object.assign(this, params); this.styles = new Set((params.style_class ?? '').split(' ')); }
    get_children() { return [...this.children]; }
    get_first_child() { return this.children[0]; }
    get_parent() { return this.parent; }
    add_child(child) { assert(!child.parent); this.children.push(child); child.parent = this; }
    remove_child(child) { this.children.splice(this.children.indexOf(child), 1); child.parent = null; }
    insert_child_at_index(child, index) { assert(!child.parent); this.children.splice(index, 0, child); child.parent = this; }
    set_child(child) { for (const old of this.get_children()) this.remove_child(old); if (child) this.add_child(child); }
    add_style_class_name(name) { this.styles.add(name); }
    remove_style_class_name(name) { this.styles.delete(name); }
    has_style_class_name(name) { return this.styles.has(name); }
    connect(signal, cb) { const id = this.nextId++; this.handlers.set(id, {signal, cb}); return id; }
    disconnect(id) { this.handlers.delete(id); }
    destroy() { for (const {signal, cb} of [...this.handlers.values()]) if (signal === 'destroy') cb(); this.alive = false; }
    get_transformed_position() { return [this.x ?? 0, this.y ?? 0]; }
    get_transformed_size() { return [this.width ?? 24, this.height ?? 24]; }
    set_pivot_point(x, y) { this.pivot = [x, y]; }
    set_position(x, y) { this.x = x; this.y = y; }
    set_scale(x, y) { this.scale = [x, y]; }
    ease(params) { this.lastEase = params; }
}
function load(file, exports, extra = {}) {
    const source = fs.readFileSync(new URL(`../lib/${file}`, import.meta.url), 'utf8')
        .replace(/^import .*;\n/gm, '').replace(/export (class|function)/g, '$1');
    return vm.runInNewContext(`${source}\n;({${exports.join(',')}})`, {
        Clutter: {Orientation: {VERTICAL: 1}, ActorAlign: {CENTER: 1}, AnimationMode: {EASE_OUT_QUART: 1}},
        GObject: {registerClass: (...args) => args.at(-1)},
        St: {Widget: Actor, BoxLayout: Actor, Bin: Actor}, ...extra,
    });
}
let passed = 0;
function check(label, run) { run(); passed++; console.log(`ok ${label}`); }

const {QuickTileLayout} = load('quickTileLayout.js', ['QuickTileLayout']);
const grid = new Actor();
const metas = new Map();
grid.layout_manager = {nColumns: 2, get_child_meta: (_g, child) => {
    if (!metas.has(child)) metas.set(child, {columnSpan: 2});
    return metas.get(child);
}};
const plain = new Actor({style_class: 'slider'});
grid.add_child(plain);
const layout = new QuickTileLayout(grid);
layout.apply();
plain.destroy();
check('销毁非开关项目后跨度缓存清除', () => assert.equal(layout._spans.size, 0));
grid.remove_child(plain);

const tile = new Actor({style_class: 'quick-toggle'});
tile._box = new Actor(); tile._icon = new Actor(); tile._title = new Actor(); tile._subtitle = new Actor();
const labels = new Actor(); labels.add_child(tile._title); labels.add_child(tile._subtitle);
tile._box.add_child(tile._icon); tile._box.add_child(labels); tile.set_child(tile._box); grid.add_child(tile);
layout.apply();
const extra = new Actor(); tile._box.add_child(extra);
layout.destroy();
check('停用后保留原生动态添加的节点', () => {
    assert.equal(extra.get_parent(), tile._box);
    assert.deepEqual(tile._box.get_children(), [tile._icon, labels, extra]);
});
check('停用后恢复原列数和跨度', () => {
    assert.equal(grid.layout_manager.nColumns, 2); assert.equal(metas.get(tile).columnSpan, 2);
});

const mapping = new Set();
const {WindowMotion} = load('windowMotion.js', ['WindowMotion'], {
    GLib: {get_monotonic_time: () => 100}, Meta: {WindowType: {NORMAL: 0}},
    Shell: {WindowTracker: {get_default: () => ({get_window_app: w => w.app})}},
    Main: {wm: {_mapping: mapping}}, global: {window_manager: {connect_after: () => 1, disconnect() {}}},
});
const app = {get_id: () => 'app', get_n_windows: () => 1};
const source = x => new Actor({x, y: 20, width: 24, height: 24});
function windowActor() {
    const actor = new Actor();
    actor.meta_window = {app, get_window_type: () => 0,
        get_buffer_rect: () => ({x: 50, y: 60, width: 400, height: 300}),
        get_compositor_private: () => actor.alive ? actor : null};
    mapping.add(actor); return actor;
}
const motion = new WindowMotion();
motion.remember(app, source(100), true); motion.remember(app, source(200), true);
const a = windowActor(), b = windowActor(); motion._onMap(a); motion._onMap(b);
check('同应用多次新建窗口按票据顺序使用来源', () => {
    assert.equal(a._w11LaunchOrigin.x, 100); assert.equal(b._w11LaunchOrigin.x, 200);
});
let completed = 0;
a.ease({opacity: 255, scale_x: 1, scale_y: 1, duration: 240, onStopped: () => completed++});
a.lastEase.onStopped(false);
check('动画中断仍恢复目标位置并交还一次完成回调', () => {
    assert.equal(completed, 1); assert.equal(a.x, 50); assert.equal(a.y, 60);
});
b.destroy();
check('销毁未启动动画的窗口时清除强引用缓存', () => assert.equal(motion._wrapped.size, 0));

motion.remember(app, source(300), true); const c = windowActor(); motion._onMap(c);
const prior = c.ease; const later = params => prior(params); c.ease = later;
motion.destroy();
check('停用不抹掉其他扩展后来附加的动画包装', () => assert.equal(c.ease, later));
c.ease({opacity: 255, scale_x: 1, scale_y: 1, duration: 240});
check('停用后的包装只转发，不再改变起点', () => assert.equal(c._w11LaunchAnimationApplied, undefined));
console.log(`${passed} 项生命周期检查通过，0 项失败`);
