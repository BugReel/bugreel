(() => {
  // Capture runtime JS errors
  window.addEventListener('error', (e) => {
    chrome.runtime.sendMessage({
      type: 'console-event',
      level: 'error',
      text: e.message,
      source: e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : 'unknown',
      stack: e.error?.stack?.slice(0, 500) || ''
    }).catch(() => {});  // ignore if background not ready
  });

  // Capture unhandled promise rejections
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason;
    chrome.runtime.sendMessage({
      type: 'console-event',
      level: 'error',
      text: `Unhandled rejection: ${reason?.message || String(reason)}`,
      source: reason?.stack?.split('\n')[1]?.trim() || 'unknown',
      stack: reason?.stack?.slice(0, 500) || ''
    }).catch(() => {});
  });

  // Override console.error and console.warn to capture explicit logs
  function overrideConsole(method, level) {
    const _orig = console[method];
    console[method] = function(...args) {
      try {
        chrome.runtime.sendMessage({
          type: 'console-event',
          level,
          text: args.map(a => typeof a === 'object' ? JSON.stringify(a).slice(0, 200) : String(a)).join(' ').slice(0, 500),
          source: `console.${method}`
        }).catch(() => {});
      } catch (e) { /* ignore */ }
      _orig.apply(console, args);
    };
  }

  overrideConsole('error', 'error');
  overrideConsole('warn', 'warning');
})();
