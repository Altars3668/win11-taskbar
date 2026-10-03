/* 保留 GNOME 原有开关和子菜单，只把图标卡片与文字排列成 Windows 的三列布局。 */
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

// St.Button 会按自然尺寸居中子内容，不能靠 min-width 或 x_expand 保证
// 每块卡片相等；和任务按钮一样，用明确的首选尺寸与分配避免宽度随标题变化。
const QuickCardContent = GObject.registerClass(
class QuickCardContent extends St.Widget {
    _init(card, labels) {
        super._init({x_expand: true, y_expand: true});
        this._card = card;
        this._labels = labels;
        this.add_child(card);
        this.add_child(labels);
    }

    vfunc_get_preferred_width() {
        const width = 96 * St.ThemeContext.get_for_stage(global.stage).scale_factor;
        return [width, width];
    }

    vfunc_get_preferred_height() {
        const height = 84 * St.ThemeContext.get_for_stage(global.stage).scale_factor;
        return [height, height];
    }

    vfunc_allocate(box) {
        this.set_allocation(box);
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const width = box.get_width();
        this._card.allocate(new Clutter.ActorBox({x1: 0, y1: 0,
            x2: width, y2: 48 * scale}));
        this._labels.allocate(new Clutter.ActorBox({x1: 0, y1: 54 * scale,
            x2: width, y2: Math.max(54 * scale, box.get_height())}));
    }
});

export class QuickTileLayout {
    constructor(grid) {
        this._grid = grid;
        this._columns = grid.layout_manager.nColumns;
        this._records = new Map();
        this._spans = new Map();
        grid.layout_manager.nColumns = 3;
    }

    apply() {
        const grid = this._grid;
        const layout = grid.layout_manager;
        for (const tile of grid.get_children()) {
            if (typeof tile.has_style_class_name !== 'function')
                continue;
            const isToggle = tile.has_style_class_name('quick-toggle') ||
                tile.has_style_class_name('quick-toggle-has-menu');
            const meta = layout.get_child_meta(grid, tile);
            if (!this._spans.has(tile)) {
                const destroyId = tile.connect('destroy', () => {
                    this._records.delete(tile);
                    this._spans.delete(tile);
                });
                this._spans.set(tile, {value: meta.columnSpan, destroyId});
            }
            meta.columnSpan = isToggle ? 1 : 3;
            if (isToggle && !this._records.has(tile))
                this._reshape(tile);
        }
    }

    _reshape(tile) {
        const box = tile._box;
        const split = tile.has_style_class_name('quick-toggle-has-menu');
        const contents = split ? box.get_first_child() : tile;
        const contentBox = contents?._box;
        const icon = contents?._icon;
        if (!box || !contentBox || !icon)
            return;
        const labels = contentBox.get_children().find(child => child !== icon);
        if (!labels)
            return;
        const boxes = [...new Set([box, contentBox])].map(actor => ({
            actor, children: actor.get_children(),
        }));
        const labelAlignment = labels.x_align;
        const titleAlignment = contents._title.x_align;
        const subtitleAlignment = contents._subtitle.x_align;
        contentBox.remove_child(labels);
        for (const child of box.get_children())
            box.remove_child(child);

        const card = split
            ? new St.BoxLayout({style_class: 'w11-quick-card w11-quick-split', x_expand: true})
            : new St.Bin({style_class: 'w11-quick-card', x_expand: true});
        if (split) {
            contents.add_style_class_name('w11-quick-control');
            for (const child of boxes[0].children)
                card.add_child(child);
        } else {
            card.set_child(icon);
        }
        card.clip_to_allocation = true;
        labels.x_align = Clutter.ActorAlign.CENTER;
        contents._title.x_align = Clutter.ActorAlign.CENTER;
        contents._subtitle.x_align = Clutter.ActorAlign.CENTER;
        const display = new QuickCardContent(card, labels);
        tile.set_child(display);
        tile._w11Card = card;
        tile._w11Labels = labels;
        tile.add_style_class_name('w11-quick-tile');

        this._records.set(tile, {boxes, display, card, contents, labels, labelAlignment,
            titleAlignment, subtitleAlignment});
    }

    destroy() {
        for (const [tile, record] of this._records) {
            record.display.remove_child(record.card);
            record.display.remove_child(record.labels);
            for (const saved of record.boxes) {
                // 只移动本次接管的节点；保留运行期间由 GNOME 添加的新状态控件。
                saved.children.forEach((child, index) => {
                    child.get_parent()?.remove_child(child);
                    saved.actor.insert_child_at_index(child, index);
                });
            }
            tile.set_child(record.boxes[0].actor);
            record.labels.x_align = record.labelAlignment;
            record.contents._title.x_align = record.titleAlignment;
            record.contents._subtitle.x_align = record.subtitleAlignment;
            record.contents.remove_style_class_name('w11-quick-control');
            tile.remove_style_class_name('w11-quick-tile');
            delete tile._w11Card;
            delete tile._w11Labels;
            record.display.destroy();
            record.card.destroy();
        }
        const liveChildren = new Set(this._grid.get_children());
        for (const [child, span] of this._spans) {
            child.disconnect(span.destroyId);
            if (liveChildren.has(child))
                this._grid.layout_manager.get_child_meta(this._grid, child).columnSpan = span.value;
        }
        this._grid.layout_manager.nColumns = this._columns;
        this._records.clear();
        this._spans.clear();
    }
}
