UUID = win11-taskbar@altarscn.com
EXTDIR = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

.PHONY: all schemas install link uninstall test pack clean

all: schemas

schemas: schemas/gschemas.compiled

schemas/gschemas.compiled: schemas/*.gschema.xml
	glib-compile-schemas schemas/

# Copy into place — what a user wants.
install: schemas
	mkdir -p $(EXTDIR)
	cp -r metadata.json extension.js prefs.js stylesheet.css lib schemas assets $(EXTDIR)/

# Symlink into place — what a developer wants.
link: schemas
	mkdir -p $(dir $(EXTDIR))
	ln -sfn $(CURDIR) $(EXTDIR)

uninstall:
	rm -rf $(EXTDIR)

test: schemas
	tools/test.sh

# A zip that `gnome-extensions install` accepts.
pack: schemas
	rm -f $(UUID).shell-extension.zip
	zip -r $(UUID).shell-extension.zip \
	    metadata.json extension.js prefs.js stylesheet.css lib schemas assets \
	    README.md docs -x 'schemas/gschemas.compiled'

.PHONY: enable disable
enable: link
	tools/enable.sh --apply

disable:
	tools/disable.sh

clean:
	rm -f schemas/gschemas.compiled $(UUID).shell-extension.zip
