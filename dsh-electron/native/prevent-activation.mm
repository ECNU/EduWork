// electron#53889: on macOS 27 with Electron 44, clicking a non-activating
// panel activates the whole app and takes focus from the frontmost one.
// Loaded only by the Electron main process for the desktop pet window.
// Remove once Electron ships the upstream fix (electron/electron#54807).
#include <node_api.h>
#import <AppKit/AppKit.h>
#import <objc/message.h>

// Argument: BrowserWindow.getNativeWindowHandle() (an NSView pointer).
// Returns whether the private AppKit setter was available and applied.
static napi_value PreventActivation(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  void *data = nullptr;
  size_t length = 0;
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  bool applied = false;
  if (argc == 1 && napi_get_buffer_info(env, args[0], &data, &length) == napi_ok && length == sizeof(void *)) {
    NSWindow *window = ((__bridge NSView *)(*reinterpret_cast<void **>(data))).window;
    SEL selector = NSSelectorFromString(@"_setPreventsActivation:");
    if (window && [window respondsToSelector:selector]) {
      reinterpret_cast<void (*)(id, SEL, BOOL)>(objc_msgSend)(window, selector, YES);
      applied = true;
    }
  }
  napi_value result;
  napi_get_boolean(env, applied, &result);
  return result;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_value function;
  napi_create_function(env, "preventActivation", NAPI_AUTO_LENGTH, PreventActivation, nullptr, &function);
  napi_set_named_property(env, exports, "preventActivation", function);
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
