UUID = win11-taskbar@altarscn.com
EXTDIR = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
OUTPUT_DIR ?= dist
PYTHON ?= python3

.PHONY: all schemas install link uninstall test check test-package pack clean enable disable

all: schemas

schemas: schemas/gschemas.compiled

schemas/gschemas.compiled: schemas/*.gschema.xml
	glib-compile-schemas --strict schemas/

# 复制安装仅用于明确请求的用户安装；CI 不运行这个目标。
install: schemas
	mkdir -p "$(EXTDIR)"
	cp -r metadata.json extension.js prefs.js stylesheet.css lib schemas assets "$(EXTDIR)/"

# 开发时链接到当前工作树。
link: schemas
	mkdir -p "$(dir $(EXTDIR))"
	ln -sfn "$(CURDIR)" "$(EXTDIR)"

uninstall:
	rm -rf "$(EXTDIR)"

test: schemas
	tools/test.sh

# 可在 GitHub hosted runner 上运行，不启动 Shell 或修改桌面。
check:
	tools/check.sh
	node tools/test-semantics.mjs
	node tools/test-layout-options.mjs
	node tools/test-ui-lifecycle.mjs
	glib-compile-schemas --strict --dry-run schemas/
	gjs -m tools/test-application-order.js

test-package:
	$(PYTHON) tools/test-package.py

# 包含已编译 schema、许可证和中英文文档的确定性安装 ZIP。
pack:
	$(PYTHON) tools/pack-extension.py --output-dir "$(OUTPUT_DIR)"

enable: link
	tools/enable.sh --apply

disable:
	tools/disable.sh

clean:
	rm -f schemas/gschemas.compiled "$(UUID).shell-extension.zip" \
	    "$(OUTPUT_DIR)/$(UUID).shell-extension.zip" "$(OUTPUT_DIR)/SHA256SUMS"
