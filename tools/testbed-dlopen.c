/* testbed-dlopen.c — preloaded by tools/testbed.sh, never installed.
 *
 * GNOME Shell adds mutter's private library directory to the library path
 * of GObject introspection, so loading the Clutter typelib dlopens that
 * directory's libmutter-clutter by its full path. When a locally built
 * libmutter-clutter is already loaded through LD_LIBRARY_PATH, that second
 * file would be loaded as well and every Clutter type registered twice.
 * Send that one path to the local build instead.
 */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdlib.h>
#include <string.h>

void *
dlopen (const char *file, int mode)
{
  static void *(*real_dlopen) (const char *, int);
  const char *local = getenv ("TESTBED_CLUTTER");

  if (!real_dlopen)
    real_dlopen = (void *(*) (const char *, int)) dlsym (RTLD_NEXT, "dlopen");
  if (file && local && strstr (file, "/mutter-18/libmutter-clutter-18.so"))
    file = local;
  return real_dlopen (file, mode);
}
