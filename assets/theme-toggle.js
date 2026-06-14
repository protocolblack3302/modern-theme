/* Theme mode toggle — light (day) / dark (night)
   Auto-detects time of day. Manual override saved to localStorage. */

(function () {
  var KEY = 'athlents-theme';

  function isDaytime() {
    var h = new Date().getHours();
    return h >= 6 && h < 18;
  }

  function applyMode(light) {
    document.documentElement.classList.toggle('light-mode', light);
  }

  /* ── Apply on load (runs early via defer, class already set inline) ── */
  function init() {
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;

    btn.addEventListener('click', function () {
      var goLight = !document.documentElement.classList.contains('light-mode');
      applyMode(goLight);
      localStorage.setItem(KEY, goLight ? 'light' : 'dark');
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
