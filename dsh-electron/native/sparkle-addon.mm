#include <node_api.h>
#import <AppKit/AppKit.h>
#import <Sparkle/Sparkle.h>
#include <string>

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
      size_t argc = 1;
      napi_value args[1];
      napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
      size_t length = 0;
      if (argc != 1 || napi_get_value_string_utf8(env, args[0], nullptr, 0, &length) != napi_ok) return fail(env, "Sparkle requires a feed URL");
      std::string feed(length + 1, '\0');
      napi_get_value_string_utf8(env, args[0], feed.data(), feed.size(), &length);
      controller.updater.feedURL = [NSURL URLWithString:[NSString stringWithUTF8String:feed.c_str()]];
      controller.updater.automaticallyChecksForUpdates = NO;
      NSError *error = nil;
      if (![controller.updater startUpdater:&error]) {
        controller = nil;
        return fail(env, error.localizedDescription.UTF8String);
      }
    }
  }
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

static napi_value setFeed(napi_env env, napi_callback_info info) {
  if (![NSThread isMainThread] || controller == nil) return fail(env, "Sparkle is not ready");
  if (!controller.updater.canCheckForUpdates) return fail(env, "Please finish the current update before switching channels");
  size_t argc = 1, length = 0;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc != 1 || napi_get_value_string_utf8(env, args[0], nullptr, 0, &length) != napi_ok) return fail(env, "Sparkle requires a feed URL");
  std::string feed(length + 1, '\0');
  napi_get_value_string_utf8(env, args[0], feed.data(), feed.size(), &length);
  controller.updater.feedURL = [NSURL URLWithString:[NSString stringWithUTF8String:feed.c_str()]];
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
    {"setFeed", nullptr, setFeed, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, 3, methods);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
