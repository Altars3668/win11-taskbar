# GNOME Shell 的 Windows 11 风格任务栏

[English](README.md) · **简体中文**

[![构建状态](https://github.com/Altars3668/win11-taskbar/actions/workflows/build.yml/badge.svg)](https://github.com/Altars3668/win11-taskbar/actions/workflows/build.yml)
[![最新版本](https://img.shields.io/github/v/release/Altars3668/win11-taskbar)](https://github.com/Altars3668/win11-taskbar/releases/latest)
[![许可证：GPL-3.0-or-later](https://img.shields.io/badge/license-GPL--3.0--or--later-blue.svg)](LICENSE)

为 **GNOME Shell 50** 提供 Windows 11 风格的任务栏、开始菜单、可配置搜索、窗口预览、系统托盘、快捷设置和窗口贴靠。布局与交互时长来自真实 Windows 11 机器的测量，而不是凭印象模仿。

本项目是独立的 GNOME 扩展，不是微软产品，也不是 Windows 兼容层。网络、音频、亮度和电源操作仍使用 GNOME 的原生后端。

## 主要功能

| 区域 | 功能 |
| --- | --- |
| 任务栏 | 居中或左对齐、固定与运行中的应用、按工作区筛选、多显示器、自动隐藏、支持屏幕四边 |
| 开始与搜索 | 固定应用、应用文件夹、最近文档、账户与电源菜单；搜索可选隐藏、仅图标、图标加文字、搜索框 |
| 窗口 | 实时缩略图、Aero Peek、跳转列表、请求注意时闪烁、Windows 风格打开/最小化/还原动画、圆角与阴影 |
| 窗口贴靠 | `Super+Z`、悬停最大化按钮、拖到上缘布局条、边缘与四角贴靠、贴靠助手 |
| 系统托盘 | StatusNotifierItem 与 DBusMenu、按应用选择折叠、会转动的溢出箭头、可选悬停菜单 |
| 系统控件 | **网络／音量／电池合并为一个按钮**、快捷设置子页、连成一体的开关和箭头、音量与亮度滑条 |
| 通知与输入 | 独立的通知中心与日历、剪贴板历史、GNOME 和 Fcitx 5 输入法切换 |
| 显示桌面 | 任务栏末端可见分隔线，点击最小化／还原窗口，悬停预览桌面 |
| 外观 | 浅色／深色、亚克力材质、可调任务栏粗细；可选 GTK 标题栏与 Mica |

### 熟悉的鼠标行为

| 操作 | 结果 |
| --- | --- |
| 点击尚未运行的应用 | 启动应用 |
| 点击只有一个且未聚焦的窗口 | 激活窗口 |
| 点击只有一个且已聚焦的窗口 | 最小化窗口 |
| 点击有多个窗口的应用 | 打开缩略图浮层 |
| `Ctrl` + 点击 | 循环切换该应用的窗口 |
| `Shift` + 点击或中键 | 打开新窗口 |
| 右键 | 打开跳转列表 |

网络、音量、电池共用悬停和按下背景，与 Windows 11 一致。快捷设置的主开关与箭头共用一张连接式卡片：左侧切换状态，箭头打开子页。没有电池的桌面不会在任务栏额外放一个关机图标。

## 运行要求与兼容性

- **GNOME Shell 50**。本次发布只声明已验证的版本，不宣称支持 GNOME 48／49。
- 主要在 Wayland 环境下测试；窗口框测试也覆盖 Xwayland 应用。
- 网络、声音、亮度、通知和电源功能由 GNOME 服务提供；与硬件有关的控件仅在相应服务提供时显示。
- 扩展不会安装或替换 GTK、Mutter 或 Linux 内核。可选的原生补丁另见 [`patches/README.md`](patches/README.md)。

## 安装

### 使用发布包：推荐

1. 从 [GitHub 最新 Release](https://github.com/Altars3668/win11-taskbar/releases/latest) 下载 `win11-taskbar@altarscn.com.shell-extension.zip` 和 `SHA256SUMS`。
2. 在下载目录校验并安装：

   ```bash
   sha256sum --check SHA256SUMS
   gnome-extensions install --force win11-taskbar@altarscn.com.shell-extension.zip
   ```

3. **注销后重新登录**，再启用扩展：

   ```bash
   gnome-extensions enable win11-taskbar@altarscn.com
   ```

Wayland 会话重新登录后，GNOME 才能发现新扩展并加载更新后的 JavaScript。项目不会自动重启你的桌面，也不会替你关闭应用。

### 从源码安装

```bash
git clone https://github.com/Altars3668/win11-taskbar.git
cd win11-taskbar
make install
# 新安装的扩展请先注销并重新登录，再启用。
gnome-extensions enable win11-taskbar@altarscn.com
```

源码安装需要 `make` 和 `glib-compile-schemas`；Debian／Ubuntu 对应软件包为 `libglib2.0-bin`。Release ZIP 已包含编译后的设置 schema。

### 避免扩展冲突

主任务栏只应由一个扩展绘制；`org.kde.StatusNotifierWatcher` 也只能由一个托盘服务持有。

- 不要同时运行本扩展与 Dash to Panel、Dash to Dock、Ubuntu Dock。
- 如果要用本任务栏接管托盘，请停用 AppIndicator Support／Ubuntu AppIndicators。
- **Tiling Assistant：**它启用时，拖动到屏幕边缘的动作仍交给它。停用后，本扩展才接管统一的边缘预览和贴靠助手。
- **Blur my Shell：**它的弹出层模糊可能与本扩展的圆角亚克力冲突。若看到黑角，请停用其弹出层模糊或停用该扩展。

从源码安装时，可用辅助脚本先查看再执行切换：

```bash
tools/enable.sh          # 仅预览哪些扩展会被停用。
tools/enable.sh --apply  # 执行切换并记录原状态。
tools/disable.sh        # 恢复记录中的扩展。
```

## 设置

在“扩展”应用中打开设置，或运行：

```bash
gnome-extensions prefs win11-taskbar@altarscn.com
```

可调整屏幕边缘、对齐、粗细（32–96px）、自动隐藏、搜索样式、显示元素、托盘折叠、开始菜单布局与文件夹、主题、快捷键、窗口效果，以及多显示器／工作区行为。

**GTK 标题栏与 Mica 默认关闭，需要主动启用。** GTK 标题栏样式会在 GTK 3／4 用户 CSS 中加入带标记的样式块，并更改 GNOME 窗口按钮布局；关闭后移除该块并恢复保存的布局。已有应用通常需重启才会采用新样式。Mica 还依赖 GTK 标题栏样式。GTK 3 的 CSS 无法区分应用的深色主题，因此其 Mica 强度按浅色设置处理。

## 快捷键

`Super` 通常就是键盘上的 Windows／徽标键。

| 快捷键 | 功能 |
| --- | --- |
| `Super` | 开始菜单，可关闭此接管 |
| `Super+Z` | 贴靠布局 |
| `Super+A` | 快捷设置 |
| `Super+N` | 通知中心 |
| `Super+Space`／`Shift+Super+Space` | 下一／上一输入法 |
| `Super+X` | 快速链接菜单 |
| `Super+V` | 剪贴板历史 |
| `Super+D` | 显示桌面 |
| `Super+E`／`Super+I`／`Super+R` | 文件／设置／运行 |
| `Super+T`／`Super+1…9` | 遍历／激活任务栏应用 |

扩展停用后，会恢复它接管的 GNOME 快捷键。部分绑定可配置或关闭。

## 构建、测试与发布

本扩展由 JavaScript／GJS、CSS 和资源文件组成。“云编译”是编译 GSettings schema 并生成安装 ZIP，不是编译 GNOME 或原生 GTK 软件包。

```bash
make check           # 语法、纯逻辑、schema 和应用排序检查，不启动测试桌面。
make test-package    # 安装包结构、校验和、可重复构建及打包安全测试。
make pack            # 生成 dist/*.shell-extension.zip 和 dist/SHA256SUMS。
```

本地检查需要 Node.js 22+、Python 3、GJS、`glib-compile-schemas` 和 ICU 的 `uconv`。Debian／Ubuntu 除 Node／Python 外，还需安装 `gjs`、`libglib2.0-bin`、`icu-devtools`。

在兼容的 GNOME 50 工作站上运行实际渲染与交互回归：

```bash
tools/test-ui.sh
TESTBED_MODE=ubuntu tools/test-ui.sh
```

测试使用独立的无头 Shell、会话总线、运行目录和配置。Wi-Fi／音频测试使用模拟控件，不会连接真实网络或改动真实音量。详见 [开发与测试](docs/development.md)。

### GitHub Actions

[构建工作流](.github/workflows/build.yml)支持 `main` 推送、Pull Request、版本标签和手动触发：

1. 检查语法与纯逻辑，编译设置 schema。
2. 测试并构建可重复的安装 ZIP，生成 SHA-256 校验和。
3. 将 ZIP 和校验和上传为 Actions artifacts。
4. 推送 `v*` 标签时，以同一批产物创建 GitHub Release；标签必须与 `metadata.json` 的 `version-name` 一致。

云端 CI 验证可移植的构建流程，不冒充 GNOME 50 图形测试桌面。Release 说明区分这两类检查，本地完整 UI 回归另行验收。发布下一版本时，需更新 `version` 和 `version-name`、提交修改，再推送匹配的标签。

## 已知限制

- 不同 Windows 版本的界面存在差异，本项目不宣称逐像素复刻每个版本。部分材质色值、深色贴靠预览为近似值。
- 没有 Windows 新闻／小组件面板，也不显示搜索框右端的每日图片。任务栏搜索打开本扩展的开始搜索；关闭本扩展开始菜单时则打开 GNOME 搜索。
- 尚不支持拖动重排**任务栏应用按钮**；快捷设置卡片有自己的编辑与拖动排序模式。
- 最大化按钮悬停依赖应用自绘按钮的位置。可选标题栏样式开启后的 GTK、Chromium、Electron 已识别，其他工具包或定制标题栏不保证有效。
- 全系统“右键松开后弹菜单”需要可选 GTK／Mutter 补丁；仅靠扩展无法重写应用内部的菜单。
- 未复刻 Windows 的建议贴靠分组、上缘露出条，以及拖到贴靠栏时窗口缩小的效果。

## 文档与项目链接

- [English README](README.md)
- [详细行为](docs/behavior.md)
- [开发、测试桌面与源码结构](docs/development.md)
- [Windows 测量依据](docs/windows-spec.md)
- [渲染验证](docs/rendering-validation.md)
- [可选原生补丁](patches/README.md)
- [GitHub Releases](https://github.com/Altars3668/win11-taskbar/releases) · [Gitea 源码仓库](https://git.altarscn.com/Geoffrey/win11-taskbar)

## 许可证

[GPL-3.0-or-later](LICENSE)，与 GNOME Shell 一致。Windows、Microsoft 等商标属于各自权利人；本项目与微软没有隶属或背书关系。
