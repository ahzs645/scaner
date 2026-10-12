// Scan Studio's distinct, source-built macOS main executable.
// Startup follows Electron v44.7.0 shell/app/electron_main_mac.cc and
// shell/app/uv_stdio_fix.cc (MIT license; see bundled Electron LICENSE).
// The framework and sandbox-initializing helper executables remain unchanged.
#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <sys/stat.h>
#include <unistd.h>

extern "C" int ElectronMain(int argc, char* argv[]);
extern "C" int ElectronInitializeICUandStartNode(int argc, char* argv[]);
namespace electron::fuses {
bool IsRunAsNodeEnabled();
}

// Retain app-specific identity in the linked image, even under optimization.
// Apple's linker derives LC_UUID from built code/data, not bundle resources.
__attribute__((used)) static const char kScanStudioMainIdentity[] =
    "local.scanstudio.desktop/main/v1/electron-44.7.0";

static void RepairStdio() {
  struct stat status;
  if (fstat(STDIN_FILENO, &status) < 0 && errno == EBADF)
    (void)freopen("/dev/null", "r", stdin);
  if (fstat(STDOUT_FILENO, &status) < 0 && errno == EBADF)
    (void)freopen("/dev/null", "w", stdout);
  if (fstat(STDERR_FILENO, &status) < 0 && errno == EBADF)
    (void)freopen("/dev/null", "w", stderr);
}

int main(int argc, char* argv[]) {
  RepairStdio();
  const char* run_as_node = std::getenv("ELECTRON_RUN_AS_NODE");
  if (electron::fuses::IsRunAsNodeEnabled() && run_as_node && *run_as_node)
    return ElectronInitializeICUandStartNode(argc, argv);
  // In-process entry preserves Electron's framework/bundle/helper overrides
  // and Chromium initialization. This executable never launches a shadow app.
  return ElectronMain(argc, argv);
}
