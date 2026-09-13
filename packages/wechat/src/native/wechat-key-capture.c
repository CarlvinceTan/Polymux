// Opt-in observation of public CommonCrypto calls. Never changes their inputs,
// results, or WeChat's files. Only keys authenticating a supplied encrypted
// database page may leave this process, through an owner-only staging file.
#include <CommonCrypto/CommonCryptor.h>
#include <CommonCrypto/CommonDigest.h>
#include <CommonCrypto/CommonHMAC.h>
#include <CommonCrypto/CommonKeyDerivation.h>
#include <errno.h>
#include <fcntl.h>
#include <pthread.h>
#include <stdint.h>
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#define PMX_CAPTURE_PAGES 128
#define PMX_CAPTURE_CANDIDATES 512
#define PMX_CAPTURE_PAGE_SIZE 4096
static const unsigned char PMXCaptureMagic[8] = {'P','M','X','K','E','Y','0','1'};
static unsigned char *PMXCapturePages;
static uint32_t PMXCaptureCount;
static unsigned char PMXCaptured[PMX_CAPTURE_PAGES];
static unsigned char PMXSeenKeys[PMX_CAPTURE_CANDIDATES][CC_SHA256_DIGEST_LENGTH];
static uint32_t PMXSeenCount;
static int PMXCaptureOutput = -1;
static atomic_bool PMXCaptureEnabled;
static double PMXCaptureDeadline;
static pthread_mutex_t PMXCaptureMutex = PTHREAD_MUTEX_INITIALIZER;
static _Thread_local int PMXInsideCapture;

static void PMXCaptureWipe(void *pointer, size_t count) {
  volatile unsigned char *bytes = pointer;
  while (count--) *bytes++ = 0;
}
static double PMXCaptureNow(void) {
  struct timespec value;
  return clock_gettime(CLOCK_MONOTONIC, &value) == 0
    ? value.tv_sec + value.tv_nsec / 1e9 : 0;
}
static uint32_t PMXCaptureU32(const unsigned char *bytes) {
  return bytes[0] | (uint32_t)bytes[1] << 8 | (uint32_t)bytes[2] << 16 | (uint32_t)bytes[3] << 24;
}
static int PMXCapturePrivate(int fd, mode_t type, mode_t permissions) {
  struct stat info;
  return fd >= 0 && fstat(fd, &info) == 0 && info.st_uid == getuid() &&
    (info.st_mode & S_IFMT) == type && (info.st_mode & 0777) == permissions &&
    (type == S_IFDIR || info.st_nlink == 1);
}
static int PMXCaptureRead(int fd, void *bytes, size_t count) {
  size_t done = 0;
  while (done < count) {
    ssize_t n = read(fd, (unsigned char *)bytes + done, count - done);
    if (n < 0 && errno == EINTR) continue;
    if (n <= 0) return 0;
    done += (size_t)n;
  }
  return 1;
}

__attribute__((constructor)) static void PMXInitializeKeyCapture(void) {
  const char *directory = getenv("POLYMUX_WECHAT_KEY_CAPTURE_DIRECTORY");
  if (!directory || directory[0] != '/') return;
  const char *name = strrchr(directory, '/');
  if (!name || strncmp(name + 1, "polymux-wechat-key-capture-", sizeof("polymux-wechat-key-capture-") - 1) != 0) return;
  int root = open(directory, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (!PMXCapturePrivate(root, S_IFDIR, 0700)) { if (root >= 0) close(root); return; }
  int input = openat(root, "pages", O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC);
  int output = openat(root, "keys", O_WRONLY | O_APPEND | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC);
  close(root);
  struct stat info;
  unsigned char header[12];
  int valid = PMXCapturePrivate(input, S_IFREG, 0600) && PMXCapturePrivate(output, S_IFREG, 0600) &&
    fstat(output, &info) == 0 && info.st_size == 0 &&
    PMXCaptureRead(input, header, sizeof(header)) && !memcmp(header, PMXCaptureMagic, 8);
  uint32_t count = valid ? PMXCaptureU32(header + 8) : 0;
  valid = valid && count > 0 && count <= PMX_CAPTURE_PAGES && fstat(input, &info) == 0 &&
    info.st_size == 12 + count * PMX_CAPTURE_PAGE_SIZE;
  unsigned char *pages = valid ? malloc(count * PMX_CAPTURE_PAGE_SIZE) : NULL;
  valid = pages && PMXCaptureRead(input, pages, count * PMX_CAPTURE_PAGE_SIZE);
  if (input >= 0) close(input);
  double now = PMXCaptureNow();
  if (!valid || !now) {
    free(pages); if (output >= 0) close(output); return;
  }
  PMXCapturePages = pages;
  PMXCaptureCount = count;
  PMXCaptureOutput = output;
  PMXCaptureDeadline = now + 60;
  atomic_store_explicit(&PMXCaptureEnabled, 1, memory_order_release);
}

static int PMXKeyAuthenticatesPage(const unsigned char *key, const unsigned char *page) {
  unsigned char salt[16], macKey[32], mac[64], number[4] = {1,0,0,0};
  CCHmacContext hmac;
  for (int i = 0; i < 16; i++) salt[i] = page[i] ^ 0x3a;
  int valid = CCKeyDerivationPBKDF(kCCPBKDF2, (const char *)key, 32, salt, sizeof(salt),
    kCCPRFHmacAlgSHA512, 2, macKey, sizeof(macKey)) == kCCSuccess;
  if (valid) {
    CCHmacInit(&hmac, kCCHmacAlgSHA512, macKey, sizeof(macKey));
    CCHmacUpdate(&hmac, page + 16, 4016);
    CCHmacUpdate(&hmac, number, sizeof(number));
    CCHmacFinal(&hmac, mac);
    unsigned char difference = 0;
    for (int i = 0; i < 64; i++) difference |= mac[i] ^ page[4032 + i];
    valid = difference == 0;
  }
  PMXCaptureWipe(macKey, sizeof(macKey));
  PMXCaptureWipe(mac, sizeof(mac));
  PMXCaptureWipe(&hmac, sizeof(hmac));
  return valid;
}

static void PMXObserveDatabaseKey(const unsigned char *key) {
  // Never wait for another crypto caller or allow recursive crypto observation.
  if (!atomic_load_explicit(&PMXCaptureEnabled, memory_order_acquire) || PMXInsideCapture ||
      pthread_mutex_trylock(&PMXCaptureMutex) != 0) return;
  PMXInsideCapture = 1;
  if (PMXCaptureOutput < 0) goto done;
  double now = PMXCaptureNow();
  if (!now || now > PMXCaptureDeadline || PMXSeenCount == PMX_CAPTURE_CANDIDATES ||
      !PMXCapturePrivate(PMXCaptureOutput, S_IFREG, 0600)) goto stop;
  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256(key, 32, digest);
  for (uint32_t i = 0; i < PMXSeenCount; i++) if (!memcmp(digest, PMXSeenKeys[i], sizeof(digest))) goto done;
  memcpy(PMXSeenKeys[PMXSeenCount++], digest, sizeof(digest));
  uint32_t remaining = 0;
  for (uint32_t i = 0; i < PMXCaptureCount; i++) {
    if (PMXCaptured[i]) continue;
    if (!PMXKeyAuthenticatesPage(key, PMXCapturePages + i * PMX_CAPTURE_PAGE_SIZE)) { remaining++; continue; }
    if (!PMXCapturePrivate(PMXCaptureOutput, S_IFREG, 0600)) goto stop;
    unsigned char record[36];
    record[0] = i & 255; record[1] = (i >> 8) & 255;
    record[2] = (i >> 16) & 255; record[3] = (i >> 24) & 255;
    memcpy(record + 4, key, 32);
    // A short/error write stops capture. The reader rejects truncated records.
    ssize_t written;
    do { written = write(PMXCaptureOutput, record, sizeof(record)); } while (written < 0 && errno == EINTR);
    PMXCaptureWipe(record, sizeof(record));
    if (written != 36) goto stop;
    PMXCaptured[i] = 1;
  }
  if (remaining) goto done;
stop:
  atomic_store_explicit(&PMXCaptureEnabled, 0, memory_order_release);
  close(PMXCaptureOutput); PMXCaptureOutput = -1;
done:
  PMXInsideCapture = 0;
  pthread_mutex_unlock(&PMXCaptureMutex);
}

static CCCryptorStatus PMXCaptureCryptorCreate(CCOperation operation, CCAlgorithm algorithm,
    CCOptions options, const void *key, size_t keyLength, const void *iv, CCCryptorRef *result) {
  // dyld binds this call to the original implementation from inside the
  // interposer. Preserve both its return value and errno, including failures.
  CCCryptorStatus status = CCCryptorCreate(operation, algorithm, options, key, keyLength, iv, result);
  int savedErrno = errno;
  if (status == kCCSuccess && algorithm == kCCAlgorithmAES && options == 0 && key && keyLength == 32)
    PMXObserveDatabaseKey(key);
  errno = savedErrno;
  return status;
}
__attribute__((used, section("__DATA,__interpose")))
static const struct { const void *replacement; const void *original; } PMXKeyCaptureInterpose = {
  (const void *)&PMXCaptureCryptorCreate, (const void *)&CCCryptorCreate
};
