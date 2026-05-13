// Veris — cookie consent + Google Analytics loader.
//
// On first visit, shows a small consent banner. If the user accepts, we
// inject the gtag.js script and start tracking. If they decline, gtag is
// never loaded — no GA cookies are set. The choice is remembered in
// localStorage. The privacy policy exposes a "reset preferences" link so
// users can change their mind.

(function () {
  var GA_ID = "G-094T2561FW";
  var STORAGE_KEY = "veris_consent_v1";

  function loadGA() {
    if (window.__verisGALoaded) return;
    window.__verisGALoaded = true;
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + GA_ID;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    function gtag() { window.dataLayer.push(arguments); }
    window.gtag = gtag;
    gtag("js", new Date());
    gtag("config", GA_ID);
  }

  function setConsent(choice) {
    try { localStorage.setItem(STORAGE_KEY, choice); } catch (_) { /* ignore */ }
  }

  function getConsent() {
    try { return localStorage.getItem(STORAGE_KEY); } catch (_) { return null; }
  }

  function showBanner() {
    if (document.getElementById("cookie-banner")) return;
    var banner = document.createElement("div");
    banner.id = "cookie-banner";
    banner.className = "cookie-banner";
    banner.innerHTML =
      '<div class="cookie-banner-text">' +
        'We use Google Analytics to understand how the site is used in aggregate. ' +
        'No data is linked to your account. See our ' +
        '<a href="/privacy.html">privacy policy</a>.' +
      '</div>' +
      '<div class="cookie-banner-actions">' +
        '<button class="cookie-banner-btn secondary" id="cookie-decline">Decline</button>' +
        '<button class="cookie-banner-btn primary" id="cookie-accept">Accept</button>' +
      '</div>';
    document.body.appendChild(banner);
    document.getElementById("cookie-accept").addEventListener("click", function () {
      setConsent("accepted");
      banner.remove();
      loadGA();
    });
    document.getElementById("cookie-decline").addEventListener("click", function () {
      setConsent("declined");
      banner.remove();
    });
  }

  // Public API for the privacy page: lets the user reset their choice.
  window.verisResetConsent = function () {
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) { /* ignore */ }
    if (document.getElementById("cookie-banner")) return;
    showBanner();
  };

  var choice = getConsent();
  if (choice === "accepted") {
    loadGA();
  } else if (choice !== "declined") {
    if (document.body) showBanner();
    else document.addEventListener("DOMContentLoaded", showBanner);
  }
})();
