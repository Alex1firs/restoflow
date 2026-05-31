(function () {
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker
      .register('/sw.js')
      .then(function (registration) {
        console.log('[Restoflow POS] Service Worker registered:', registration.scope);
      })
      .catch(function (error) {
        console.error('[Restoflow POS] Service Worker registration failed:', error);
      });
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    registerServiceWorker();
  } else {
    window.addEventListener('load', registerServiceWorker);
  }
})();
