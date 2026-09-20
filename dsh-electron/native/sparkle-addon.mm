#include <node_api.h>
#import <AppKit/AppKit.h>
#import <Sparkle/Sparkle.h>
#include <string>
#include <utility>
#include <initializer_list>

// Loaded only by the Electron main process. Sparkle must see the host .app,
// not a separately launched command-line helper.
static SPUStandardUpdaterController *controller = nil;
static NSString *currentFeed = nil, *updateState = @"idle", *latestVersion = @"", *lastError = @"";
@interface EduworkUpdaterDelegate : NSObject <SPUUpdaterDelegate>
@end
@implementation EduworkUpdaterDelegate
- (NSString *)feedURLStringForUpdater:(SPUUpdater *)updater { return currentFeed; }
- (void)updater:(SPUUpdater *)updater didFindValidUpdate:(SUAppcastItem *)item {
  updateState = @"available"; latestVersion = item.displayVersionString; lastError = @"";
}
- (void)updater:(SPUUpdater *)updater didFinishUpdateCycleForUpdateCheck:(SPUUpdateCheck)check error:(NSError *)error {
  if (error.code == SUNoUpdateError) { updateState = @"up_to_date"; lastError = @""; }
  else if (error && error.code != SUInstallationCanceledError) { updateState = @"error"; lastError = error.localizedDescription; }
  else if ([updateState isEqualToString:@"checking"]) updateState = @"idle";
}
@end
static EduworkUpdaterDelegate *delegate = nil;

static napi_value fail(napi_env env, const char *message) {
  napi_throw_error(env, nullptr, message);
  return nullptr;
}

static napi_value start(napi_env env, napi_callback_info info) {
  if (![NSThread isMainThread]) return fail(env, "Sparkle must start on the macOS main thread");
  @autoreleasepool {
    if (controller == nil) {
      size_t argc = 1;
      napi_value args[1];
      napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
      size_t length = 0;
      if (argc != 1 || napi_get_value_string_utf8(env, args[0], nullptr, 0, &length) != napi_ok) return fail(env, "Sparkle requires a feed URL");
      std::string feed(length + 1, '\0');
      napi_get_value_string_utf8(env, args[0], feed.data(), feed.size(), &length);
      currentFeed = [NSString stringWithUTF8String:feed.c_str()];
      delegate = [[EduworkUpdaterDelegate alloc] init];
      controller = [[SPUStandardUpdaterController alloc] initWithStartingUpdater:NO updaterDelegate:delegate userDriverDelegate:nil];
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
  if (controller.updater.sessionInProgress) return fail(env, "Please finish the current update before switching channels");
  size_t argc = 1, length = 0;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc != 1 || napi_get_value_string_utf8(env, args[0], nullptr, 0, &length) != napi_ok) return fail(env, "Sparkle requires a feed URL");
  std::string feed(length + 1, '\0');
  napi_get_value_string_utf8(env, args[0], feed.data(), feed.size(), &length);
  currentFeed = [NSString stringWithUTF8String:feed.c_str()];
  updateState = @"idle"; latestVersion = @""; lastError = @"";
  [controller.updater resetUpdateCycle];
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

static napi_value probe(napi_env env, napi_callback_info info) {
  if (![NSThread isMainThread] || controller == nil) return fail(env, "Sparkle is not ready");
  if (!controller.updater.sessionInProgress) {
    updateState = @"checking"; lastError = @"";
    [controller.updater checkForUpdateInformation];
  }
  napi_value result; napi_get_undefined(env, &result); return result;
}
static napi_value snapshot(napi_env env, napi_callback_info info) {
  napi_value result; napi_create_object(env, &result);
  for (const auto &pair : {std::make_pair("state", updateState), std::make_pair("latestVersion", latestVersion), std::make_pair("error", lastError)}) {
    napi_value value; napi_create_string_utf8(env, pair.second.UTF8String ?: "", NAPI_AUTO_LENGTH, &value);
    napi_set_named_property(env, result, pair.first, value);
  }
  return result;
}
static napi_value initialize(napi_env env, napi_value exports) {
  napi_property_descriptor methods[] = {
    {"start", nullptr, start, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"check", nullptr, check, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"setFeed", nullptr, setFeed, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"probe", nullptr, probe, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"snapshot", nullptr, snapshot, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, 5, methods);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
