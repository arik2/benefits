/*
 * חלונית התוסף: סריקה של העמוד הפתוח, פתיחת כל המועדונים בבת אחת,
 * צבירה של מה שנלכד מכל אתר, ושליחה מרוכזת למערכת ההטבות.
 */

/* עמודי ההטבות של המועדונים, לכפתור "פתח את כל המועדונים" */
const CLUB_PAGES = [
  'https://www.htzone.co.il/',
  'https://www.dts.co.il/',
  'https://be-plus.co.il/',
  'https://paisplus.co.il/',
  'https://www.max.co.il/benefits/lobby',
  'https://www.cal-online.co.il/benefits/',
  'https://www.mafteach.co.il/',
  'https://www.isracard.co.il/flycard/private',
  'https://fox.co.il/pages/dream-card-%D7%94%D7%98%D7%91%D7%95%D7%AA-%D7%9E%D7%95%D7%A2%D7%93%D7%95%D7%9F',
];

const $ = (s) => document.querySelector(s);

function setStatus(text, isError) {
  const el = $('#status');
  el.textContent = text || '';
  el.className = 'status' + (isError ? ' err' : '');
}

/*
 * הטאב שנסרק הוא הטאב הפעיל בחלון. כשהחלונית נפתחת כטאב בפני עצמה
 * (קורה בבדיקות), הטאב הפעיל הוא החלונית — ואז ניקח את הטאב האחרון
 * שאינו עמוד של התוסף.
 */
async function targetTab() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active && !active.url.startsWith('chrome-extension://')) return active;
  const all = await chrome.tabs.query({ currentWindow: true });
  return all.reverse().find((t) => /^https?:/.test(t.url || ''));
}

async function getStore() {
  const data = await chrome.storage.local.get(['captures', 'appUrl']);
  return { captures: data.captures || {}, appUrl: data.appUrl || '' };
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return url; }
}

async function renderCaptures() {
  const { captures } = await getStore();
  const hosts = Object.keys(captures);
  const box = $('#captures');

  if (!hosts.length) {
    box.innerHTML = '<div class="empty">עוד לא נלכד כלום. היכנסו לעמוד הטבות של מועדון ולחצו "סרוק".</div>';
    return;
  }

  box.innerHTML = hosts.map((h) => `
    <div class="site">
      <span>${h}</span>
      <span><span class="n">${captures[h].items.length}</span> הטבות
        <button class="del" data-host="${h}" title="הסר">✕</button>
      </span>
    </div>`).join('');

  box.querySelectorAll('.del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const { captures: current } = await getStore();
      delete current[btn.dataset.host];
      await chrome.storage.local.set({ captures: current });
      renderCaptures();
    });
  });
}

/* ---------- סריקה ---------- */

$('#scan').addEventListener('click', async () => {
  const tab = await targetTab();
  if (!tab) { setStatus('לא נמצא טאב לסריקה', true); return; }

  setStatus('סורק... העמוד נגלל עד הסוף, זה לוקח כמה שניות');

  let res;
  try {
    res = await chrome.tabs.sendMessage(tab.id, { type: 'scan' });
  } catch (err) {
    setStatus('לא ניתן לסרוק את העמוד הזה. ודאו שאתם באתר של אחד המועדונים, ורעננו את העמוד.', true);
    return;
  }

  if (!res || !res.ok) {
    setStatus('הסריקה נכשלה: ' + ((res && res.error) || 'שגיאה לא ידועה'), true);
    return;
  }
  if (!res.items.length) {
    setStatus('לא זוהו הטבות בעמוד. נסו לנווט לעמוד ההטבות עצמו.', true);
    return;
  }

  const { captures } = await getStore();
  captures[hostOf(res.capturedFrom)] = {
    capturedFrom: res.capturedFrom,
    capturedAt: new Date().toISOString().slice(0, 10),
    items: res.items,
  };
  await chrome.storage.local.set({ captures });

  setStatus(`נלכדו ${res.items.length} הטבות מ-${hostOf(res.capturedFrom)}`);
  renderCaptures();
});

/* ---------- פתיחת כל המועדונים ---------- */

$('#open-all').addEventListener('click', () => {
  CLUB_PAGES.forEach((url) => chrome.tabs.create({ url, active: false }));
  setStatus(`נפתחו ${CLUB_PAGES.length} מועדונים בטאבים. עברו ביניהם, התחברו אם צריך, ולחצו "סרוק" בכל אחד.`);
});

/* ---------- שליחה למערכת ---------- */

$('#send').addEventListener('click', async () => {
  const { captures, appUrl } = await getStore();
  const hosts = Object.keys(captures);
  if (!hosts.length) { setStatus('אין מה לשלוח — סרקו קודם', true); return; }

  const payload = { captures: hosts.map((h) => captures[h]) };
  const json = JSON.stringify(payload);

  if (appUrl) {
    /*
     * הנתונים עוברים בחלק ה-hash של הכתובת. hash לא נשלח לשום שרת —
     * הוא נשאר בדפדפן, והמערכת קוראת אותו ומנקה מיד.
     */
    const encoded = btoa(unescape(encodeURIComponent(json)));
    await chrome.tabs.create({ url: appUrl.split('#')[0] + '#capimport=' + encoded });
    setStatus('נפתחה המערכת עם הנתונים. אשרו שם את הייבוא.');
  } else {
    await navigator.clipboard.writeText(json);
    setStatus('הועתק ללוח. הדביקו במערכת בלשונית ניהול ← ייבוא מלכידה. (אפשר להזין למטה את כתובת המערכת כדי לדלג על שלב זה)');
  }
});

/* ---------- ניקוי והגדרות ---------- */

$('#clear').addEventListener('click', async () => {
  await chrome.storage.local.set({ captures: {} });
  setStatus('הלכידות נוקו');
  renderCaptures();
});

$('#app-url').addEventListener('change', async () => {
  await chrome.storage.local.set({ appUrl: $('#app-url').value.trim() });
  setStatus('כתובת המערכת נשמרה');
});

/* ---------- אתחול ---------- */

(async () => {
  const { appUrl } = await getStore();
  $('#app-url').value = appUrl;
  renderCaptures();
})();
