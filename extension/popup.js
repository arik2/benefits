/*
 * חלונית התוסף: סריקה של העמוד הפתוח, פתיחת כל המועדונים בבת אחת,
 * צבירה של מה שנלכד מכל אתר, ושליחה מרוכזת למערכת ההטבות.
 */

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

/* ---------- סריקת כל המועדונים ---------- */

const STATE_ICONS = {
  pending: '⏳', scanning: '🔄', ok: '✅',
  'needs-login': '🔑', error: '⚠️', timeout: '⏱️',
};

function renderRun(run, running) {
  const box = $('#run');
  if (!run || !run.sites) { box.innerHTML = ''; $('#scan-remaining').hidden = true; return; }

  box.innerHTML = run.sites.map((s) => {
    let note = '';
    if (s.state === 'ok' && s.publicOnly) note = 'נסרק, אך לא זוהה אזור אישי';
    else if (s.state === 'ok') {
      const bits = [];
      if (s.status && s.status.points != null) bits.push(`${s.status.points} ${s.status.pointsUnit || 'נקודות'}`);
      if (s.status && s.status.tier) bits.push(s.status.tier);
      if (s.status && s.status.quotaLeft != null) bits.push(`נותרו ${s.status.quotaLeft}`);
      note = bits.join(' · ');
    } else if (s.state === 'needs-login') note = 'צריך להתחבר — הטאב נשאר פתוח';
    else if (s.state === 'timeout') note = 'האתר לא נטען בזמן';
    else if (s.state === 'error') note = s.error || 'שגיאה';

    const count = s.benefits ? `<span class="n">${s.benefits.length}</span>` : '';
    return `<div class="site">
        <span class="st">${STATE_ICONS[s.state] || '·'}</span>
        <span class="st-name">${s.name || s.url}${note ? `<div class="st-note">${note}</div>` : ''}</span>
        ${count}
      </div>`;
  }).join('');

  if (run.done) {
    const ok = run.sites.filter((s) => s.state === 'ok').length;
    const login = run.sites.filter((s) => s.state === 'needs-login').length;
    const bad = run.sites.filter((s) => ['error', 'timeout'].includes(s.state)).length;
    const total = run.sites.reduce((n, s) => n + ((s.benefits || []).length), 0);
    setStatus(`הסתיים: ✅ ${ok} נסרקו (${total} הטבות) · 🔑 ${login} דורשים התחברות · ⚠️ ${bad} נכשלו`);
    $('#scan-remaining').hidden = !(login + bad);
  } else if (running) {
    const cur = run.sites[run.currentIndex];
    setStatus(`סורק ${run.currentIndex + 1} מתוך ${run.sites.length}: ${cur ? cur.name || cur.url : ''}…`);
    $('#scan-remaining').hidden = true;
  }
}

/*
 * הריצה חיה ב-service worker, ולכן החלונית רק דוגמת את המצב.
 * זה גם מה שמאפשר לסגור את החלונית באמצע בלי לעצור את הסריקה.
 */
let pollTimer = null;
function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    const res = await chrome.runtime.sendMessage({ type: 'get-run' });
    if (!res || !res.ok) return;
    renderRun(res.run, res.running);
    if (res.run && res.run.done && !res.running) {
      clearInterval(pollTimer);
      await mergeRunIntoCaptures(res.run);
      renderCaptures();
    }
  }, 500);
}

/* מזרים את תוצאות הריצה לאותו אחסון שממנו נשלחים הנתונים למערכת */
async function mergeRunIntoCaptures(run) {
  const { captures } = await getStore();
  for (const site of run.sites) {
    if (site.state !== 'ok') continue;
    captures[hostOf(site.capturedFrom || site.url)] = {
      capturedFrom: site.capturedFrom || site.url,
      capturedAt: new Date().toISOString().slice(0, 10),
      items: site.benefits || [],
      status: site.status || null,
    };
  }
  await chrome.storage.local.set({ captures });
}

$('#scan-all').addEventListener('click', () => {
  setStatus('מתחיל סריקה… אפשר לסגור את החלונית, הסריקה ממשיכה ברקע');
  chrome.runtime.sendMessage({ type: 'scan-all' });
  startPolling();
});

$('#scan-remaining').addEventListener('click', () => {
  setStatus('סורק מחדש את מה שנותר…');
  chrome.runtime.sendMessage({ type: 'scan-remaining' });
  startPolling();
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

  // אם סריקה רצה ברקע או הסתיימה בזמן שהחלונית הייתה סגורה — להציג אותה
  const res = await chrome.runtime.sendMessage({ type: 'get-run' });
  if (res && res.ok && res.run) {
    renderRun(res.run, res.running);
    if (res.running) startPolling();
  }
})();
