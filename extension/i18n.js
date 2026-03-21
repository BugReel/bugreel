/* i18n.js — Lightweight i18n for Chrome extension HTML pages.
 *
 * Uses chrome.i18n.getMessage() to translate elements with data-i18n attributes.
 * Falls back to the element's existing textContent if no translation is found.
 *
 * Usage in HTML:
 *   <span data-i18n="keyName">Default English text</span>
 *   <input data-i18n="keyName" data-i18n-attr="placeholder" placeholder="Default">
 *   <p data-i18n-html="step_microphone_desc">...</p>
 *
 * Usage in JS:
 *   t('status_uploading')                // "Uploading..."
 *   t('status_uploadingPercent', ['42'])  // "Uploading 42%"
 *
 * Must be loaded BEFORE DOMContentLoaded (in <head>) so it runs on page load.
 */

(function () {
  'use strict';

  /**
   * Translate a single i18n key via chrome.i18n.getMessage.
   * @param {string} key - Message key from messages.json
   * @param {string|string[]} [substitutions] - Values for $1$, $2$ etc placeholders
   * @returns {string} Translated string, or empty string if not found
   */
  function t(key, substitutions) {
    try {
      return chrome.i18n.getMessage(key, substitutions) || '';
    } catch {
      return '';
    }
  }

  /**
   * Apply translations to all elements with data-i18n in the given root.
   */
  function translatePage(root) {
    if (!root) root = document;

    // data-i18n: replace textContent (or attribute via data-i18n-attr)
    var elements = root.querySelectorAll('[data-i18n]');
    elements.forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      if (!key) return;
      var msg = t(key);
      if (!msg) return;

      var attr = el.getAttribute('data-i18n-attr');
      if (attr) {
        el.setAttribute(attr, msg);
      } else {
        el.textContent = msg;
      }
    });

    // data-i18n-html: replace innerHTML (for strings with HTML markup)
    var htmlElements = root.querySelectorAll('[data-i18n-html]');
    htmlElements.forEach(function (el) {
      var key = el.getAttribute('data-i18n-html');
      if (!key) return;
      var msg = t(key);
      if (!msg) return;
      el.innerHTML = msg;
    });
  }

  // Run on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { translatePage(); });
  } else {
    translatePage();
  }

  // Expose for manual use in JS files
  window.__i18n = { t: t, translatePage: translatePage };
})();
