// Text delivery through Desktop's message service, independent of the visible
// composer. All private calls are gated by the host's full-file SHA-256 check
// and the loaded arm64 image UUID below. Never reuse these offsets on another
// build. New message objects belong to this operation; existing UI objects and
// database files are never edited by this helper.
#import <Foundation/Foundation.h>
#import <CoreGraphics/CoreGraphics.h>
#include <mach-o/dyld.h>
#include <mach-o/loader.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>
#include <atomic>
#include <cstring>
#include <functional>
#include <memory>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <vector>

#ifndef POLYMUX_NATIVE_HELPER_REVISION
#define POLYMUX_NATIVE_HELPER_REVISION "unbundled"
#endif

namespace {
using Shared = std::shared_ptr<void>;
using Messages = std::vector<Shared>;
struct alignas(8) TextObject { unsigned char bytes[0x5b0]; };
struct alignas(8) Task { unsigned char bytes[56]; };
struct alignas(8) Subscription { unsigned char bytes[40]; };
struct Location { const char *function; const char *file; uint64_t line; uintptr_t caller; };
static_assert(sizeof(std::string) == 24 && sizeof(Shared) == 16 && sizeof(Messages) == 24);
static_assert(sizeof(std::function<void()>) == 32 && alignof(std::function<void()>) == 8);
static_assert(sizeof(TextObject) == 0x5b0 && sizeof(Task) == 56 && sizeof(Subscription) == 40);

void require(bool ok, const char *reason) { if (!ok) throw std::runtime_error(reason); }
template<typename F> F function(uintptr_t base, uintptr_t offset) { return reinterpret_cast<F>(base + offset); }

bool sessionUnlocked() {
  NSDictionary *session = CFBridgingRelease(CGSessionCopyCurrentDictionary());
  return session && ![session[@"CGSSessionScreenIsLocked"] boolValue];
}

uintptr_t imageBase() {
  constexpr unsigned char expectedUUID[16] = {
    0xc6,0xf8,0xc0,0xa6,0xbb,0x7c,0x3d,0xf1,0xb3,0xac,0xca,0xd6,0xa1,0xa1,0x46,0x1f};
  for (uint32_t i = 0; i < _dyld_image_count(); ++i) {
    const char *name = _dyld_get_image_name(i);
    if (!name || strcmp(name, "/Applications/WeChat.app/Contents/Resources/wechat.dylib")) continue;
    auto header = reinterpret_cast<const mach_header_64 *>(_dyld_get_image_header(i));
    require(header->magic == MH_MAGIC_64 && header->cputype == CPU_TYPE_ARM64, "wechat_native_build_unsupported");
    auto cursor = reinterpret_cast<const unsigned char *>(header + 1);
    const auto end = cursor + header->sizeofcmds;
    require(header->sizeofcmds < 1024 * 1024, "wechat_native_build_unsupported");
    for (uint32_t command = 0; command < header->ncmds; ++command) {
      require(cursor + sizeof(load_command) <= end, "wechat_native_build_unsupported");
      auto load = reinterpret_cast<const load_command *>(cursor);
      require(load->cmdsize >= sizeof(load_command) && load->cmdsize <= size_t(end - cursor), "wechat_native_build_unsupported");
      if (load->cmd == LC_UUID) {
        require(load->cmdsize == sizeof(uuid_command) &&
          !memcmp(reinterpret_cast<const uuid_command *>(load)->uuid, expectedUUID, 16), "wechat_native_build_unsupported");
        return reinterpret_cast<uintptr_t>(header);
      }
      cursor += load->cmdsize;
    }
  }
  throw std::runtime_error("wechat_native_build_unsupported");
}

uintptr_t virtualAddress(uintptr_t base, void *object, size_t slot) {
  require(object != nullptr, "wechat_native_service_unavailable");
  auto table = *reinterpret_cast<uintptr_t **>(object);
  require(reinterpret_cast<uintptr_t>(table) >= base + 0x8ab8000 &&
    reinterpret_cast<uintptr_t>(table) < base + 0x9000000, "wechat_native_service_changed");
  auto address = table[slot];
  require(address >= base + 0x15000 && address < base + 0x7580000, "wechat_native_service_changed");
  return address;
}

Shared messageService(uintptr_t base, void *context) {
  auto account = reinterpret_cast<Shared (*)(void *)>(virtualAddress(base, context, 13))(context);
  require(virtualAddress(base, account.get(), 0) == base + 0x3a29800, "wechat_native_service_changed");
  require(function<bool (*)(void *)>(base, 0x3a29800)(account.get()), "wechat_login_pending");
  auto session = reinterpret_cast<Shared (*)(void *)>(virtualAddress(base, account.get(), 6))(account.get());
  uintptr_t token = base + 0x8b5d6f8;
  auto service = function<Shared (*)(void *, uintptr_t *)>(base, 0x3a4106c)(session.get(), &token);
  require(service.get() != nullptr, "wechat_native_service_unavailable");
  return service;
}

bool privatePath(NSString *path, NSString *prefix) {
  return [path isKindOfClass:NSString.class] && [path.stringByDeletingLastPathComponent isEqualToString:@"/tmp"] &&
    [path.lastPathComponent hasPrefix:prefix] && [path.pathExtension isEqualToString:@"json"];
}

NSDictionary *requestAt(NSString *path) {
  require(privatePath(path, @"polymux-wechat-service-arm-"), "wechat_native_request_invalid");
  int fd = open(path.fileSystemRepresentation, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  require(fd >= 0, "wechat_native_request_unavailable");
  struct stat info;
  bool valid = fstat(fd, &info) == 0 && S_ISREG(info.st_mode) && info.st_uid == getuid() &&
    info.st_nlink == 1 && (info.st_mode & 0777) == 0600 && info.st_size > 0 && info.st_size <= 128 * 1024;
  if (!valid) { close(fd); throw std::runtime_error("wechat_native_request_invalid"); }
  NSMutableData *data = [NSMutableData dataWithLength:size_t(info.st_size)];
  size_t count = 0;
  while (count < data.length) {
    ssize_t readCount = read(fd, static_cast<char *>(data.mutableBytes) + count, data.length - count);
    if (readCount <= 0) break;
    count += size_t(readCount);
  }
  close(fd);
  require(count == data.length, "wechat_native_request_incomplete");
  id value = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  require([value isKindOfClass:NSDictionary.class], "wechat_native_request_invalid");
  return value;
}

std::string requiredString(NSDictionary *request, NSString *key, size_t maximum) {
  id value = request[key];
  require([value isKindOfClass:NSString.class], "wechat_native_request_invalid");
  NSData *bytes = [value dataUsingEncoding:NSUTF8StringEncoding];
  require(bytes.length > 0 && bytes.length <= maximum && !memchr(bytes.bytes, 0, bytes.length), "wechat_native_request_invalid");
  return std::string(static_cast<const char *>(bytes.bytes), bytes.length);
}

void publish(NSString *path, NSDictionary *value) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
  NSString *temporary = [path stringByAppendingFormat:@".%@", NSUUID.UUID.UUIDString];
  int fd = open(temporary.fileSystemRepresentation, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
  if (fd < 0) return;
  size_t count = 0;
  while (count < data.length) {
    ssize_t written = write(fd, static_cast<const char *>(data.bytes) + count, data.length - count);
    if (written <= 0) break;
    count += size_t(written);
  }
  bool ready = count == data.length && fsync(fd) == 0;
  close(fd);
  if (ready) rename(temporary.fileSystemRepresentation, path.fileSystemRepresentation);
  unlink(temporary.fileSystemRepresentation);
}

// The main queue serializes both admission and submission. Requests expire
// before IDs are pruned, so a lost status reply cannot authorize a replay.
std::unordered_map<std::string, double> submittedIDs;

void sendText(NSString *status, NSString *requestPath) {
  bool submitted = false;
  try {
    NSDictionary *request = requestAt(requestPath);
    double now = NSDate.date.timeIntervalSince1970;
    require([request[@"createdAt"] isKindOfClass:NSNumber.class] &&
      [request[@"pid"] isKindOfClass:NSNumber.class] && [request[@"pid"] intValue] == getpid(), "wechat_native_target_changed");
    double age = now - [request[@"createdAt"] doubleValue];
    require(age >= -1 && age <= 30, "wechat_native_request_expired");
    auto id = requiredString(request, @"requestId", 128);
    auto accountID = requiredString(request, @"accountId", 128);
    auto recipient = requiredString(request, @"recipient", 128);
    auto text = requiredString(request, @"text", 64 * 1024);
    if ([request[@"testOnlyFileTransfer"] boolValue]) require(recipient == "filehelper", "wechat_native_test_scope");
    for (auto entry = submittedIDs.begin(); entry != submittedIDs.end();) {
      if (now - entry->second > 120) entry = submittedIDs.erase(entry); else ++entry;
    }
    if (submittedIDs.count(id)) {
      publish(status, @{@"ok":@YES, @"submitted":@YES, @"verificationPending":@YES});
      return;
    }
    auto base = imageBase();
    require(sessionUnlocked(), "wechat_session_locked");
    std::string small = "filehelper";
    require(reinterpret_cast<unsigned char *>(&small)[23] == 10, "wechat_native_string_layout_changed");
    void *context = function<void *(*)()>(base, 0x4281fa8)();
    require(virtualAddress(base, context, 5) == base + 0x4288da8, "wechat_native_service_changed");
    auto currentAccount = function<const std::string *(*)()>(base, 0x4288da8)();
    require(currentAccount != nullptr && *currentAccount == accountID, "wechat_native_account_changed");
    auto service = messageService(base, context);
    // This native deserializer takes a std::string object, including for
    // empty input. Passing a null byte pointer here crashes Desktop.
    const std::string encoded;
    auto object = new TextObject(function<TextObject (*)(const std::string *, void *)>(base, 0x4887b34)(&encoded, nullptr));
    Shared message(object, [base](void *value) {
      function<void (*)(void *)>(base, 0x2f55588)(value);
      ::operator delete(value);
    });
    require(*reinterpret_cast<uintptr_t *>(object) == base + 0x8e07da8, "wechat_native_message_changed");
    *reinterpret_cast<std::string *>(object->bytes + 0x90) = recipient;
    *reinterpret_cast<std::string *>(object->bytes + 0x580) = text;
    *reinterpret_cast<uint32_t *>(object->bytes + 0xb0) = 1;
    Messages messages{message};
    auto task = function<Task (*)(void *, Messages *, bool)>(base, 0x3623f70)(service.get(), &messages, true);
    struct Pending {
      Subscription subscription{};
      std::atomic<bool> released{false};
    };
    auto pending = std::make_shared<Pending>();
    auto release = [pending, base]() {
      if (!pending->released.exchange(true)) {
        function<void (*)(void *)>(base, 0x179098)(&pending->subscription);
        memset(&pending->subscription, 0, sizeof(pending->subscription));
      }
    };
    // Native consumers own these closures until completion. Results remain
    // pending until the host matches a real outgoing Desktop history row.
    std::function<void(const void *)> next = [](const void *) {};
    std::function<void(const void *)> error = [](const void *) {};
    std::function<void()> done = []() {};
    Location location{"Polymux text delivery", "wechat-message-service.mm", 1, 0};
    if (!sessionUnlocked()) {
      function<void (*)(void *)>(base, 0x17919c)(&task);
      throw std::runtime_error("wechat_session_locked");
    }
    submittedIDs.emplace(id, now);
    submitted = true;
    publish(status, @{@"ok":@YES, @"submitted":@YES, @"verificationPending":@YES});
    try {
      pending->subscription = function<Subscription (*)(Task *, decltype(next) *, decltype(error) *, decltype(done) *, Location *)>(base, 0x6fbb20)(
        &task, &next, &error, &done, &location);
    } catch (...) {
      function<void (*)(void *)>(base, 0x17919c)(&task);
      release();
      throw;
    }
    function<void (*)(void *)>(base, 0x17919c)(&task);
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 60 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{ release(); });
  } catch (const std::exception &error) {
    publish(status, @{@"ok":@NO, @"submitted":@(submitted), @"verificationPending":@(submitted),
      @"reason":[NSString stringWithUTF8String:error.what()]});
  }
}

// One same-user channel per process and helper revision. This lets later
// messages use the existing service without another debugger attachment.
dispatch_source_t listenerSource;
bool startListener() {
  if (listenerSource) return true;
  NSString *revision = @POLYMUX_NATIVE_HELPER_REVISION;
  if (revision.length != 64) return false;
  NSString *path = [NSString stringWithFormat:@"/tmp/pmx-wx-service-%d-%d-%@.sock",
    getuid(), getpid(), [revision substringToIndex:16]];
  NSData *pathBytes = [path dataUsingEncoding:NSUTF8StringEncoding];
  sockaddr_un address{};
  if (pathBytes.length >= sizeof(address.sun_path)) return false;
  address.sun_family = AF_UNIX;
  memcpy(address.sun_path, pathBytes.bytes, pathBytes.length);
  struct stat previous;
  if (lstat(address.sun_path, &previous) == 0) {
    if (!S_ISSOCK(previous.st_mode) || previous.st_uid != getuid() || (previous.st_mode & 0777) != 0600) return false;
    int probe = socket(AF_UNIX, SOCK_STREAM, 0);
    if (probe < 0) return false;
    int result = connect(probe, reinterpret_cast<sockaddr *>(&address), sizeof(address));
    int failure = errno;
    close(probe);
    // Never replace a live listener, even one belonging to this user.
    if (result == 0 || failure != ECONNREFUSED) return false;
    if (unlink(address.sun_path) != 0) return false;
  }
  int listener = socket(AF_UNIX, SOCK_STREAM, 0);
  if (listener < 0) return false;
  fcntl(listener, F_SETFD, FD_CLOEXEC);
  int flags = fcntl(listener, F_GETFL, 0);
  if (flags < 0 || fcntl(listener, F_SETFL, flags | O_NONBLOCK) != 0 ||
      bind(listener, reinterpret_cast<sockaddr *>(&address), sizeof(address)) != 0) {
    close(listener); return false;
  }
  if (chmod(address.sun_path, 0600) != 0 || listen(listener, 4) != 0) {
    close(listener); unlink(address.sun_path); return false;
  }
  auto queue = dispatch_queue_create("co.polymux.wechat.message-service", DISPATCH_QUEUE_SERIAL);
  listenerSource = dispatch_source_create(DISPATCH_SOURCE_TYPE_READ, listener, 0, queue);
  if (!listenerSource) { close(listener); unlink(address.sun_path); return false; }
  dispatch_source_set_event_handler(listenerSource, ^{
    // Reading slow clients is bounded on this private queue, never the UI queue.
    for (int attempt = 0; attempt < 8; ++attempt) {
      int client = accept(listener, nullptr, nullptr);
      if (client < 0) break;
      uid_t user; gid_t group;
      if (getpeereid(client, &user, &group) != 0 || user != getuid()) { close(client); continue; }
      struct timeval timeout = {1,0};
      setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
      NSMutableData *data = [NSMutableData data];
      char bytes[1024];
      while (data.length <= 4096) {
        ssize_t count = read(client, bytes, sizeof(bytes));
        if (count <= 0) break;
        [data appendBytes:bytes length:size_t(count)];
        if (memchr(bytes, '\n', size_t(count))) break;
      }
      close(client);
      if (!data.length || data.length > 4096) continue;
      id packet = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
      if (![packet isKindOfClass:NSDictionary.class]) continue;
      NSString *status = packet[@"statusPath"], *request = packet[@"requestPath"];
      if (!privatePath(status, @"polymux-wechat-service-status-") ||
          !privatePath(request, @"polymux-wechat-service-arm-")) continue;
      dispatch_async(dispatch_get_main_queue(), ^{ @autoreleasepool { sendText(status, request); } });
    }
  });
  dispatch_source_set_cancel_handler(listenerSource, ^{ close(listener); unlink(path.fileSystemRepresentation); });
  dispatch_resume(listenerSource);
  return true;
}
}

extern "C" __attribute__((visibility("default")))
int polymux_send_wechat_service_text(const char *statusPath, const char *requestPath) {
  @autoreleasepool {
    NSString *status = statusPath ? [NSString stringWithUTF8String:statusPath] : nil;
    NSString *request = requestPath ? [NSString stringWithUTF8String:requestPath] : nil;
    if (!privatePath(status, @"polymux-wechat-service-status-") ||
        !privatePath(request, @"polymux-wechat-service-arm-")) return -1;
    dispatch_async(dispatch_get_main_queue(), ^{ @autoreleasepool {
      startListener();
      sendText(status, request);
    } });
    return 1;
  }
}
