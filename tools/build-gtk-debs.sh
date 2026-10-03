#!/bin/bash
# Build GTK 3 and GTK 4 packages with the Windows context-menu model.
#
#   tools/build-gtk-debs.sh [build-dir]
#
# Run it whenever Ubuntu publishes a new GTK: /etc/apt/preferences.d/
# altarscn-gtk.pref keeps the patched packages over Ubuntu's, so an update
# arrives only by rebuilding on top of it. This fetches the source Ubuntu
# ships now, adds patches/gtk{3,4}-windows-context-menu.patch to its quilt
# series, versions it <ubuntu version>+altarscnN and builds every package of
# both for amd64 — plus libgtk-3-0t64 for i386 in a chroot when that is
# installed, since Multi-Arch: same makes it carry the amd64 version.
# Nothing is installed; the apt command that would is printed at the end.
#
# It runs gently by default, JOBS=4 at idle priority: Ubuntu builds GTK with
# -flto=auto, and each LTO link then fans out to one process per CPU, so
# with many links in flight a full-width build had the load past 150 and
# memory gone. JOBS caps both the ninja jobs and each link's LTO
# partitions. The i386 chroot is shared between builds (CHROOT=...).
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
B=$(readlink -f "${1:-$HOME/Sources/build-debs/gtk-rightclick-$(date +%Y%m%d)}")
SUITE=$(. /etc/os-release && echo "$VERSION_CODENAME")
MIRROR=$(grep -m1 -oP '^URIs:\s*\K\S+' /etc/apt/sources.list.d/ubuntu.sources 2>/dev/null ||
         echo http://archive.ubuntu.com/ubuntu)
PATCH=windows-context-menu-model.patch
export QUILT_PATCHES=debian/patches
export DEBFULLNAME=${DEBFULLNAME:-AltarsCN} DEBEMAIL=${DEBEMAIL:-altarscn2@gmail.com}
JOBS=${JOBS:-4}
export DEB_BUILD_OPTIONS="nocheck nodoc parallel=$JOBS"
# The last -flto wins, so this caps the LTO fan-out without turning LTO off.
export DEB_CFLAGS_MAINT_APPEND="-flto=$JOBS" DEB_CXXFLAGS_MAINT_APPEND="-flto=$JOBS"
export DEB_LDFLAGS_MAINT_APPEND="-flto=$JOBS"
renice -n 19 -p $$ >/dev/null; ionice -c 2 -n 7 -p $$

mkdir -p "$B" && cd "$B"
sudo apt-get build-dep -y -q -P nocheck,nodoc,noudeb,noinsttest gtk+3.0 gtk4 >/dev/null
apt-get source -q gtk+3.0 gtk4 >/dev/null
newest() { ls -d "$1"-*/ | sed 's#/$##' | sort -V | tail -1; }
GTK3=$(newest gtk+3.0) GTK4=$(newest gtk4)

# Patch and version one tree. $3 is a binary package whose installed
# version says which +altarscnN comes next.
prepare() {
    local dir=$1 patch=$2 bin=$3 base installed n=1
    (
        cd "$B/$dir"
        if ! grep -qx "$PATCH" debian/patches/series; then
            cp "$ROOT/patches/$patch" "debian/patches/$PATCH"
            echo "$PATCH" >> debian/patches/series
            quilt push -q >/dev/null
        fi
        base=$(dpkg-parsechangelog -S Version)
        [[ $base == *+altarscn* ]] && exit 0
        installed=$(dpkg-query -W -f='${Version}' "$bin" 2>/dev/null || true)
        [[ $installed == "$base+altarscn"* ]] && n=$(( ${installed##*+altarscn} + 1 ))
        dch -v "$base+altarscn$n" -D "$SUITE" --force-distribution \
            "右键菜单改为 Windows 模型，见 debian/patches/$PATCH。"
    )
}
prepare "$GTK3" gtk3-windows-context-menu.patch libgtk-3-0t64
prepare "$GTK4" gtk4-windows-context-menu.patch libgtk-4-1

WANT_I386=
if dpkg-query -W -f='${db:Status-Status}' libgtk-3-0t64:i386 2>/dev/null | grep -qx installed; then
    WANT_I386=1
    mkdir -p "$B/i386" && rm -rf "$B/i386/$GTK3" && cp -a "$B/$GTK3" "$B/i386/"
fi

build() {
    local profiles="nocheck nodoc noudeb"
    [[ $1 == gtk4* ]] && profiles+=" noinsttest"
    (cd "$B/$1" && DEB_BUILD_PROFILES="$profiles" dpkg-buildpackage -b -uc -us) \
        > "$B/$1-build.log" 2>&1 || { echo "build failed, see $B/$1-build.log" >&2; exit 1; }
}
build "$GTK4"
build "$GTK3"

if [ -n "$WANT_I386" ]; then
    CH=${CHROOT:-$(dirname "$B")/chroot-$SUITE-i386}
    if [ ! -d "$CH" ]; then
        command -v mmdebstrap >/dev/null || sudo apt-get install -y -q mmdebstrap
        sudo mmdebstrap --variant=buildd --arch=i386 --components=main,universe \
            --include=ca-certificates,quilt,fakeroot "$SUITE" "$CH" \
            "deb $MIRROR $SUITE main universe" "deb $MIRROR $SUITE-updates main universe" \
            "deb $MIRROR $SUITE-security main universe"
    fi
    # --timezone=off: otherwise nspawn bind-mounts /etc/localtime and the
    # tzdata postinst cannot replace it.
    nspawn() {
        sudo systemd-nspawn -q -D "$CH" --timezone=off --bind="$B/i386:/build" \
            --setenv=DEBIAN_FRONTEND=noninteractive --setenv=DEB_BUILD_OPTIONS="$DEB_BUILD_OPTIONS" \
            --setenv=DEB_CFLAGS_MAINT_APPEND="$DEB_CFLAGS_MAINT_APPEND" \
            --setenv=DEB_LDFLAGS_MAINT_APPEND="$DEB_LDFLAGS_MAINT_APPEND" \
            --setenv=DEB_BUILD_PROFILES="nocheck nodoc noudeb" "$@"
    }
    nspawn /bin/bash -c "dpkg --configure -a; apt-get update -q && apt-get build-dep -y -q \
        --no-install-recommends -P nocheck,nodoc,noudeb /build/$GTK3" > "$B/i386-deps.log" 2>&1
    nspawn /bin/bash -c "cd /build/$GTK3 && nice -n 19 ionice -c 2 -n 7 dpkg-buildpackage -B -uc -us" \
        > "$B/i386-build.log" 2>&1 || { echo "i386 build failed, see $B/i386-build.log" >&2; exit 1; }
    sudo chown -R "$(id -u):$(id -g)" "$B/i386"
fi

# The packages from these sources that are installed now, at the new version.
install_list() {
    local pkg name arch found=() debs=()
    shopt -s nullglob
    while read -r pkg; do
        name=${pkg%%:*} arch=${pkg#*:}
        [[ $arch == "$pkg" ]] && arch=
        found=("$B"/"${name}"_*+altarscn*_{${arch:-amd64},all}.deb
               "$B"/i386/"${name}"_*+altarscn*_"${arch:-none}".deb)
        (( ${#found[@]} )) && debs+=("$(printf '%s\n' "${found[@]}" | sort -V | tail -1)")
    done < <(dpkg-query -W -f='${binary:Package} ${source:Package} ${db:Status-Status}\n' |
             awk '($2 == "gtk+3.0" || $2 == "gtk4") && $3 == "installed" {print $1}')
    shopt -u nullglob
    echo "${debs[*]}"
}
echo
echo "Built in $B. Install with:"
echo "  sudo apt-get install $(install_list)"
