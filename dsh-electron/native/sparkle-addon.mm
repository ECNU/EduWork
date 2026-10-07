#include <node_api.h>
#import <AppKit/AppKit.h>
#import <Sparkle/Sparkle.h>
#include <string>
#include <utility>
#include <initializer_list>

// Loaded only by the Electron main process. Sparkle must see the host .app,
// not a separately launched command-line helper.
static SPUUpdater *updater = nil;
static NSString *currentFeed = nil, *updateState = @"idle", *latestVersion = @"", *lastError = @"";
static void (^installHandler)(void) = nil;
static void (^downloadChoice)(SPUUserUpdateChoice) = nil;
static BOOL manualDownload = NO;
// Public Sparkle user-driver contract: render status in the workbench, while
// Sparkle continues to own downloads, signatures, extraction and installation.
@interface EduworkUserDriver : SPUStandardUserDriver
@end
@implementation EduworkUserDriver
- (void)showUserInitiatedUpdateCheckWithCancellation:(void (^)(void))cancel { updateState = @"checking"; }
- (void)showUpdateFoundWithAppcastItem:(SUAppcastItem *)item state:(SPUUserUpdateState *)state reply:(void (^)(SPUUserUpdateChoice))reply {
  latestVersion = item.displayVersionString;
  if (item.informationOnlyUpdate) {
    manualDownload = NO; updateState = @"error"; lastError = @"此更新需要前往发行页面查看说明。";
    reply(SPUUserUpdateChoiceDismiss); return;
  }
  if (state.stage == SPUUserUpdateStageInstalling) {
    updateState = @"ready"; installHandler = ^{ reply(SPUUserUpdateChoiceInstall); }; manualDownload = NO;
  } else if (manualDownload) {
    manualDownload = NO; reply(SPUUserUpdateChoiceInstall);
  } else {
    updateState = @"available"; downloadChoice = [reply copy];
  }
}
- (void)showUpdateReleaseNotesWithDownloadData:(SPUDownloadData *)data {}
- (void)showUpdateReleaseNotesFailedToDownloadWithError:(NSError *)error {}
- (void)showUpdateInstalledAndRelaunched:(BOOL)relaunched acknowledgement:(void (^)(void))ack { ack(); }
- (void)showDownloadInitiatedWithCancellation:(void (^)(void))cancel { updateState = @"downloading"; }
- (void)showDownloadDidReceiveExpectedContentLength:(uint64_t)length {}
- (void)showDownloadDidReceiveDataOfLength:(uint64_t)length {}
- (void)showDownloadDidStartExtractingUpdate { updateState = @"downloading"; }
- (void)showExtractionReceivedProgress:(double)progress {}
- (void)showReadyToInstallAndRelaunch:(void (^)(SPUUserUpdateChoice))reply {
  updateState = @"ready"; installHandler = ^{ reply(SPUUserUpdateChoiceInstall); };
}
- (void)showInstallingUpdateWithApplicationTerminated:(BOOL)terminated retryTerminatingApplication:(void (^)(void))retry { updateState = @"applying"; }
- (void)showUpdateNotFoundWithError:(NSError *)error acknowledgement:(void (^)(void))ack {
  updateState = @"up_to_date"; lastError = @""; ack();
}
- (void)showUpdaterError:(NSError *)error acknowledgement:(void (^)(void))ack {
  updateState = @"error"; installHandler = nil; lastError = error.localizedDescription; ack();
}
- (void)dismissUpdateInstallation { downloadChoice = nil; manualDownload = NO; if (![updateState isEqualToString:@"ready"]) installHandler = nil; }
@end
static EduworkUserDriver *userDriver = nil;
@interface EduworkUpdaterDelegate : NSObject <SPUUpdaterDelegate>
@end
@implementation EduworkUpdaterDelegate
- (void)updater:(SPUUpdater *)updater willDownloadUpdate:(SUAppcastItem *)item withRequest:(NSMutableURLRequest *)request {
  updateState = @"downloading"; lastError = @"";
}
- (void)userDidCancelDownload:(SPUUpdater *)updater { updateState = @"available"; }
- (BOOL)updater:(SPUUpdater *)updater willInstallUpdateOnQuit:(SUAppcastItem *)item immediateInstallationBlock:(void (^)(void))handler {
  latestVersion = item.displayVersionString; updateState = @"ready";
  installHandler = [handler copy]; return YES;
}
- (NSString *)feedURLStringForUpdater:(SPUUpdater *)updater { return currentFeed; }
- (void)updater:(SPUUpdater *)updater didFindValidUpdate:(SUAppcastItem *)item {
  updateState = @"available"; latestVersion = item.displayVersionString; lastError = @"";
}
- (void)updater:(SPUUpdater *)updater didFinishUpdateCycleForUpdateCheck:(SPUUpdateCheck)check error:(NSError *)error {
  if (error.code == SUNoUpdateError) { updateState = @"up_to_date"; lastError = @""; }
  else if (error && error.code != SUInstallationCanceledError) { installHandler = nil; updateState = @"error"; lastError = error.localizedFailureReason.length ? [NSString stringWithFormat:@"%@: %@", error.localizedDescription, error.localizedFailureReason] : error.localizedDescription;
    NSError *cause = error.userInfo[NSUnderlyingErrorKey];
    if (cause) lastError = [lastError stringByAppendingFormat:@" (%@ %ld: %@)", cause.domain, (long)cause.code, cause.localizedDescription]; }
  else if (error.code == SUInstallationCanceledError) { installHandler = nil; updateState = @"available"; }
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
    if (updater == nil) {
      size_t argc = 1;
      napi_value args[1];
      napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
      size_t length = 0;
      if (argc != 1 || napi_get_value_string_utf8(env, args[0], nullptr, 0, &length) != napi_ok) return fail(env, "Sparkle requires a feed URL");
      std::string feed(length + 1, '\0');
      napi_get_value_string_utf8(env, args[0], feed.data(), feed.size(), &length);
      currentFeed = [NSString stringWithUTF8String:feed.c_str()];
      delegate = [[EduworkUpdaterDelegate alloc] init];
      userDriver = [[EduworkUserDriver alloc] initWithHostBundle:NSBundle.mainBundle delegate:nil];
      updater = [[SPUUpdater alloc] initWithHostBundle:NSBundle.mainBundle applicationBundle:NSBundle.mainBundle userDriver:userDriver delegate:delegate];
      updater.automaticallyChecksForUpdates = NO;
      NSError *error = nil;
      if (![updater startUpdater:&error]) {
        updater = nil;
        return fail(env, error.localizedDescription.UTF8String);
      }
    }
  }
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

static napi_value setFeed(napi_env env, napi_callback_info info) {
  if (![NSThread isMainThread] || updater == nil) return fail(env, "Sparkle is not ready");
  if (installHandler || updater.sessionInProgress) return fail(env, "Please finish the current update before switching channels");
  size_t argc = 1, length = 0;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc != 1 || napi_get_value_string_utf8(env, args[0], nullptr, 0, &length) != napi_ok) return fail(env, "Sparkle requires a feed URL");
  std::string feed(length + 1, '\0');
  napi_get_value_string_utf8(env, args[0], feed.data(), feed.size(), &length);
  currentFeed = [NSString stringWithUTF8String:feed.c_str()];
  updateState = @"idle"; latestVersion = @""; lastError = @"";
  [updater resetUpdateCycle];
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

static napi_value check(napi_env env, napi_callback_info info) {
  if (![NSThread isMainThread]) return fail(env, "Sparkle must be checked on the macOS main thread");
  if (updater == nil) return fail(env, "Sparkle updater has not started");
  @autoreleasepool {
    if (downloadChoice) {
      void (^reply)(SPUUserUpdateChoice) = downloadChoice; downloadChoice = nil;
      reply(SPUUserUpdateChoiceInstall);
    } else if (!updater.sessionInProgress && !installHandler) {
      manualDownload = YES; [updater checkForUpdates];
    }
  }
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

static napi_value probe(napi_env env, napi_callback_info info) {
  if (![NSThread isMainThread] || updater == nil) return fail(env, "Sparkle is not ready");
  if (!updater.sessionInProgress && !installHandler) {
    updateState = @"checking"; lastError = @"";
    if (updater.automaticallyDownloadsUpdates) [updater checkForUpdatesInBackground];
    else [updater checkForUpdateInformation];
  }
  napi_value result; napi_get_undefined(env, &result); return result;
}
static napi_value setAutomaticDownload(napi_env env, napi_callback_info info) {
  if (![NSThread isMainThread] || updater == nil) return fail(env, "Sparkle is not ready");
  size_t argc = 1; napi_value args[1]; bool enabled;
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc != 1 || napi_get_value_bool(env, args[0], &enabled) != napi_ok) return fail(env, "Expected a boolean preference");
  if (updater.sessionInProgress || installHandler) return fail(env, "Finish the current update before changing automatic downloads");
  if (enabled && !updater.allowsAutomaticUpdates) return fail(env, "This app bundle does not allow automatic downloads");
  updater.automaticallyDownloadsUpdates = enabled;
  napi_value result; napi_get_undefined(env, &result); return result;
}
static napi_value install(napi_env env, napi_callback_info info) {
  if (![NSThread isMainThread] || !installHandler) return fail(env, "No update is ready to install");
  installHandler();
  napi_value result; napi_get_undefined(env, &result); return result;
}
static napi_value snapshot(napi_env env, napi_callback_info info) {
  napi_value result; napi_create_object(env, &result);
  for (const auto &pair : {std::make_pair("state", updateState), std::make_pair("latestVersion", latestVersion), std::make_pair("error", lastError)}) {
    napi_value value; napi_create_string_utf8(env, pair.second.UTF8String ?: "", NAPI_AUTO_LENGTH, &value);
    napi_set_named_property(env, result, pair.first, value);
  }
  for (const auto &pair : {std::make_pair("automaticDownload", (bool)updater.automaticallyDownloadsUpdates), std::make_pair("installOnQuit", installHandler != nil), std::make_pair("busy", (bool)updater.sessionInProgress)}) {
    napi_value value; napi_get_boolean(env, pair.second, &value);
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
    {"setAutomaticDownload", nullptr, setAutomaticDownload, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"install", nullptr, install, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"snapshot", nullptr, snapshot, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, 7, methods);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
