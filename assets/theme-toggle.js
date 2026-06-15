/* Theme mode toggle — light (day) / dark (night)
   Auto-detects time of day. Manual override saved to localStorage.
   Handles both the header button (#theme-toggle) and the mobile
   menu button (#theme-toggle-mobile). */

(function () {
  var KEY = 'athlents-theme';

  function applyMode(light) {
    document.documentElement.classList.toggle('light-mode', light);
  }

  function init() {
    var buttons = document.querySelectorAll('#theme-toggle, #theme-toggle-mobile');
    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var goLight = !document.documentElement.classList.contains('light-mode');
        applyMode(goLight);
        localStorage.setItem(KEY, goLight ? 'light' : 'dark');
      });
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
