// Protect automatic WeChat login before application initialization. While
// WeChat is in the background, intercept its own front/key/activation requests.
// A real macOS foreground transition restores the user's original windows.
// Login admission additionally requires a current process-bound heartbeat.

#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#import <objc/message.h>
#import <objc/runtime.h>
#import <fcntl.h>
#import <stdlib.h>
#import <string.h>
#import <sys/socket.h>
#import <sys/stat.h>
#import <sys/un.h>
#import <unistd.h>
#import <libproc.h>
#import <dlfcn.h>

#ifndef POLYMUX_NATIVE_HELPER_REVISION
#define POLYMUX_NATIVE_HELPER_REVISION "unbundled"
#endif

typedef struct {
  Method method;
  IMP implementation;
} PMXMethodOverride;

static BOOL PMXGuardEnabled = NO;
static BOOL PMXStartupFinished = NO;
static NSDate *PMXGuardDeadline = nil;
static PMXMethodOverride PMXOrderFront = {NULL, NULL};
static PMXMethodOverride PMXOrderFrontRegardless = {NULL, NULL};
static PMXMethodOverride PMXMakeKeyAndOrderFront = {NULL, NULL};
static PMXMethodOverride PMXOrderWindow = {NULL, NULL};
static PMXMethodOverride PMXActivate = {NULL, NULL};
static PMXMethodOverride PMXActivateIgnoring = {NULL, NULL};
static PMXMethodOverride PMXRunningActivate = {NULL, NULL};
static PMXMethodOverride PMXIsActive = {NULL, NULL};
static BOOL PMXGuardInstalled = NO;
// Automatic login requires this persistent guard, not the older timed cloak.
// Only WindowServer making this process frontmost releases window ordering;
// this process's own activation requests cannot release it.
static BOOL PMXBackgroundProtected = NO;
static BOOL PMXBeforeApplicationMain = NO;
static dispatch_source_t PMXGuardHeartbeat = nil;
static PMXMethodOverride PMXMakeKey = {NULL, NULL};
static PMXMethodOverride PMXBecomeKey = {NULL, NULL};
static PMXMethodOverride PMXRunningActivateFrom = {NULL, NULL};
static PMXMethodOverride PMXSetLevel = {NULL, NULL};
static PMXMethodOverride PMXSetAlpha = {NULL, NULL};
static NSHashTable<NSWindow *> *PMXCloakedWindows = nil;
static id PMXActivationObserver = nil;
static NSDate *PMXFakeActiveDeadline = nil;
static NSDate *PMXComposerGuardDeadline = nil;
static char PMXOriginalAlphaKey;
static char PMXOriginalMouseKey;
static char PMXOriginalFrameKey;
static char PMXOriginalLevelKey;
static uintptr_t PMXModelInputAddress = 0;
static uintptr_t PMXModelViewAddress = 0;
static uintptr_t PMXModelSendAddress = 0;
static uintptr_t PMXModelInputVtable = 0;
static uintptr_t PMXModelViewVtable = 0;
static uint32_t PMXModelPasteMethodIndex = 0;
// Offset of the ChatInputView recipient std::string. It moves between WeChat
// builds, so the exact-build debugger passes it in at configuration time.
static uint32_t PMXModelRecipientOffset = 0;
static uint32_t PMXModelSendMethodIndex = UINT32_MAX;
static int PMXModelListener = -1;
static dispatch_source_t PMXModelListenerSource = nil;
static dispatch_queue_t PMXModelQueue = nil;

static NSString *PMXGuardPath(NSString *suffix) {
  // A sandboxed WeChat can only read its own container, and NSTemporaryDirectory
  // resolves there. The caller writes the same path, so the guard file stays a
  // same-user 0600 file either way.
  return [NSTemporaryDirectory() stringByAppendingPathComponent:
      [NSString stringWithFormat:@"polymux-wechat-window-guard-%d.%@",
          getpid(), suffix]];
}

static BOOL PMXWritePrivateText(NSString *path, NSString *text) {
  int descriptor = open(path.fileSystemRepresentation,
      O_WRONLY | O_CREAT | O_NOFOLLOW | O_CLOEXEC, S_IRUSR | S_IWUSR);
  if (descriptor < 0) return NO;
  struct stat info;
  if (fstat(descriptor, &info) != 0 || !S_ISREG(info.st_mode) ||
      info.st_uid != getuid() || info.st_nlink != 1 || ftruncate(descriptor, 0) != 0) {
    close(descriptor); return NO;
  }
  fchmod(descriptor, S_IRUSR | S_IWUSR);
  NSData *data = [text dataUsingEncoding:NSUTF8StringEncoding];
  ssize_t written = write(descriptor, data.bytes, data.length);
  BOOL ok = written == (ssize_t)data.length && fsync(descriptor) == 0;
  close(descriptor);
  return ok;
}

static BOOL PMXPrivateRecentFile(NSString *path, NSTimeInterval maximumAge) {
  struct stat details;
  if (lstat(path.fileSystemRepresentation, &details) != 0 ||
      !S_ISREG(details.st_mode) || details.st_uid != getuid() ||
      (details.st_mode & 0777) != 0600)
    return NO;
  NSTimeInterval age = [NSDate.date timeIntervalSince1970] - details.st_mtimespec.tv_sec;
  if (age < -1 || age > maximumAge) {
    if (age > maximumAge) unlink(path.fileSystemRepresentation);
    return NO;
  }
  return YES;
}

static void PMXPublishGuardReady(void) {
  PMXWritePrivateText(PMXGuardPath(@"ready"),
      [NSString stringWithFormat:@"1\n%.3f\n%.3f\n",
          NSDate.date.timeIntervalSince1970,
          PMXGuardDeadline.timeIntervalSince1970]);
}

typedef struct {
  Class klass;
  SEL selector;
  IMP replacement;
  PMXMethodOverride *saved;
  BOOL optional;
} PMXMethodBinding;

// Preflight the whole set before changing any method. A failed retry must
// never save our own replacements as original implementations.
static BOOL PMXApplyMethodBindings(PMXMethodBinding *bindings, NSUInteger count) {
  for (NSUInteger index = 0; index < count; index++) {
    PMXMethodBinding binding = bindings[index];
    Method method = class_getInstanceMethod(binding.klass, binding.selector);
    if (!method) { if (binding.optional) continue; return NO; }
    Dl_info image = {0};
    IMP original = method_getImplementation(method);
    if (original == binding.replacement) return NO;
    if (dladdr((void *)original, &image) && image.dli_fname &&
        [[[NSString stringWithUTF8String:image.dli_fname] lastPathComponent]
          hasPrefix:@"libpolymux-wechat-prime"]) return NO;
  }
  for (NSUInteger index = 0; index < count; index++) {
    PMXMethodBinding binding = bindings[index];
    Method method = class_getInstanceMethod(binding.klass, binding.selector);
    if (!method) continue;
    *binding.saved = (PMXMethodOverride){method, method_getImplementation(method)};
    method_setImplementation(method, binding.replacement);
  }
  return YES;
}

static BOOL PMXColdGuardActive(void) {
  if (PMXBackgroundProtected)
    return PMXBeforeApplicationMain ||
        NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier != getpid();
  // Before launch completes the deadline is the fail-safe that prevents a
  // broken helper from leaving WeChat invisible forever. After a successful
  // finish, keep the guard until WindowServer genuinely makes WeChat
  // frontmost; the activation observer then recognises the user's explicit
  // open and releases every cloaked window. This closes the late-activation
  // gap where WeChat could raise itself after the launch helper returned.
  BOOL launchWindowOpen = [PMXGuardDeadline timeIntervalSinceNow] > 0;
  return PMXGuardEnabled && (PMXStartupFinished || launchWindowOpen) &&
      NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier != getpid();
}

static BOOL PMXComposerGuardActive(void) {
  BOOL armed = PMXPrivateRecentFile(PMXGuardPath(@"arm"), 30.0) ||
      [PMXComposerGuardDeadline timeIntervalSinceNow] > 0;
  return armed &&
      NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier != getpid();
}

static BOOL PMXBlocksBackgroundActivation(void) {
  return PMXColdGuardActive() || PMXComposerGuardActive();
}

static void PMXCloakWindow(NSWindow *window) {
  if (!window) return;
  if (!PMXCloakedWindows) PMXCloakedWindows = [NSHashTable weakObjectsHashTable];
  if (![PMXCloakedWindows containsObject:window]) {
    objc_setAssociatedObject(window, &PMXOriginalAlphaKey,
        @(window.alphaValue), OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    objc_setAssociatedObject(window, &PMXOriginalMouseKey,
        @(window.ignoresMouseEvents), OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    objc_setAssociatedObject(window, &PMXOriginalFrameKey,
        [NSValue valueWithRect:window.frame], OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    if (!objc_getAssociatedObject(window, &PMXOriginalLevelKey))
      objc_setAssociatedObject(window, &PMXOriginalLevelKey,
          @(window.level), OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    [PMXCloakedWindows addObject:window];
  }
  // Keep Qt's normal rendered and accessibility trees alive while suppressing
  // the guarded window. Alpha-zero
  // windows caused Qt to expose placeholder session rows, which made exact
  // background chat selection impossible.
  NSRect frame = window.frame;
  frame.origin = NSMakePoint(-100000.0 - frame.size.width,
      -100000.0 - frame.size.height);
  [window setFrame:frame display:NO];
  // WindowServer may clamp a far-offscreen Qt window back onto an attached
  // display. Keep that render surface nearly transparent and click-through.
  // This is not proof of zero composited pixels on every display format.
  window.alphaValue = 0.001;
  window.ignoresMouseEvents = YES;
  if (PMXBackgroundProtected && window.level > NSNormalWindowLevel)
    window.level = NSNormalWindowLevel;
}

static void PMXUncloakWindows(BOOL orderBehind) {
  for (NSWindow *window in PMXCloakedWindows.allObjects) {
    NSNumber *alpha = objc_getAssociatedObject(window, &PMXOriginalAlphaKey);
    NSNumber *mouse = objc_getAssociatedObject(window, &PMXOriginalMouseKey);
    NSValue *frame = objc_getAssociatedObject(window, &PMXOriginalFrameKey);
    NSNumber *level = objc_getAssociatedObject(window, &PMXOriginalLevelKey);
    if (frame) [window setFrame:frame.rectValue display:NO];
    window.alphaValue = alpha ? alpha.doubleValue : 1;
    window.ignoresMouseEvents = mouse ? mouse.boolValue : NO;
    if (level) window.level = level.integerValue;
    if (orderBehind) [window orderBack:nil];
    objc_setAssociatedObject(window, &PMXOriginalAlphaKey, nil,
        OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    objc_setAssociatedObject(window, &PMXOriginalMouseKey, nil,
        OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    objc_setAssociatedObject(window, &PMXOriginalFrameKey, nil,
        OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    objc_setAssociatedObject(window, &PMXOriginalLevelKey, nil,
        OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  }
  [PMXCloakedWindows removeAllObjects];
}

static void PMXObserveRealActivation(void) {
  if (PMXActivationObserver) return;
  PMXActivationObserver = [[NSNotificationCenter defaultCenter]
      addObserverForName:NSApplicationWillBecomeActiveNotification
      object:nil
      queue:NSOperationQueue.mainQueue
      usingBlock:^(__unused NSNotification *notification) {
        if (!PMXStartupFinished && PMXGuardEnabled &&
            [PMXGuardDeadline timeIntervalSinceNow] > 0)
          return;
        if (NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier == getpid()) {
          if (!PMXBackgroundProtected) PMXGuardEnabled = NO;
          PMXUncloakWindows(NO);
        }
      }];
  [[NSNotificationCenter defaultCenter]
      addObserverForName:NSApplicationDidBecomeActiveNotification object:nil
      queue:NSOperationQueue.mainQueue usingBlock:^(__unused NSNotification *notification) {
        if (NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier == getpid())
          PMXUncloakWindows(NO);
      }];
}

static void PMXOrderProtectedBehind(NSWindow *window) {
  PMXCloakWindow(window);
  // Never invoke an original front/key method during background login.
  if (PMXOrderWindow.implementation)
    ((void (*)(id, SEL, NSWindowOrderingMode, NSInteger))PMXOrderWindow.implementation)(
        window, @selector(orderWindow:relativeTo:), NSWindowBelow, 0);
}

static void PMXGuardedOrderFront(id window, SEL selector, id sender) {
  if (PMXBackgroundProtected && PMXColdGuardActive()) { PMXOrderProtectedBehind(window); return; }
  if (PMXComposerGuardActive()) return;
  if (PMXColdGuardActive()) PMXCloakWindow(window);
  if (PMXOrderFront.implementation)
    ((void (*)(id, SEL, id))PMXOrderFront.implementation)(window, selector, sender);
}

static void PMXGuardedOrderFrontRegardless(id window, SEL selector) {
  if (PMXBackgroundProtected && PMXColdGuardActive()) { PMXOrderProtectedBehind(window); return; }
  if (PMXComposerGuardActive()) return;
  if (PMXColdGuardActive()) PMXCloakWindow(window);
  if (PMXOrderFrontRegardless.implementation)
    ((void (*)(id, SEL))PMXOrderFrontRegardless.implementation)(window, selector);
}

static void PMXGuardedMakeKeyAndOrderFront(id window, SEL selector, id sender) {
  if (PMXBackgroundProtected && PMXColdGuardActive()) { PMXOrderProtectedBehind(window); return; }
  if (PMXComposerGuardActive()) return;
  if (PMXColdGuardActive()) PMXCloakWindow(window);
  if (PMXMakeKeyAndOrderFront.implementation)
    ((void (*)(id, SEL, id))PMXMakeKeyAndOrderFront.implementation)(
        window, selector, sender);
}

static void PMXGuardedOrderWindow(
    id window, SEL selector, NSWindowOrderingMode place, NSInteger relativeTo) {
  if (place == NSWindowAbove && PMXBackgroundProtected && PMXColdGuardActive()) {
    PMXOrderProtectedBehind(window); return;
  }
  if (place == NSWindowAbove && PMXComposerGuardActive()) return;
  if (place == NSWindowAbove && PMXColdGuardActive()) PMXCloakWindow(window);
  if (PMXOrderWindow.implementation)
    ((void (*)(id, SEL, NSWindowOrderingMode, NSInteger))
        PMXOrderWindow.implementation)(window, selector, place, relativeTo);
}

static void PMXGuardedMakeKey(id window, SEL selector) {
  if (PMXBackgroundProtected && PMXColdGuardActive()) return;
  if (PMXMakeKey.implementation)
    ((void (*)(id, SEL))PMXMakeKey.implementation)(window, selector);
}

static void PMXGuardedBecomeKey(id window, SEL selector) {
  if (PMXBackgroundProtected && PMXColdGuardActive()) return;
  if (PMXBecomeKey.implementation)
    ((void (*)(id, SEL))PMXBecomeKey.implementation)(window, selector);
}

static void PMXGuardedSetLevel(id window, SEL selector, NSInteger level) {
  if (PMXBackgroundProtected && PMXColdGuardActive() && level > NSNormalWindowLevel) {
    objc_setAssociatedObject(window, &PMXOriginalLevelKey, @(level), OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    level = NSNormalWindowLevel;
  }
  if (PMXSetLevel.implementation)
    ((void (*)(id, SEL, NSInteger))PMXSetLevel.implementation)(window, selector, level);
}

static void PMXGuardedSetAlpha(id window, SEL selector, CGFloat alpha) {
  if (PMXBackgroundProtected && PMXColdGuardActive() &&
      [PMXCloakedWindows containsObject:window]) alpha = MIN(alpha, 0.001);
  if (PMXSetAlpha.implementation)
    ((void (*)(id, SEL, CGFloat))PMXSetAlpha.implementation)(window, selector, alpha);
}

static void PMXGuardedActivate(id application, SEL selector) {
  if (PMXBlocksBackgroundActivation()) return;
  if (PMXActivate.implementation)
    ((void (*)(id, SEL))PMXActivate.implementation)(application, selector);
}

static void PMXGuardedActivateIgnoring(
    id application, SEL selector, BOOL ignoringOtherApps) {
  if (PMXBlocksBackgroundActivation()) return;
  if (PMXActivateIgnoring.implementation)
    ((void (*)(id, SEL, BOOL))PMXActivateIgnoring.implementation)(
        application, selector, ignoringOtherApps);
}

static BOOL PMXGuardedRunningActivate(
    id application, SEL selector, NSUInteger options) {
  if ([application processIdentifier] == getpid() && PMXBlocksBackgroundActivation()) return NO;
  return PMXRunningActivate.implementation
      ? ((BOOL (*)(id, SEL, NSUInteger))PMXRunningActivate.implementation)(
            application, selector, options)
      : NO;
}

static BOOL PMXGuardedRunningActivateFrom(id application, SEL selector, id from, NSUInteger options) {
  if ([application processIdentifier] == getpid() && PMXBlocksBackgroundActivation()) return NO;
  return PMXRunningActivateFrom.implementation
      ? ((BOOL (*)(id, SEL, id, NSUInteger))PMXRunningActivateFrom.implementation)(application, selector, from, options)
      : NO;
}

static BOOL PMXGuardedIsActive(id application, SEL selector) {
  if ([PMXFakeActiveDeadline timeIntervalSinceNow] > 0 &&
      NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier != getpid())
    return YES;
  return PMXIsActive.implementation
      ? ((BOOL (*)(id, SEL))PMXIsActive.implementation)(application, selector)
      : NO;
}

static void PMXPrepareBackgroundUI(void) {
  if (PMXStartupFinished) return;
  if (NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier == getpid())
    return;
  PMXFakeActiveDeadline = [NSDate dateWithTimeIntervalSinceNow:10.0];
  SEL unhide = NSSelectorFromString(@"unhideWithoutActivation");
  if ([NSApp respondsToSelector:unhide])
    ((void (*)(id, SEL))objc_msgSend)(NSApp, unhide);
  id delegate = NSApp.delegate;
  NSNotification *willActivation = [NSNotification
      notificationWithName:NSApplicationWillBecomeActiveNotification
      object:NSApp];
  SEL willBecomeActive = @selector(applicationWillBecomeActive:);
  if ([delegate respondsToSelector:willBecomeActive])
    ((void (*)(id, SEL, id))objc_msgSend)(
        delegate, willBecomeActive, willActivation);
  SEL reopen = NSSelectorFromString(
      @"applicationShouldHandleReopen:hasVisibleWindows:");
  if ([delegate respondsToSelector:reopen])
    ((BOOL (*)(id, SEL, id, BOOL))objc_msgSend)(
        delegate, reopen, NSApp, NO);
  NSNotification *activation = [NSNotification
      notificationWithName:NSApplicationDidBecomeActiveNotification
      object:NSApp];
  SEL becameActive = @selector(applicationDidBecomeActive:);
  if ([delegate respondsToSelector:becameActive])
    ((void (*)(id, SEL, id))objc_msgSend)(
        delegate, becameActive, activation);
}

static BOOL PMXInstallGuard(void) {
  @synchronized (NSWindow.class) {
    if (PMXGuardInstalled) return YES;
    // A guard owns its restoration state for this process's lifetime. Loading
    // another revision must not stack hooks, timers or cloaked snapshots.
    const char *ownerName = "PolymuxWeChatBackgroundGuardOwner";
    if (objc_getClass(ownerName)) return NO;
    Class owner = objc_allocateClassPair(NSObject.class, ownerName, 0);
    if (!owner) return NO;
    PMXMethodBinding bindings[] = {
      {NSWindow.class, @selector(orderFront:), (IMP)PMXGuardedOrderFront, &PMXOrderFront, NO},
      {NSWindow.class, @selector(orderFrontRegardless), (IMP)PMXGuardedOrderFrontRegardless, &PMXOrderFrontRegardless, NO},
      {NSWindow.class, @selector(makeKeyAndOrderFront:), (IMP)PMXGuardedMakeKeyAndOrderFront, &PMXMakeKeyAndOrderFront, NO},
      {NSWindow.class, @selector(orderWindow:relativeTo:), (IMP)PMXGuardedOrderWindow, &PMXOrderWindow, NO},
      {NSApplication.class, NSSelectorFromString(@"activate"), (IMP)PMXGuardedActivate, &PMXActivate, YES},
      {NSApplication.class, NSSelectorFromString(@"activateIgnoringOtherApps:"), (IMP)PMXGuardedActivateIgnoring, &PMXActivateIgnoring, NO},
      {NSRunningApplication.class, NSSelectorFromString(@"activateWithOptions:"), (IMP)PMXGuardedRunningActivate, &PMXRunningActivate, NO},
      {NSApplication.class, @selector(isActive), (IMP)PMXGuardedIsActive, &PMXIsActive, NO},
      {NSWindow.class, @selector(makeKeyWindow), (IMP)PMXGuardedMakeKey, &PMXMakeKey, NO},
      {NSWindow.class, @selector(becomeKeyWindow), (IMP)PMXGuardedBecomeKey, &PMXBecomeKey, NO},
      {NSWindow.class, @selector(setLevel:), (IMP)PMXGuardedSetLevel, &PMXSetLevel, NO},
      {NSWindow.class, @selector(setAlphaValue:), (IMP)PMXGuardedSetAlpha, &PMXSetAlpha, NO},
      {NSRunningApplication.class, NSSelectorFromString(@"activateFromApplication:options:"), (IMP)PMXGuardedRunningActivateFrom, &PMXRunningActivateFrom, YES},
    };
    if (!PMXApplyMethodBindings(bindings, sizeof(bindings) / sizeof(bindings[0]))) {
      objc_disposeClassPair(owner);
      return NO;
    }
    objc_registerClassPair(owner);
    PMXGuardInstalled = YES;
    return YES;
  }
}

static BOOL PMXGuardMethodsIntact(void) {
  const PMXMethodOverride overrides[] = {PMXOrderFront, PMXOrderFrontRegardless,
    PMXMakeKeyAndOrderFront, PMXOrderWindow, PMXActivateIgnoring,
    PMXRunningActivate, PMXIsActive, PMXMakeKey, PMXBecomeKey, PMXSetLevel, PMXSetAlpha};
  const IMP replacements[] = {(IMP)PMXGuardedOrderFront, (IMP)PMXGuardedOrderFrontRegardless,
    (IMP)PMXGuardedMakeKeyAndOrderFront, (IMP)PMXGuardedOrderWindow,
    (IMP)PMXGuardedActivateIgnoring,
    (IMP)PMXGuardedRunningActivate, (IMP)PMXGuardedIsActive,
    (IMP)PMXGuardedMakeKey, (IMP)PMXGuardedBecomeKey, (IMP)PMXGuardedSetLevel, (IMP)PMXGuardedSetAlpha};
  for (NSUInteger index = 0; index < sizeof(overrides) / sizeof(overrides[0]); index++)
    if (!overrides[index].method || method_getImplementation(overrides[index].method) != replacements[index])
      return NO;
  return PMXBackgroundProtected && (!PMXActivate.method ||
      method_getImplementation(PMXActivate.method) == (IMP)PMXGuardedActivate) && (!PMXRunningActivateFrom.method ||
      method_getImplementation(PMXRunningActivateFrom.method) == (IMP)PMXGuardedRunningActivateFrom);
}

__attribute__((visibility("default")))
int polymux_wechat_background_guard_active(void) {
  return PMXGuardMethodsIntact() && PMXColdGuardActive() ? 1 : 0;
}

static NSDictionary *PMXBackgroundProof(void) {
  struct proc_bsdinfo info = {0};
  if (!PMXGuardMethodsIntact() || proc_pidinfo(getpid(), PROC_PIDTBSDINFO, 0, &info, sizeof(info)) != sizeof(info))
    return nil;
  return @{@"version": @2, @"pid": @(getpid()),
    @"birthSeconds": @(info.pbi_start_tvsec), @"birthMicros": @(info.pbi_start_tvusec),
    @"revision": @POLYMUX_NATIVE_HELPER_REVISION, @"checkedAt": @(NSDate.date.timeIntervalSince1970)};
}

static void PMXPublishBackgroundProof(void) {
  NSDictionary *proof = PMXBackgroundProof();
  if (!proof) return; // Existing proof expires; never delete another owner's report.
  NSData *data = [NSJSONSerialization dataWithJSONObject:proof options:0 error:nil];
  NSString *path = PMXGuardPath(@"background");
  NSString *temporary = [path stringByAppendingFormat:@".%@.tmp", NSUUID.UUID.UUIDString];
  if (PMXWritePrivateText(temporary, [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]))
    rename(temporary.fileSystemRepresentation, path.fileSystemRepresentation);
  unlink(temporary.fileSystemRepresentation);
}

static void PMXStartBackgroundHeartbeat(void) {
  if (PMXGuardHeartbeat) return;
  PMXBeforeApplicationMain = NO;
  PMXObserveRealActivation();
  PMXGuardHeartbeat = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_main_queue());
  dispatch_source_set_timer(PMXGuardHeartbeat, DISPATCH_TIME_NOW, 250 * NSEC_PER_MSEC, 25 * NSEC_PER_MSEC);
  dispatch_source_set_event_handler(PMXGuardHeartbeat, ^{ PMXPublishBackgroundProof(); });
  dispatch_resume(PMXGuardHeartbeat);
}

// dyld initializes inserted libraries before the application's libraries.
// The launcher admits only an exact verified, non-restricted executable for
// which insertion is allowed. A missing hook exits before WeChat code runs.
__attribute__((constructor)) static void PMXProtectBeforeApplicationMain(void) {
  const char *enabled = getenv("POLYMUX_WECHAT_PRIME_ON_LAUNCH");
  if (!enabled || strcmp(enabled, "2") != 0) return;
  @autoreleasepool {
    PMXBeforeApplicationMain = YES;
    PMXBackgroundProtected = YES;
    if (strlen(POLYMUX_NATIVE_HELPER_REVISION) != 64 || !PMXInstallGuard() || !PMXGuardMethodsIntact()) _exit(78);
    PMXPublishBackgroundProof();
    dispatch_async(dispatch_get_main_queue(), ^{ PMXStartBackgroundHeartbeat(); });
  }
}

static BOOL PMXValidStatusPath(NSString *path) {
  if (!path.length || path.length > 1024) return NO;
  NSString *standard = path.stringByStandardizingPath;
  NSString *temporary = NSTemporaryDirectory().stringByStandardizingPath;
  return [standard.stringByDeletingLastPathComponent isEqualToString:temporary] &&
      [standard.lastPathComponent hasPrefix:@"polymux-wechat-prime-status-"];
}

static BOOL PMXValidModelRequestPath(NSString *path) {
  if (!path.length || path.length > 1024) return NO;
  NSString *standard = path.stringByStandardizingPath;
  NSString *temporary = NSTemporaryDirectory().stringByStandardizingPath;
  return [standard.stringByDeletingLastPathComponent isEqualToString:temporary] &&
      [standard.lastPathComponent hasPrefix:@"polymux-wechat-model-arm-"] &&
      PMXPrivateRecentFile(standard, 60.0);
}

static NSDictionary *PMXReadPrivateJSON(NSString *path) {
  if (!PMXValidModelRequestPath(path)) return nil;
  int descriptor = open(path.fileSystemRepresentation, O_RDONLY | O_NOFOLLOW);
  if (descriptor < 0) return nil;
  struct stat details;
  if (fstat(descriptor, &details) != 0 || details.st_size <= 0 ||
      details.st_size > 1024 * 1024) {
    close(descriptor);
    return nil;
  }
  NSMutableData *data = [NSMutableData dataWithLength:(NSUInteger)details.st_size];
  ssize_t readBytes = read(descriptor, data.mutableBytes, data.length);
  close(descriptor);
  if (readBytes != (ssize_t)data.length) return nil;
  id value = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  return [value isKindOfClass:NSDictionary.class] ? value : nil;
}

static void PMXPublish(NSString *path, NSDictionary *payload) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:payload options:0 error:nil];
  if (!data.length) return;
  NSString *temporary = [path stringByAppendingFormat:@".%d.tmp", getpid()];
  int descriptor = open(temporary.fileSystemRepresentation,
      O_WRONLY | O_CREAT | O_TRUNC | O_NOFOLLOW, S_IRUSR | S_IWUSR);
  if (descriptor < 0) return;
  fchmod(descriptor, S_IRUSR | S_IWUSR);
  ssize_t written = write(descriptor, data.bytes, data.length);
  BOOL ok = written == (ssize_t)data.length && fsync(descriptor) == 0;
  close(descriptor);
  if (ok) rename(temporary.fileSystemRepresentation, path.fileSystemRepresentation);
  else unlink(temporary.fileSystemRepresentation);
}

static NSArray<NSArray<NSDictionary *> *> *PMXSnapshotPasteboard(
    NSPasteboard *pasteboard) {
  NSMutableArray *saved = [NSMutableArray array];
  for (NSPasteboardItem *item in pasteboard.pasteboardItems ?: @[]) {
    NSMutableArray *values = [NSMutableArray array];
    for (NSPasteboardType type in item.types) {
      NSData *data = [item dataForType:type];
      if (data) [values addObject:@{ @"type": type, @"data": data }];
    }
    [saved addObject:values];
  }
  return saved;
}

static void PMXRestorePasteboard(
    NSPasteboard *pasteboard, NSArray<NSArray<NSDictionary *> *> *saved) {
  [pasteboard clearContents];
  NSMutableArray *items = [NSMutableArray array];
  for (NSArray<NSDictionary *> *values in saved) {
    NSPasteboardItem *item = [NSPasteboardItem new];
    for (NSDictionary *value in values) {
      NSString *type = value[@"type"];
      NSData *data = value[@"data"];
      if ([type isKindOfClass:NSString.class] &&
          [data isKindOfClass:NSData.class])
        [item setData:data forType:type];
    }
    [items addObject:item];
  }
  if (items.count) [pasteboard writeObjects:items];
}

static BOOL PMXWriteModelPasteboard(
    NSPasteboard *pasteboard, NSDictionary *request, NSString **reason) {
  NSString *kind = request[@"kind"];
  if (![kind isKindOfClass:NSString.class]) {
    if (reason) *reason = @"wechat_model_kind_invalid";
    return NO;
  }
  [pasteboard clearContents];
  if ([kind isEqualToString:@"text"]) {
    NSString *text = request[@"text"];
    if (![text isKindOfClass:NSString.class] || !text.length ||
        [text containsString:@"\0"]) {
      if (reason) *reason = @"wechat_model_text_invalid";
      return NO;
    }
    return [pasteboard setString:text forType:NSPasteboardTypeString];
  }

  NSString *filePath = request[@"path"];
  if (![filePath isKindOfClass:NSString.class] ||
      !filePath.isAbsolutePath || [filePath containsString:@"\0"]) {
    if (reason) *reason = @"wechat_model_attachment_path_invalid";
    return NO;
  }
  BOOL directory = NO;
  if (![NSFileManager.defaultManager fileExistsAtPath:filePath
                                           isDirectory:&directory] || directory) {
    if (reason) *reason = @"wechat_model_attachment_unavailable";
    return NO;
  }
  NSURL *url = [NSURL fileURLWithPath:filePath isDirectory:NO];
  if ([kind isEqualToString:@"file"])
    return [pasteboard writeObjects:@[url]];
  if ([kind isEqualToString:@"image"]) {
    NSImage *image = [[NSImage alloc] initWithContentsOfURL:url];
    if (!image) {
      if (reason) *reason = @"wechat_model_image_invalid";
      return NO;
    }
    return [pasteboard writeObjects:@[image]];
  }
  if ([kind isEqualToString:@"video"]) {
    NSData *data = [NSData dataWithContentsOfURL:url
                                        options:NSDataReadingMappedIfSafe
                                          error:nil];
    NSData *fileURL = [url.absoluteString dataUsingEncoding:NSUTF8StringEncoding];
    if (!data.length || !fileURL.length) {
      if (reason) *reason = @"wechat_model_video_invalid";
      return NO;
    }
    NSPasteboardItem *item = [NSPasteboardItem new];
    [item setData:data forType:@"public.mpeg-4"];
    [item setData:fileURL forType:@"public.file-url"];
    return [pasteboard writeObjects:@[item]];
  }
  if (reason) *reason = @"wechat_model_kind_unsupported";
  return NO;
}

// Invoke the same Qt model methods used by WeChat's existing ChatInputView,
// without selecting a chat or delivering keyboard/mouse events. The LLDB
// command validates the exact-build QObject vtables. This function requires
// a matching existing recipient on WeChat's main thread before any mutation.
__attribute__((visibility("default")))
int polymux_send_wechat_model_paste(
    const char *statusPath, const char *requestPath,
    uintptr_t inputAddress, uintptr_t viewAddress,
    uintptr_t sendAddress, uint32_t pasteMethodIndex) {
  @autoreleasepool {
    NSString *status = statusPath
        ? [NSString stringWithUTF8String:statusPath] : nil;
    NSString *requestFile = requestPath
        ? [NSString stringWithUTF8String:requestPath] : nil;
    if (!PMXValidStatusPath(status)) return -1;
    NSDictionary *request = PMXReadPrivateJSON(requestFile);
    if (!request) return -2;
    if (!NSThread.isMainThread) return -3;
    if (!inputAddress || !viewAddress || !sendAddress ||
        pasteMethodIndex > 512) return -4;
    if (PMXModelInputAddress != inputAddress ||
        PMXModelViewAddress != viewAddress ||
        PMXModelSendAddress != sendAddress ||
        PMXModelPasteMethodIndex != pasteMethodIndex ||
        *(uintptr_t *)inputAddress != PMXModelInputVtable ||
        *(uintptr_t *)viewAddress != PMXModelViewVtable) {
      PMXPublish(status, @{
        @"ok": @NO, @"submitted": @NO,
        @"reason": @"wechat_model_configuration_changed",
      });
      return -10;
    }
    if (!PMXInstallGuard() || !PMXComposerGuardActive()) {
      PMXPublish(status, @{
        @"ok": @NO, @"submitted": @NO,
        @"reason": @"wechat_model_window_guard_unavailable",
      });
      return -7;
    }

    NSString *recipient = request[@"recipient"];
    NSData *recipientData = [recipient isKindOfClass:NSString.class]
        ? [recipient dataUsingEncoding:NSUTF8StringEncoding] : nil;
    uint8_t *recipientStorage = (uint8_t *)viewAddress + PMXModelRecipientOffset;
    uint8_t currentLength = recipientStorage[23];
    if (!recipientData.length || recipientData.length > 22 ||
        (currentLength & 0x80) || currentLength > 22) {
      PMXPublish(status, @{
        @"ok": @NO, @"submitted": @NO,
        @"reason": @"wechat_model_recipient_invalid",
      });
      return -8;
    }
    NSString *currentRecipient = [[NSString alloc]
        initWithBytes:recipientStorage
        length:currentLength
        encoding:NSUTF8StringEncoding];
    // An empty context is unknown, not permission to invent a recipient.
    if (!currentRecipient.length ||
        ![currentRecipient isEqualToString:recipient]) {
      PMXPublish(status, @{
        @"ok": @NO, @"submitted": @NO,
        @"reason": @"wechat_model_recipient_changed",
      });
      return -9;
    }
    NSData *savedRecipient = [NSData dataWithBytes:recipientStorage length:24];

    NSPasteboard *pasteboard = NSPasteboard.generalPasteboard;
    NSArray *saved = PMXSnapshotPasteboard(pasteboard);
    NSString *reason = nil;
    if (!PMXWriteModelPasteboard(pasteboard, request, &reason)) {
      PMXRestorePasteboard(pasteboard, saved);
      PMXPublish(status, @{
        @"ok": @NO, @"submitted": @NO,
        @"reason": reason ?: @"wechat_model_pasteboard_unavailable",
      });
      return -5;
    }

    typedef int (*PMXQtMetaCall)(void *, int, int, void **);
    typedef void (*PMXChatSend)(void *, int);
    void *input = (void *)inputAddress;
    void *view = (void *)viewAddress;
    void **vtable = *(void ***)input;
    PMXQtMetaCall metacall = vtable
        ? (PMXQtMetaCall)vtable[2] : NULL;
    PMXChatSend send = (PMXChatSend)sendAddress;
    if (!metacall || !send) {
      PMXRestorePasteboard(pasteboard, saved);
      PMXPublish(status, @{
        @"ok": @NO, @"submitted": @NO,
        @"reason": @"wechat_model_methods_unavailable",
      });
      return -6;
    }

    // File and video paste processing can ask Qt to raise an existing or newly
    // created composer window after the paste method has returned. Keep every
    // current window offscreen and retain the activation guard briefly beyond
    // the native send acknowledgement. Restoring the windows with orderBack:
    // preserves the user's foreground app even if Qt changed their order while
    // the pixels were cloaked.
    NSString *kind = request[@"kind"];
    // `isActive` can still be the synthetic value used to rebuild WeChat's
    // hidden Qt tree. WindowServer ownership is the only safe signal for
    // whether an attachment composer must remain completely cloaked.
    BOOL cloakComposer =
        NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier !=
            getpid() &&
        ![kind isEqualToString:@"text"];
    if (cloakComposer) {
      PMXComposerGuardDeadline = [NSDate dateWithTimeIntervalSinceNow:3.0];
      for (NSWindow *window in NSApp.windows)
        if (window.isVisible) PMXCloakWindow(window);
    }

    void *arguments[] = {NULL};
    metacall(input, 0, (int)pasteMethodIndex, arguments);
    uint64_t delayMs = [kind isEqualToString:@"text"] ? 0 : 750;
    void (^submit)(void) = ^{
      // Attachment paste yields to the main queue. The user or WeChat may
      // change conversations during that delay; check again before sending.
      BOOL recipientUnchanged =
          memcmp(recipientStorage, savedRecipient.bytes, 24) == 0;
      if (recipientUnchanged) {
        // 4.1.13: emit ChatInputField::send(SendActionType) through Qt's
        // validated metadata. The live connection owns the ChatInputView
        // receiver and its actual submit ABI. Do not call the app-state
        // callback at 0x87bc3c with a ChatInputView pointer.
        if (PMXModelSendMethodIndex != UINT32_MAX) {
          int action = 0;
          void *sendArguments[] = {NULL, &action};
          metacall(input, 0, (int)PMXModelSendMethodIndex, sendArguments);
        } else {
          // Preserve the exact-build 4.1.11 route.
          send(view, 0);
        }
      }
      PMXRestorePasteboard(pasteboard, saved);
      PMXPublish(status, @{
        @"ok": @(recipientUnchanged), @"submitted": @(recipientUnchanged),
        @"reason": recipientUnchanged ? @"" : @"wechat_model_recipient_changed",
      });
      if (cloakComposer) {
        PMXComposerGuardDeadline = [NSDate dateWithTimeIntervalSinceNow:2.0];
        dispatch_after(
            dispatch_time(DISPATCH_TIME_NOW,
                (int64_t)(2100 * NSEC_PER_MSEC)),
            dispatch_get_main_queue(), ^{
              PMXComposerGuardDeadline = nil;
              PMXUncloakWindows(YES);
            });
      }
    };
    if (delayMs == 0) submit();
    else dispatch_after(
        dispatch_time(DISPATCH_TIME_NOW,
            (int64_t)(delayMs * NSEC_PER_MSEC)),
        dispatch_get_main_queue(), submit);
    return 1;
  }
}

static NSString *PMXModelSocketPath(void) {
  return [NSTemporaryDirectory() stringByAppendingPathComponent:
      [NSString stringWithFormat:@"polymux-wechat-model-%d.sock", getpid()]];
}

static void PMXHandleModelConnection(int connection) {
  // The socket itself is mode 0600 in this user's private temporary
  // directory, which is the authorization boundary for local clients.
  int flags = fcntl(connection, F_GETFL, 0);
  if (flags >= 0) fcntl(connection, F_SETFL, flags & ~O_NONBLOCK);
  struct timeval timeout = {.tv_sec = 1, .tv_usec = 0};
  setsockopt(connection, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
  NSMutableData *data = [NSMutableData data];
  uint8_t buffer[1024];
  while (data.length <= 4096) {
    ssize_t count = read(connection, buffer, sizeof(buffer));
    if (count <= 0) break;
    [data appendBytes:buffer length:(NSUInteger)count];
    if (memchr(buffer, '\n', (size_t)count)) break;
  }
  close(connection);
  if (!data.length || data.length > 4096) return;
  id value = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  if (![value isKindOfClass:NSDictionary.class]) return;
  NSString *status = value[@"statusPath"];
  NSString *request = value[@"requestPath"];
  if (![status isKindOfClass:NSString.class] ||
      ![request isKindOfClass:NSString.class] ||
      !PMXValidStatusPath(status) || !PMXValidModelRequestPath(request))
    return;
  dispatch_async(dispatch_get_main_queue(), ^{
    polymux_send_wechat_model_paste(
        status.UTF8String, request.UTF8String,
        PMXModelInputAddress, PMXModelViewAddress,
        PMXModelSendAddress, PMXModelPasteMethodIndex);
  });
}

static BOOL PMXStartModelListener(void) {
  if (PMXModelListenerSource) return YES;
  NSString *path = PMXModelSocketPath();
  NSData *pathBytes = [path dataUsingEncoding:NSUTF8StringEncoding];
  if (!pathBytes.length || pathBytes.length >= sizeof(((struct sockaddr_un *)0)->sun_path))
    return NO;
  int listener = socket(AF_UNIX, SOCK_STREAM, 0);
  if (listener < 0) return NO;
  int flags = fcntl(listener, F_GETFL, 0);
  if (flags < 0 || fcntl(listener, F_SETFL, flags | O_NONBLOCK) != 0) {
    close(listener);
    return NO;
  }
  struct sockaddr_un address = {0};
  address.sun_family = AF_UNIX;
  memcpy(address.sun_path, pathBytes.bytes, pathBytes.length);
  unlink(address.sun_path);
  if (bind(listener, (struct sockaddr *)&address, sizeof(address)) != 0 ||
      chmod(address.sun_path, S_IRUSR | S_IWUSR) != 0 ||
      listen(listener, 4) != 0) {
    close(listener);
    unlink(address.sun_path);
    return NO;
  }
  PMXModelQueue = dispatch_queue_create(
      "co.polymux.wechat.model", DISPATCH_QUEUE_SERIAL);
  PMXModelListener = listener;
  PMXModelListenerSource = dispatch_source_create(
      DISPATCH_SOURCE_TYPE_READ, (uintptr_t)listener, 0, PMXModelQueue);
  if (!PMXModelListenerSource) {
    close(listener);
    unlink(address.sun_path);
    PMXModelListener = -1;
    return NO;
  }
  dispatch_source_set_event_handler(PMXModelListenerSource, ^{
    while (YES) {
      int connection = accept(PMXModelListener, NULL, NULL);
      if (connection < 0) break;
      PMXHandleModelConnection(connection);
    }
  });
  dispatch_source_set_cancel_handler(PMXModelListenerSource, ^{
    if (PMXModelListener >= 0) close(PMXModelListener);
    PMXModelListener = -1;
    unlink(path.fileSystemRepresentation);
  });
  dispatch_resume(PMXModelListenerSource);
  return YES;
}

// The debugger performs exact-build vtable validation once per WeChat launch.
// From then on this in-process, same-user socket revalidates those object
// pointers before each send, avoiding another debugger attach or relay pause.
__attribute__((visibility("default")))
int polymux_configure_wechat_model(
    uintptr_t inputAddress, uintptr_t viewAddress,
    uintptr_t sendAddress, uint32_t pasteMethodIndex,
    uintptr_t inputVtable, uintptr_t viewVtable,
    uint32_t recipientOffset, uint32_t sendMethodIndex) {
  @autoreleasepool {
    if (!NSThread.isMainThread) return -1;
    if (!inputAddress || !viewAddress || !sendAddress ||
        !inputVtable || !viewVtable || pasteMethodIndex > 512 ||
        recipientOffset < 0x40 || recipientOffset > 0x1000 ||
        (sendMethodIndex != UINT32_MAX && sendMethodIndex > 512))
      return -2;
    if (*(uintptr_t *)inputAddress != inputVtable ||
        *(uintptr_t *)viewAddress != viewVtable)
      return -3;
    PMXModelInputAddress = inputAddress;
    PMXModelViewAddress = viewAddress;
    PMXModelSendAddress = sendAddress;
    PMXModelPasteMethodIndex = pasteMethodIndex;
    PMXModelInputVtable = inputVtable;
    PMXModelViewVtable = viewVtable;
    PMXModelRecipientOffset = recipientOffset;
    PMXModelSendMethodIndex = sendMethodIndex;
    if (!PMXInstallGuard() || !PMXStartModelListener()) return -4;
    return 1;
  }
}

__attribute__((visibility("default")))
int polymux_schedule_wechat_window_guard(
    const char *statusPath, uint32_t durationMs) {
  @autoreleasepool {
    NSString *path = statusPath ? [NSString stringWithUTF8String:statusPath] : nil;
    if (!PMXValidStatusPath(path)) return -1;
    if (durationMs < 1000 || durationMs > 120000) return -2;
    NSString *capturedPath = [path copy];
    void (^schedule)(void) = ^{
      // `isActive` is deliberately faked for a few seconds while a hidden
      // WeChat session rebuilds its Qt chat tree.  Treating that synthetic
      // state as user foreground would refuse a later guard re-arm even
      // though another application still owns WindowServer activation.
      if (NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier ==
          getpid()) {
        PMXPublish(capturedPath, @{
          @"ok": @YES, @"guarded": @NO, @"reason": @"wechat_already_frontmost",
        });
        return;
      }
      if (!PMXInstallGuard()) {
        PMXPublish(capturedPath, @{
          @"ok": @NO, @"guarded": @NO, @"reason": @"wechat_window_guard_unavailable",
        });
        return;
      }
      PMXGuardEnabled = YES;
      PMXBackgroundProtected = YES;
      PMXStartBackgroundHeartbeat();
      PMXStartupFinished = NO;
      PMXGuardDeadline = [NSDate dateWithTimeIntervalSinceNow:durationMs / 1000.0];
      PMXObserveRealActivation();
      for (NSWindow *window in NSApp.windows)
        if (window.isVisible) PMXCloakWindow(window);
      const NSTimeInterval delays[] = {1, 3, 5, 8, 12, 18};
      for (NSUInteger index = 0;
           index < sizeof(delays) / sizeof(delays[0]); index++)
        dispatch_after(
            dispatch_time(DISPATCH_TIME_NOW,
                (int64_t)(delays[index] * NSEC_PER_SEC)),
            dispatch_get_main_queue(), ^{ PMXPrepareBackgroundUI(); });
      PMXPublishGuardReady();
      PMXPublish(capturedPath, @{
        @"ok": @YES, @"guarded": @YES, @"reason": @"",
      });
      dispatch_after(
          dispatch_time(DISPATCH_TIME_NOW,
              (int64_t)((durationMs / 1000.0 + 0.25) * NSEC_PER_SEC)),
          dispatch_get_main_queue(), ^{
            if (!PMXColdGuardActive() && !PMXComposerGuardActive())
              PMXUncloakWindows(YES);
          });
    };
    // Supervised native writers can install on the main thread. Other callers
    // schedule there; automatic login itself never attaches a debugger.
    if (NSThread.isMainThread) schedule();
    else dispatch_async(dispatch_get_main_queue(), schedule);
    return 1;
  }
}

__attribute__((visibility("default")))
int polymux_finish_wechat_window_guard(void) {
  @autoreleasepool {
    void (^finish)(void) = ^{
      // Keep existing windows cloaked until WeChat genuinely activates, but
      // stop simulating activation and allow that real user activation to
      // pass through the swizzled AppKit methods immediately.
      PMXStartupFinished = YES;
      PMXFakeActiveDeadline = nil;
    };
    if (NSThread.isMainThread) finish();
    else dispatch_async(dispatch_get_main_queue(), finish);
    return 1;
  }
}

static NSEvent *PMXKeyEvent(
    NSEventType type,
    NSWindow *window,
    unsigned short keyCode,
    NSEventModifierFlags flags,
    NSString *characters) {
  return [NSEvent
      keyEventWithType:type
      location:NSZeroPoint
      modifierFlags:flags
      timestamp:NSProcessInfo.processInfo.systemUptime
      windowNumber:window.windowNumber
      context:nil
      characters:characters
      charactersIgnoringModifiers:characters
      isARepeat:NO
      keyCode:keyCode];
}

static void PMXRestoreApplication(__unused NSRunningApplication *previous) {
  // Focus failures are reported. Never reactivate a former foreground app.
}

__attribute__((visibility("default")))
int polymux_send_wechat_attachment_events(
    const char *statusPath, uint32_t submitDelayMs) {
  @autoreleasepool {
    NSString *path = statusPath ? [NSString stringWithUTF8String:statusPath] : nil;
    if (!PMXValidStatusPath(path)) return -1;
    if (submitDelayMs < 100 || submitDelayMs > 5000) return -2;
    NSString *capturedPath = [path copy];
    void (^sendPaste)(void) = ^{
      NSRunningApplication *previous =
          NSWorkspace.sharedWorkspace.frontmostApplication;
      NSWindow *window = NSApp.keyWindow ?: NSApp.mainWindow ?: NSApp.windows.firstObject;
      if (!window || previous.processIdentifier == getpid()) {
        PMXPublish(capturedPath, @{
          @"ok": @NO, @"submitted": @NO,
          @"reason": @"wechat_background_composer_unavailable",
        });
        return;
      }
      NSEvent *pasteDown = PMXKeyEvent(
          NSEventTypeKeyDown, window, 9, NSEventModifierFlagCommand, @"v");
      NSEvent *pasteUp = PMXKeyEvent(
          NSEventTypeKeyUp, window, 9, NSEventModifierFlagCommand, @"v");
      if (!pasteDown || !pasteUp) {
        PMXPublish(capturedPath, @{
          @"ok": @NO, @"submitted": @NO,
          @"reason": @"wechat_paste_event_unavailable",
        });
        return;
      }
      [NSApp sendEvent:pasteDown];
      [NSApp sendEvent:pasteUp];
      dispatch_after(
          dispatch_time(DISPATCH_TIME_NOW,
              (int64_t)(submitDelayMs * NSEC_PER_MSEC)),
          dispatch_get_main_queue(), ^{
            if (NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier !=
                previous.processIdentifier) {
              PMXRestoreApplication(previous);
              PMXPublish(capturedPath, @{
                @"ok": @NO, @"submitted": @NO,
                @"reason": @"wechat_took_focus_while_pasting",
              });
              return;
            }
            NSEvent *returnDown = PMXKeyEvent(
                NSEventTypeKeyDown, window, 36, 0, @"\r");
            NSEvent *returnUp = PMXKeyEvent(
                NSEventTypeKeyUp, window, 36, 0, @"\r");
            if (!returnDown || !returnUp) {
              PMXPublish(capturedPath, @{
                @"ok": @NO, @"submitted": @NO,
                @"reason": @"wechat_submit_event_unavailable",
              });
              return;
            }
            [NSApp sendEvent:returnDown];
            [NSApp sendEvent:returnUp];
            dispatch_after(
                dispatch_time(DISPATCH_TIME_NOW, 250 * NSEC_PER_MSEC),
                dispatch_get_main_queue(), ^{
                  BOOL unchanged =
                      NSWorkspace.sharedWorkspace.frontmostApplication
                          .processIdentifier == previous.processIdentifier;
                  if (!unchanged) PMXRestoreApplication(previous);
                  PMXPublish(capturedPath, @{
                    @"ok": @(unchanged), @"submitted": @YES,
                    @"reason": unchanged ? @"" : @"wechat_took_focus_while_submitting",
                  });
                });
          });
    };
    if (NSThread.isMainThread) sendPaste();
    else dispatch_async(dispatch_get_main_queue(), sendPaste);
    return 1;
  }
}

__attribute__((visibility("default")))
int polymux_send_wechat_key(
    const char *statusPath, uint32_t keyCode, uint64_t modifierFlags,
    uint32_t repeatCount) {
  @autoreleasepool {
    NSString *path = statusPath ? [NSString stringWithUTF8String:statusPath] : nil;
    if (!PMXValidStatusPath(path)) return -1;
    if (keyCode > UINT16_MAX) return -2;
    if (repeatCount < 1 || repeatCount > 32) return -3;
    NSString *capturedPath = [path copy];
    void (^sendKey)(void) = ^{
      NSRunningApplication *previous =
          NSWorkspace.sharedWorkspace.frontmostApplication;
      NSWindow *window = NSApp.keyWindow ?: NSApp.mainWindow ?: NSApp.windows.firstObject;
      if (!window || previous.processIdentifier == getpid()) {
        PMXPublish(capturedPath, @{
          @"ok": @NO, @"reason": @"wechat_background_window_unavailable",
        });
        return;
      }
      for (uint32_t index = 0; index < repeatCount; index++) {
        dispatch_after(
            dispatch_time(DISPATCH_TIME_NOW,
                (int64_t)(index * 40 * NSEC_PER_MSEC)),
            dispatch_get_main_queue(), ^{
              unichar character = keyCode == 115
                  ? NSHomeFunctionKey
                  : (keyCode == 116 ? NSPageUpFunctionKey : 0);
              NSString *characters = character
                  ? [NSString stringWithCharacters:&character length:1]
                  : @"";
              NSEventModifierFlags flags =
                  (NSEventModifierFlags)modifierFlags;
              if (character) flags |= NSEventModifierFlagFunction;
              NSEvent *down = PMXKeyEvent(
                  NSEventTypeKeyDown, window, (unsigned short)keyCode,
                  flags, characters);
              NSEvent *up = PMXKeyEvent(
                  NSEventTypeKeyUp, window, (unsigned short)keyCode,
                  flags, characters);
              if (down && up) {
                [window sendEvent:down];
                [window sendEvent:up];
              }
            });
      }
      dispatch_after(
          dispatch_time(DISPATCH_TIME_NOW,
              (int64_t)((repeatCount * 40 + 100) * NSEC_PER_MSEC)),
          dispatch_get_main_queue(), ^{
            BOOL unchanged = NSWorkspace.sharedWorkspace.frontmostApplication
                .processIdentifier == previous.processIdentifier;
            if (!unchanged) PMXRestoreApplication(previous);
            PMXPublish(capturedPath, @{
              @"ok": @(unchanged),
              @"reason": unchanged ? @"" : @"wechat_took_focus_while_navigating",
            });
          });
    };
    if (NSThread.isMainThread) sendKey();
    else dispatch_async(dispatch_get_main_queue(), sendKey);
    return 1;
  }
}

__attribute__((visibility("default")))
int polymux_scroll_wechat_sessions(
    const char *statusPath, int32_t deltaY, uint32_t repeatCount) {
  @autoreleasepool {
    NSString *path = statusPath ? [NSString stringWithUTF8String:statusPath] : nil;
    if (!PMXValidStatusPath(path)) return -1;
    if (deltaY < -200 || deltaY > 200 || deltaY == 0) return -2;
    if (repeatCount < 1 || repeatCount > 64) return -3;
    NSString *capturedPath = [path copy];
    void (^scroll)(void) = ^{
      NSRunningApplication *previous =
          NSWorkspace.sharedWorkspace.frontmostApplication;
      NSWindow *window = NSApp.keyWindow ?: NSApp.mainWindow ?: NSApp.windows.firstObject;
      NSView *content = window.contentView;
      if (!window || !content || previous.processIdentifier == getpid()) {
        PMXPublish(capturedPath, @{
          @"ok": @NO, @"reason": @"wechat_background_window_unavailable",
        });
        return;
      }
      NSRect bounds = content.bounds;
      NSPoint location = NSMakePoint(
          MIN(140.0, NSWidth(bounds) * 0.2), NSHeight(bounds) * 0.5);
      NSView *targetView = [content hitTest:location] ?: content;
      for (uint32_t index = 0; index < repeatCount; index++) {
        dispatch_after(
            dispatch_time(DISPATCH_TIME_NOW,
                (int64_t)(index * 25 * NSEC_PER_MSEC)),
            dispatch_get_main_queue(), ^{
              CGEventRef scrollEvent = CGEventCreateScrollWheelEvent(
                  NULL, kCGScrollEventUnitPixel, 1, deltaY);
              if (!scrollEvent) return;
              NSPoint screenPoint = [window convertPointToScreen:location];
              CGEventSetLocation(scrollEvent, screenPoint);
              CGEventSetIntegerValueField(
                  scrollEvent, kCGMouseEventWindowUnderMousePointer,
                  window.windowNumber);
              NSEvent *event = [NSEvent eventWithCGEvent:scrollEvent];
              CFRelease(scrollEvent);
              if (event) [targetView scrollWheel:event];
            });
      }
      dispatch_after(
          dispatch_time(DISPATCH_TIME_NOW,
              (int64_t)((repeatCount * 25 + 150) * NSEC_PER_MSEC)),
          dispatch_get_main_queue(), ^{
            BOOL unchanged = NSWorkspace.sharedWorkspace.frontmostApplication
                .processIdentifier == previous.processIdentifier;
            if (!unchanged) PMXRestoreApplication(previous);
            PMXPublish(capturedPath, @{
              @"ok": @(unchanged),
              @"reason": unchanged ? @"" : @"wechat_took_focus_while_scrolling",
            });
          });
    };
    if (NSThread.isMainThread) scroll();
    else dispatch_async(dispatch_get_main_queue(), scroll);
    return 1;
  }
}

__attribute__((visibility("default")))
int polymux_send_wechat_return(const char *statusPath) {
  @autoreleasepool {
    NSString *path = statusPath ? [NSString stringWithUTF8String:statusPath] : nil;
    if (!PMXValidStatusPath(path)) return -1;
    NSString *capturedPath = [path copy];
    void (^sendReturn)(void) = ^{
      if (!PMXGuardMethodsIntact() || !PMXColdGuardActive()) {
        PMXPublish(capturedPath, @{@"ok": @NO, @"reason": @"background_guard_unavailable"});
        return;
      }

      NSRunningApplication *previous =
          NSWorkspace.sharedWorkspace.frontmostApplication;
      NSWindow *window = NSApp.keyWindow ?: NSApp.windows.firstObject;
      if (!window) {
        PMXPublish(capturedPath, @{
          @"ok": @NO, @"reason": @"wechat_window_unavailable",
        });
        return;
      }
      NSTimeInterval timestamp = NSProcessInfo.processInfo.systemUptime;
      NSEvent *down = [NSEvent
          keyEventWithType:NSEventTypeKeyDown
          location:NSZeroPoint
          modifierFlags:0
          timestamp:timestamp
          windowNumber:window.windowNumber
          context:nil
          characters:@"\r"
          charactersIgnoringModifiers:@"\r"
          isARepeat:NO
          keyCode:36];
      NSEvent *up = [NSEvent
          keyEventWithType:NSEventTypeKeyUp
          location:NSZeroPoint
          modifierFlags:0
          timestamp:timestamp
          windowNumber:window.windowNumber
          context:nil
          characters:@"\r"
          charactersIgnoringModifiers:@"\r"
          isARepeat:NO
          keyCode:36];
      if (!down || !up) {
        PMXPublish(capturedPath, @{
          @"ok": @NO, @"reason": @"wechat_return_event_unavailable",
        });
        return;
      }
      [NSApp sendEvent:down];
      [NSApp sendEvent:up];
      PMXPublish(capturedPath, @{
        @"ok": @YES, @"reason": @"",
      });
    };
    if (NSThread.isMainThread) sendReturn();
    else dispatch_async(dispatch_get_main_queue(), sendReturn);
    return 1;
  }
}
