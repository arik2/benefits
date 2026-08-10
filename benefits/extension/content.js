/*
 * רץ בתוך עמודי המועדונים (אחרי noautorun.js ו-capture.js).
 * מאזין לבקשות סריקה מהחלונית, גולל את העמוד כדי שהטבות בטעינה עצלה
 * ייטענו, ומחזיר את מה שנמצא. קורא בלבד — לא נוגע בטפסים ולא מבצע
 * שום פעולה בחשבון.
 */

/* גלילה הדרגתית עד תחתית העמוד, כי אתרים רבים טוענים הטבות רק כשמגיעים אליהן */
async function autoScroll() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const startY = window.scrollY;
  let lastHeight = 0;

  for (let step = 0; step < 25; step++) {
    window.scrollBy(0, window.innerHeight);
    await sleep(350);
    const height = document.documentElement.scrollHeight;
    const atBottom = window.innerHeight + window.scrollY >= height - 4;
    if (atBottom && height === lastHeight) break;
    lastHeight = height;
  }

  window.scrollTo(0, startY);
  await sleep(250);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== 'scan') return;

  (async () => {
    try {
      await autoScroll();
      const items = window.BenefitCapture.scanDocument(document);
      chrome.runtime.sendMessage({ type: 'captured-count', count: items.length });
      sendResponse({
        ok: true,
        capturedFrom: location.href,
        pageTitle: document.title,
        items,
      });
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  })();

  return true; // תשובה אסינכרונית
});
