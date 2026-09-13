/* Relays a POSIX PTY between stdio and a login shell.
 *
 * stdin/stdout carry terminal bytes. File descriptor 3 accepts `resize COLS ROWS`
 * lines so the renderer can match the PTY to the view. Packaged macOS builds
 * ship a compiled binary beside this source; development compiles on demand.
 *
 * Usage: pty-host --shell PATH --cwd PATH --cols N --rows N
 */

#define _XOPEN_SOURCE 700

#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/wait.h>
#include <termios.h>
#include <unistd.h>

static pid_t child_pid = -1;
static int master_fd = -1;

static void die(const char *message) {
  fprintf(stderr, "pty-host: %s\n", message);
  exit(1);
}

static void die_errno(const char *message) {
  fprintf(stderr, "pty-host: %s: %s\n", message, strerror(errno));
  exit(1);
}

static void set_window_size(int fd, int cols, int rows) {
  struct winsize size;
  memset(&size, 0, sizeof(size));
  size.ws_col = cols > 0 ? (unsigned short)cols : 80;
  size.ws_row = rows > 0 ? (unsigned short)rows : 24;
  ioctl(fd, TIOCSWINSZ, &size);
}

static ssize_t write_all(int fd, const void *buffer, size_t length) {
  const char *bytes = buffer;
  size_t remaining = length;
  while (remaining) {
    ssize_t wrote = write(fd, bytes, remaining);
    if (wrote < 0) {
      if (errno == EINTR) continue;
      return -1;
    }
    bytes += (size_t)wrote;
    remaining -= (size_t)wrote;
  }
  return (ssize_t)length;
}

static int copy_fd(int from, int to) {
  char buffer[65536];
  ssize_t got = read(from, buffer, sizeof(buffer));
  if (got < 0) {
    if (errno == EINTR || errno == EAGAIN) return 1;
    return 0;
  }
  if (got == 0) return 0;
  if (write_all(to, buffer, (size_t)got) < 0) return 0;
  return 1;
}

static void apply_resize_line(char *line) {
  int cols = 0;
  int rows = 0;
  if (sscanf(line, "resize %d %d", &cols, &rows) != 2) return;
  if (master_fd >= 0 && cols > 0 && rows > 0) set_window_size(master_fd, cols, rows);
}

static void read_control(int fd) {
  static char line[128];
  static size_t filled = 0;
  char buffer[128];
  ssize_t got = read(fd, buffer, sizeof(buffer));
  if (got <= 0) return;
  for (ssize_t i = 0; i < got; i++) {
    if (buffer[i] == '\n' || filled + 1 >= sizeof(line)) {
      line[filled] = '\0';
      apply_resize_line(line);
      filled = 0;
      continue;
    }
    line[filled++] = buffer[i];
  }
}

static void close_session(int signal_number) {
  if (child_pid > 0) kill(-child_pid, signal_number == 0 ? SIGHUP : signal_number);
}

static void on_signal(int signal_number) {
  close_session(signal_number);
}

int main(int argc, char **argv) {
  const char *shell = "/bin/sh";
  const char *cwd = NULL;
  int cols = 80;
  int rows = 24;

  for (int i = 1; i < argc; i++) {
    if (!strcmp(argv[i], "--shell") && i + 1 < argc) shell = argv[++i];
    else if (!strcmp(argv[i], "--cwd") && i + 1 < argc) cwd = argv[++i];
    else if (!strcmp(argv[i], "--cols") && i + 1 < argc) cols = atoi(argv[++i]);
    else if (!strcmp(argv[i], "--rows") && i + 1 < argc) rows = atoi(argv[++i]);
    else die("usage: pty-host --shell PATH --cwd PATH --cols N --rows N");
  }

  master_fd = posix_openpt(O_RDWR | O_NOCTTY);
  if (master_fd < 0) die_errno("posix_openpt");
  if (grantpt(master_fd) < 0) die_errno("grantpt");
  if (unlockpt(master_fd) < 0) die_errno("unlockpt");
  char *slave_name = ptsname(master_fd);
  if (!slave_name) die_errno("ptsname");
  int slave_fd = open(slave_name, O_RDWR | O_NOCTTY);
  if (slave_fd < 0) die_errno("open slave");
  set_window_size(master_fd, cols, rows);

  signal(SIGPIPE, SIG_IGN);
  signal(SIGHUP, on_signal);
  signal(SIGINT, on_signal);
  signal(SIGTERM, on_signal);

  pid_t pid = fork();
  if (pid < 0) die_errno("fork");
  if (pid == 0) {
    close(master_fd);
    if (setsid() < 0) die_errno("setsid");
#ifdef TIOCSCTTY
    if (ioctl(slave_fd, TIOCSCTTY, 0) < 0) die_errno("TIOCSCTTY");
#endif
    dup2(slave_fd, STDIN_FILENO);
    dup2(slave_fd, STDOUT_FILENO);
    dup2(slave_fd, STDERR_FILENO);
    if (slave_fd > STDERR_FILENO) close(slave_fd);
    if (cwd && chdir(cwd) < 0) die_errno("chdir");
    execl(shell, shell, "-il", (char *)NULL);
    die_errno("exec shell");
  }

  child_pid = pid;
  close(slave_fd);
  int control_fd = fcntl(3, F_GETFD) >= 0 ? 3 : -1;

  struct pollfd fds[3];
  int running = 1;
  while (running) {
    fds[0].fd = master_fd;
    fds[0].events = POLLIN;
    fds[1].fd = STDIN_FILENO;
    fds[1].events = POLLIN;
    fds[2].fd = control_fd;
    fds[2].events = control_fd >= 0 ? POLLIN : 0;
    int n = poll(fds, control_fd >= 0 ? 3 : 2, -1);
    if (n < 0) {
      if (errno == EINTR) continue;
      break;
    }
    if (fds[0].revents & (POLLIN | POLLHUP | POLLERR)) {
      if (!copy_fd(master_fd, STDOUT_FILENO)) running = 0;
    }
    if (fds[1].revents & POLLIN) {
      if (!copy_fd(STDIN_FILENO, master_fd)) running = 0;
    } else if (fds[1].revents & (POLLHUP | POLLERR)) {
      running = 0;
    }
    if (control_fd >= 0 && (fds[2].revents & POLLIN)) read_control(control_fd);
  }

  close_session(SIGHUP);
  int status = 0;
  waitpid(child_pid, &status, 0);
  if (WIFEXITED(status)) return WEXITSTATUS(status);
  if (WIFSIGNALED(status)) return 128 + WTERMSIG(status);
  return 0;
}
