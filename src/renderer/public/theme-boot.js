// The theme lives in settings, which are only readable over IPC once the
// renderer bundle has mounted — far too late for the startup splash, which
// paints with the document. This runs in <head>, before the first paint, and
// restores the last resolved choice so the splash opens in the right theme
// instead of flashing into it. `lib/theme.ts` writes the value it reads here.
(function () {
  try {
    var stored = localStorage.getItem('midas.theme');
    // A fresh profile has nothing stored, and 'system' is what it will be given
    // — so resolve that here rather than leaving the root bare. The stylesheet
    // can dress an unthemed root, but the attribute would still arrive later,
    // on mount, and that write is a recalc of the whole document landing in the
    // middle of the splash's slide. Setting it before first paint means the
    // renderer's own applyTheme has nothing left to change.
    var mode = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
    var dark = mode === 'dark'
      || (mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  } catch (error) {
    // Storage can be denied outright (sandboxed previews). The stylesheet
    // falls back to the system preference while no theme is set, so a launch
    // without this hint still opens in a sensible colour.
  }

  // The slide starts when the splash is actually on screen, so that all of it
  // is seen. In the app that moment belongs to the main process, which holds
  // the window back until its first frame and sets this attribute as it shows
  // it (see main.ts) — a hidden Electron window still reports its document as
  // visible, so the page cannot tell. In a browser the page is on screen as
  // soon as it paints. The timeout is a failsafe: a splash that never animates
  // would be a splash that never leaves.
  var root = document.documentElement;
  function play() {
    if (root.dataset.splash) return;
    root.dataset.splash = 'playing';
  }
  // Done means the cover may lift as soon as the app is ready. The app asks
  // for this state rather than timing the slide itself, so it cannot matter
  // whether it mounts before or after the slide finishes.
  function done() {
    if (root.dataset.splash === 'done') return;
    root.dataset.splash = 'done';
    document.dispatchEvent(new Event('midas:splash-done'));
  }
  document.addEventListener('animationend', function (event) {
    if (event.animationName === 'startup-brand-in') done();
  });
  // Reduced motion removes the slide altogether, so there is nothing to wait
  // for and no animationend coming.
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) done();
  else if (!window.midas) play();
  else setTimeout(play, 3000);

  // The app lifts the splash when it mounts. If the bundle never loads at all
  // nothing would, and a full-window cover would hide the very thing that says
  // why — dev's error overlay, or a blank page worth reporting. A mounted app
  // is left alone: its own slow-load ceiling is 8s, well inside this.
  setTimeout(function () {
    var mount = document.getElementById('app');
    var splash = document.getElementById('startup-splash');
    if (splash && mount && !mount.hasChildNodes()) splash.remove();
  }, 12000);
})();
