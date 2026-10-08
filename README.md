# win11-taskbar · GNOME 的 Windows 11 风格任务栏

**简体中文** | [English](README.en.md)

为 **GNOME Shell 50** 提供任务栏、开始菜单、搜索、系统托盘、快捷设置、通知中心和窗口贴靠的独立扩展。这个项目不只是换图标或主题：我按真实 Windows 11 的布局和交互测量，重做了应用按钮、窗口浮层、系统图标和贴靠操作，同时保留 GNOME 的网络、音频、亮度和电源后端。

> 不是 Microsoft 产品、Windows 兼容层或 GNOME 本体 fork。扩展包不会替换 GTK、Mutter 或内核；系统级右键行为补丁是另外的可选组件。

[![Build](https://github.com/Altars3668/win11-taskbar/actions/workflows/build.yml/badge.svg)](https://github.com/Altars3668/win11-taskbar/actions/workflows/build.yml)

## 我的实现与特色

| 方向 | 已实现内容 |
| --- | --- |
| **任务栏布局与应用行为** | 居中 / 左对齐、固定及运行应用、四条屏幕边缘、自动 / 手动粗细、自动隐藏、多显示器 / 工作区；应用过多时先缩搜索，再滚动应用条，不覆盖系统控件。 |
| **开始与搜索** | Start 固定项、应用文件夹、可过滤的推荐、账户 / 电源菜单；独立搜索支持应用、最近文件和文件夹，Start 关闭时也可使用；搜索按钮与 Start 均有自动布局。 |
| **窗口预览与效果** | 实时缩略图、Aero Peek、跳转列表、注意闪烁、打开 / 关闭 / 最小化 / 还原动画、圆角与阴影。 |
| **统一的贴靠体验** | `Super+Z`、最大化按钮悬停、顶部布局条、边缘 / 角落贴靠及 snap assist，使用一致的预览。 |
| **托盘与系统图标** | StatusNotifierItem / DBusMenu、逐应用溢出选择、箭头随浮层开合旋转；正常有线连接使用显示器图标，保留其他网络状态；网络 / 音量 / 电池共用一个按钮和悬停背景。 |
| **快捷设置与通知分离** | 开关与箭头连接式卡片、功能子页、音量 / 亮度滑条；通知卡片与日历独立，不再与快捷设置混在同一面板。 |
| **输入与桌面操作** | GNOME / Fcitx 5 输入切换、剪贴板历史、显示桌面分隔线及点击 / 悬停行为。 |
| **可选 GTK 外观** | 用户主动开启后设置 Windows 风格标题栏和 Mica，关闭时移除自己的 CSS 块并恢复布局，不默认接管系统库。 |
| **系统右键行为补丁** | 独立的 GTK 3 / 4 与 Mutter 补丁处理“松开才弹”和“点外关闭但点击仍送达”；仅装扩展不意味着这些补丁已安装。 |
| **测量与回归** | 保存 Windows 测量、独立 GNOME 测试桌面与可重复安装 ZIP 的校验；区分纯逻辑、打包和完整 UI 的证据。 |

实现与行为边界见 [docs/behavior.md](docs/behavior.md)、[docs/windows-spec.md](docs/windows-spec.md) 和 [patches/README.md](patches/README.md)。

## 兼容性

- 声明支持 **GNOME Shell 50**，不把 48 / 49 当作已经验证的兼容版本。
- 主要测试环境是 Wayland，窗口框回归也包含 Xwayland；硬件相关控制取决于 GNOME 服务提供的能力。
- 没有电池的桌面不补放一个关机图标；系统图标合并规则与 Windows 11 的交互模型保持一致。
- 扩展不能改变所有应用内部的右键菜单。GTK / Mutter 补丁另行评估、构建和安装，会影响系统 GUI，应留回滚方案。

## 安装

### 使用已发布 ZIP

从 [Releases](https://github.com/Altars3668/win11-taskbar/releases) 下载与目标 GNOME 版本匹配的 `win11-taskbar@altarscn.com.shell-extension.zip` 和 `SHA256SUMS`。当前版本为 `v0.2.0`；保留 `v0.1.0` 的标签和附件，不覆盖旧版本产物。

```sh
sha256sum --check SHA256SUMS
gnome-extensions install --force win11-taskbar@altarscn.com.shell-extension.zip
# 注销并重新登录后启用；不要在工作中强行重启桌面
gnome-extensions enable win11-taskbar@altarscn.com
```

### 从源码安装

```sh
git clone https://github.com/Altars3668/win11-taskbar.git
cd win11-taskbar
make install
# 新安装或更新 JavaScript 后，注销并重新登录
gnome-extensions enable win11-taskbar@altarscn.com
```

需要 `make` 和 `glib-compile-schemas`（Debian / Ubuntu 的 `libglib2.0-bin`）。安装 / 启用是用户主动操作，本文档维护不重启或修改正在使用的桌面。

## 冲突与设置

主任务栏与 `org.kde.StatusNotifierWatcher` 都只能有一个主要提供方：

- 避免与 Dash to Panel、Dash to Dock、Ubuntu Dock 同时使用；如由本扩展管理托盘，应停用其他 AppIndicator 实现。
- Tiling Assistant 启用时保留它的边缘拖动处理；停用后才由本扩展统一接管。
- Blur my Shell 的弹出层模糊可能造成圆角黑边，出现时关闭对应模糊选项。
- `tools/enable.sh` 默认仅预览切换，`--apply` 才改变冲突扩展；`tools/disable.sh` 可恢复记录。先读脚本再执行。

```sh
gnome-extensions prefs win11-taskbar@altarscn.com
```

设置覆盖布局、对齐、粗细、搜索、托盘、开始菜单、主题、快捷键和窗口效果。GTK 标题栏 / Mica 默认关闭；开启会改用户 GTK CSS 和窗口按钮布局，现有应用通常需重启。GTK 3 无法按应用深色主题区分 Mica 强度，属于明确限制。

**自动尺寸与升级：** 默认按每个显示器的逻辑尺寸选择 40 / 48 / 56 像素任务栏、搜索框 / 图标加文字 / 图标，以及六列 / 八列 Start。1080p 与 4K、200% 缩放的逻辑布局一致；这些自动阈值是项目策略，不是 Windows 实测值。已有明确保存的手动粗细、搜索样式和 Start 布局不会被新默认值覆盖，派生尺寸也不回写设置。

**独立搜索与推荐：** `Super+S` 或搜索按钮打开本地浮层，支持 Esc、方向键和回车。只搜索应用及 XBEL 记录中的最近文件 / 文件夹，不全盘扫描、不联网、不保存查询历史。推荐可按文件 / 文件夹、包含 / 排除目录、类型、扩展名、访问时间和数量过滤，关闭后空间交给固定项。空目录或类型白名单表示不限制；排除优先，软链接的原路径和目标都必须通过目录规则。隐藏项目默认不推荐，非本地 URI、无权读取或消失的条目跳过；未知访问时间只在“不限时间”中出现。Start 推荐过滤不会把显式搜索或应用跳转列表变成全局黑名单。

## 常用快捷键

| 快捷键 | 作用 |
| --- | --- |
| `Super` / `Super+Z` | 开始 / 贴靠布局。 |
| `Super+S` | 独立本地搜索；可在偏好中改键或关闭。 |
| `Super+A` / `Super+N` | 快捷设置 / 通知中心。 |
| `Super+X` / `Super+V` | 快速链接 / 剪贴板历史。 |
| `Super+D` | 显示桌面。 |
| `Super+Space` / `Shift+Super+Space` | 下一 / 上一输入法。 |
| `Super+E` / `Super+I` / `Super+R` | 文件 / 设置 / 运行。 |
| `Super+T` / `Super+1…9` | 遍历 / 激活任务栏应用。 |

停用扩展会恢复接管的绑定；部分快捷键可关闭。鼠标的 `Ctrl+点击` 循环窗口，`Shift+点击` / 中键打开新窗口，右键打开跳转列表。

## 构建与验证

```sh
make check         # 语法、纯逻辑、schema、应用排序；不启动桌面
make test-package  # ZIP 结构、双语文档、校验和、确定性与打包安全
make pack          # dist/ 下的安装 ZIP 与 SHA256SUMS
```

需要 Node.js 22+、Python 3、GJS、`glib-compile-schemas`、ICU `uconv`。源码包打包时同时包含中文首页、英文版与旧中文入口，不让安装 ZIP 的语言切换链接断掉。

[GitHub Actions](.github/workflows/build.yml) 做可移植检查与打包，**不等于 GNOME 50 的完整图形验收**。独立无头 UI 测试及模拟网络 / 音频控制见 [docs/development.md](docs/development.md)；它们与真实设备或桌面效果的验证分开。新版本 Release 需更新 `metadata.json` 并推匹配的版本标签。

## 已知限制与来源

不宣称每个 Windows 版本逐像素一致；没有新闻 / 小组件或每日搜索图片，未实现拖动重排任务栏应用按钮。最大化按钮悬停只识别适配的 GTK、Chromium / Electron 等几何布局，其他自绘标题栏不保证有效；建议贴靠分组和某些拖动效果也未完全复刻。

GTK 4 最大化标题栏已移除扩展可控的 padding / margin；Edge / Chromium 的自绘圆按钮仍可能保留客户端自己的边距，扩展不会裁剪整窗或覆盖假的关闭按钮。Mica 的目标分类排除已知自绘浏览器 / Electron / Qt 渲染器，不能仅因其加载 GTK 库就给整窗套材质；该分类不是对任意自定义工具包的保证。

本项目由 Altars3668 维护，利用 GNOME / GJS 的系统接口而不是复制 Windows 实现。采用 [GPL-3.0-or-later](LICENSE)，保留各组件授权声明；Microsoft / Windows 商标属于相应权利人，没有官方隶属或背书关系。
