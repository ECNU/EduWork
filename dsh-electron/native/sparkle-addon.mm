#include <node_api.h>
#import <AppKit/AppKit.h>
#import <Sparkle/Sparkle.h>

// Loaded only by the Electron main process. Sparkle must see the host .app,
// not a separately launched command-line helper.
static SPUStandardUpdaterController *controller = nil;

static napi_value fail(napi_env env, const char *message) {
  napi_throw_error(env, nullptr, message);
  return nullptr;
}

static napi_value start(napi_env env, napi_callback_info info) {
  if (![NSThread isMainThread]) return fail(env, "Sparkle must start on the macOS main thread");
  @autoreleasepool {
    if (controller == nil) {
      controller = [[SPUStandardUpdaterController alloc] initWithStartingUpdater:NO updaterDelegate:nil userDriverDelegate:nil];
      [controller startUpdater];
    }
  }
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

static napi_value check(napi_env env, napi_callback_info info) {
  if (![NSThread isMainThread]) return fail(env, "Sparkle must be checked on the macOS main thread");
  if (controller == nil) return fail(env, "Sparkle updater has not started");
  @autoreleasepool { [controller checkForUpdates:nil]; }
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

static napi_value initialize(napi_env env, napi_value exports) {
  napi_property_descriptor methods[] = {
    {"start", nullptr, start, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"check", nullptr, check, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, 2, methods);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
