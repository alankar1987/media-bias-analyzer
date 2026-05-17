// extension/lib/share.js — share helpers for the Chrome extension popup.

(function () {
  const SITE = "https://veris.news";

  function buildShareUrl(analysisId) { return `${SITE}/a/${analysisId}`; }

  function buildShareText(headline, leanLabel, factScore) {
    const lean = leanLabel || "—";
    const facts = factScore != null ? `${factScore}/100` : "—";
    return `"${headline || "Article"}" — analysed on Veris. Lean: ${lean}, Facts: ${facts}.`;
  }

  function openShareIntent(platform, headline, leanLabel, factScore, shareUrl) {
    const text = buildShareText(headline, leanLabel, factScore);
    const encodedText = encodeURIComponent(text);
    const encodedUrl = encodeURIComponent(shareUrl);
    let target = null;
    switch (platform) {
      case "x":         target = `https://x.com/intent/post?text=${encodedText}&url=${encodedUrl}`; break;
      case "linkedin":  target = `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`; break;
      case "whatsapp":  target = `https://wa.me/?text=${encodedText}%20${encodedUrl}`; break;
      default: return;
    }
    chrome.tabs.create({ url: target });
  }

  async function copyShareLink(shareUrl) {
    try { await navigator.clipboard.writeText(shareUrl); return true; }
    catch (_) { return false; }
  }

  function renderShareRow(container, analysisId, headline, leanLabel, factScore, onCopy) {
    const shareUrl = buildShareUrl(analysisId);
    container.innerHTML = `
      <span class="share-row-label">Share:</span>
      <button class="share-btn" data-platform="x">𝕏</button>
      <button class="share-btn" data-platform="linkedin">in</button>
      <button class="share-btn" data-platform="whatsapp">✆</button>
      <button class="share-btn copy" data-platform="copy">⎘</button>
    `;
    container.querySelectorAll(".share-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const platform = btn.dataset.platform;
        if (platform === "copy") {
          const ok = await copyShareLink(shareUrl);
          if (typeof onCopy === "function") onCopy(ok);
        } else {
          openShareIntent(platform, headline, leanLabel, factScore, shareUrl);
        }
      });
    });
  }

  window.VerisShare = {
    buildShareUrl, buildShareText, openShareIntent, copyShareLink, renderShareRow,
  };
})();
