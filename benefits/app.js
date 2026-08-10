/*
 * app.js — ממשק המשתמש.
 * הנתונים נשמרים בדפדפן (localStorage), ואפשר לסנכרן אותם ל-GitHub
 * כדי ששני בני הזוג יראו את אותו מידע.
 */

/* ---------- מפתחות אחסון ---------- */

const LS = {
  db: 'hatavot.db',
  gate: 'hatavot.gate',
  unlocked: 'hatavot.unlocked',
  sync: 'hatavot.sync',
};

const DEFAULT_GATE = '1234';
const DATA_URL = 'data/benefits.json';

let db = null;          // מסד הנתונים הפעיל
let baseDb = null;      // נתוני הבסיס מהקובץ, לצורך איפוס והשוואה
const TODAY = new Date();

/* ---------- עזרים ---------- */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

let toastTimer = null;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

function providerOf(id) {
  return (db.providers || []).find((p) => p.id === id) || { name: id, url: '' };
}

function categoryOf(id) {
  return (db.categories || []).find((c) => c.id === id) || { label: id, icon: '' };
}

/* ---------- טעינת נתונים ---------- */

async function loadDb() {
  const res = await fetch(DATA_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error('לא ניתן לטעון את קובץ הנתונים');
  baseDb = await res.json();

  const stored = localStorage.getItem(LS.db);
  if (stored) {
    try {
      db = JSON.parse(stored);
      // קטגוריות וספקים תמיד מגיעים מהקובץ — הם מבנה, לא תוכן שהמשתמש עורך.
      db.categories = baseDb.categories;
      db.providers = baseDb.providers;
      return;
    } catch (_) {
      // JSON פגום בדפדפן — נופלים חזרה לבסיס במקום להיתקע.
    }
  }
  db = JSON.parse(JSON.stringify(baseDb));
}

function saveDb() {
  db.updatedAt = new Date().toISOString().slice(0, 10);
  localStorage.setItem(LS.db, JSON.stringify(db));
  renderStamp();
}

function renderStamp() {
  const count = db.benefits.length;
  const unverified = db.benefits.filter((b) => b.status === 'unverified').length;
  $('#db-stamp').textContent =
    `${count} הטבות · ${unverified} לאימות · עודכן ${db.updatedAt || '—'}`;
}

/* ---------- מסך כניסה ---------- */

function initGate() {
  const gate = $('#gate');

  if (sessionStorage.getItem(LS.unlocked) === '1') {
    startApp();
    return;
  }

  gate.hidden = false;
  $('#gate-input').focus();

  $('#gate-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const current = localStorage.getItem(LS.gate) || DEFAULT_GATE;
    if ($('#gate-input').value === current) {
      sessionStorage.setItem(LS.unlocked, '1');
      gate.hidden = true;
      startApp();
    } else {
      $('#gate-error').hidden = false;
      $('#gate-input').value = '';
    }
  });
}

async function startApp() {
  $('#gate').hidden = true;
  $('#app').hidden = false;
  try {
    await loadDb();
  } catch (err) {
    $('#app').innerHTML = `<div class="empty">שגיאה בטעינת הנתונים: ${escapeHtml(err.message)}</div>`;
    return;
  }
  buildSelects();
  bindTabs();
  bindAsk();
  bindCompare();
  bindBrowse();
  bindManage();
  bindSettings();
  renderStamp();
  renderBrowse();
  renderManageList();
}

/* ---------- לשוניות ---------- */

function bindTabs() {
  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.tab').forEach((t) => t.classList.remove('active'));
      $$('.panel').forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      $('#panel-' + tab.dataset.tab).classList.add('active');
      window.scrollTo({ top: 0 });
    });
  });
}

/* ---------- מילוי רשימות בחירה ---------- */

function buildSelects() {
  const cats = db.categories || [];
  const provs = db.providers || [];

  const catOptions = cats.map((c) => `<option value="${c.id}">${c.icon} ${escapeHtml(c.label)}</option>`).join('');
  $('#cmp-cat').innerHTML = catOptions;
  $('#f-categories').innerHTML = catOptions;

  const provOptions = provs.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  $('#f-provider').innerHTML = provOptions;
  $('#browse-provider').innerHTML = '<option value="">הכל</option>' + provOptions;

  const examples = [
    'איפה כדאי לקנות מקרר',
    'הנחות על מלון בארץ',
    'סרט בקולנוע',
    'קניות בסופר',
    'הוצאות בחול',
    'עמלות בנק',
  ];
  $('#ask-examples').innerHTML = examples
    .map((q) => `<button class="chip" data-q="${escapeHtml(q)}">${escapeHtml(q)}</button>`)
    .join('');
  $('#ask-examples').addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    $('#ask-q').value = btn.dataset.q;
    runAsk();
  });
}

/* ---------- כרטיס תוצאה ---------- */

function resultCard(row, rank) {
  const b = row.benefit;
  const prov = providerOf(b.provider);
  const isBest = rank === 0 && row.saving.computable && row.saving.amount > 0;

  const badges = [];
  if (isBest) badges.push('<span class="badge rank">הכי משתלם</span>');
  badges.push(b.status === 'verified'
    ? '<span class="badge verified">מאומת</span>'
    : '<span class="badge unverified">לאימות</span>');
  if (row.expiry.expired) badges.push('<span class="badge expired">פג תוקף</span>');
  else if (row.expiry.soon) badges.push(`<span class="badge expiring">נותרו ${row.expiry.daysLeft} ימים</span>`);
  if (b.requiresCard) badges.push(`<span class="badge card">חובה: ${escapeHtml(b.requiresCard)}</span>`);

  const cats = (b.categories || []).map((id) => categoryOf(id).label).join(' · ');

  const savingBox = row.saving.computable
    ? `<div class="saving">
         <span class="num">${Engine.formatIls(row.saving.amount)}</span>
         <span class="cap">${escapeHtml(row.saving.label)}</span>
       </div>`
    : `<div class="saving flat">
         <span class="num">—</span>
         <span class="cap">${escapeHtml(row.saving.label)}</span>
       </div>`;

  const sourceLink = b.source
    ? `<a class="link-btn" href="${escapeHtml(b.source)}" target="_blank" rel="noopener">מקור</a>`
    : '';

  return `
    <article class="result${isBest ? ' best' : ''}">
      <div class="result-head">
        <div>
          <h3 class="result-title">${escapeHtml(b.title)}</h3>
          <div class="result-provider">${escapeHtml(prov.name)}${cats ? ' · ' + escapeHtml(cats) : ''}</div>
        </div>
        ${savingBox}
      </div>
      <div class="badges">${badges.join('')}</div>
      ${b.conditions ? `<div class="result-body">${escapeHtml(b.conditions)}</div>` : ''}
      <div class="result-actions">
        ${sourceLink}
        <button class="link-btn" data-edit="${escapeHtml(b.id)}">ערוך</button>
      </div>
    </article>`;
}

function renderResults(container, rows, emptyText) {
  if (!rows.length) {
    container.innerHTML = `<div class="empty">${escapeHtml(emptyText)}</div>`;
    return;
  }
  container.innerHTML = rows.map((row, i) => resultCard(row, i)).join('');
}

// עריכה מכל מקום שבו מוצג כרטיס תוצאה
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-edit]');
  if (!btn) return;
  editBenefit(btn.dataset.edit);
});

/* ---------- שאלה חופשית ---------- */

function bindAsk() {
  $('#ask-go').addEventListener('click', runAsk);
  $('#ask-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') runAsk(); });
}

function runAsk() {
  const q = $('#ask-q').value.trim();
  const amount = parseFloat($('#ask-amount').value) || 0;
  if (!q) { toast('כתבו מה אתם מחפשים'); return; }

  const rows = Engine.search(db, q, amount, TODAY);
  renderResults(
    $('#ask-results'),
    rows,
    'לא נמצאה הטבה מתאימה. נסו מילים אחרות, או הוסיפו את ההטבה בלשונית "ניהול".'
  );
}

/* ---------- השוואה ---------- */

function bindCompare() {
  $('#cmp-go').addEventListener('click', runCompare);
}

function runCompare() {
  const cat = $('#cmp-cat').value;
  const amount = parseFloat($('#cmp-amount').value) || 0;
  if (!amount) { toast('הזינו סכום'); return; }

  const rows = Engine.rankByCategory(db, cat, amount, TODAY);
  renderResults(
    $('#cmp-results'),
    rows,
    'אין הטבות רשומות בקטגוריה הזו. הוסיפו אחת בלשונית "ניהול".'
  );
}

/* ---------- עיון ---------- */

function bindBrowse() {
  $('#browse-provider').addEventListener('change', renderBrowse);
  $('#browse-expiring').addEventListener('change', renderBrowse);
}

function renderBrowse() {
  const prov = $('#browse-provider').value;
  const onlyExpiring = $('#browse-expiring').checked;

  const rows = db.benefits
    .filter((b) => !prov || b.provider === prov)
    // בעיון אין סכום, ולכן מציגים את שיעור ההטבה במקום חיסכון מחושב.
    .map((b) => ({
      benefit: b,
      saving: { amount: 0, label: Engine.describeRate(b), computable: false },
      expiry: Engine.expiryState(b, TODAY),
    }))
    .filter((row) => !onlyExpiring || row.expiry.expired || row.expiry.soon)
    .sort((a, b) => a.benefit.provider.localeCompare(b.benefit.provider));

  renderResults($('#browse-results'), rows, 'אין הטבות להצגה בסינון הזה.');
}

/* ---------- ניהול ---------- */

function bindManage() {
  $('#f-kind').addEventListener('change', updateValueLabel);
  updateValueLabel();

  $('#f-save').addEventListener('click', saveBenefitFromForm);
  $('#f-clear').addEventListener('click', clearForm);

  $('#btn-export').addEventListener('click', exportJson);
  $('#btn-import').addEventListener('click', () => $('#file-input').click());
  $('#file-input').addEventListener('change', importJson);
  $('#btn-sync').addEventListener('click', pushToGithub);
  $('#btn-reset').addEventListener('click', resetToBase);
}

function updateValueLabel() {
  const kind = $('#f-kind').value;
  const labels = {
    percent: 'אחוז הנחה (למשל 15)',
    cashback: 'אחוז החזר (למשל 5)',
    fixed: 'סכום ההנחה בשקלים',
    bogo: 'לא רלוונטי — 1+1 מחושב אוטומטית',
    points: 'כמה שקלים נדרשים לנקודה אחת (למשל 4)',
    info: 'לא רלוונטי',
  };
  $('#f-value-label').textContent = labels[kind] || 'ערך';
  $('#f-value').disabled = (kind === 'info' || kind === 'bogo');
}

function clearForm() {
  $('#f-id').value = '';
  $('#f-title').value = '';
  $('#f-value').value = '10';
  $('#f-cap').value = '';
  $('#f-min').value = '';
  $('#f-card').value = '';
  $('#f-until').value = '';
  $('#f-conditions').value = '';
  $('#f-source').value = '';
  $('#f-tags').value = '';
  $('#f-status').value = 'unverified';
  $('#f-kind').value = 'percent';
  Array.from($('#f-categories').options).forEach((o) => { o.selected = false; });
  $('#manage-title').textContent = 'הוספת הטבה';
  updateValueLabel();
}

function editBenefit(id) {
  const b = db.benefits.find((x) => x.id === id);
  if (!b) return;

  $('#f-id').value = b.id;
  $('#f-provider').value = b.provider;
  $('#f-title').value = b.title || '';
  $('#f-kind').value = b.kind || 'percent';
  $('#f-value').value = b.value != null ? b.value : '';
  $('#f-cap').value = b.capPerTx != null ? b.capPerTx : '';
  $('#f-min').value = b.minSpend || '';
  $('#f-card').value = b.requiresCard || '';
  $('#f-until').value = b.validUntil || '';
  $('#f-conditions').value = b.conditions || '';
  $('#f-source').value = b.source || '';
  $('#f-tags').value = (b.tags || []).join(', ');
  $('#f-status').value = b.status === 'verified' ? 'verified' : 'unverified';
  Array.from($('#f-categories').options).forEach((o) => {
    o.selected = (b.categories || []).includes(o.value);
  });

  $('#manage-title').textContent = 'עריכת הטבה';
  updateValueLabel();

  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === 'manage'));
  $$('.panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-manage'));
  window.scrollTo({ top: 0 });
}

function saveBenefitFromForm() {
  const title = $('#f-title').value.trim();
  const categories = Array.from($('#f-categories').selectedOptions).map((o) => o.value);

  if (!title) { toast('חסרה כותרת'); return; }
  if (!categories.length) { toast('בחרו לפחות קטגוריה אחת'); return; }

  const kind = $('#f-kind').value;
  const numOrNull = (sel) => {
    const raw = $(sel).value;
    return raw === '' ? null : parseFloat(raw);
  };

  const record = {
    id: $('#f-id').value || 'local-' + Date.now().toString(36),
    provider: $('#f-provider').value,
    title,
    categories,
    kind,
    value: (kind === 'info' || kind === 'bogo') ? 0 : (parseFloat($('#f-value').value) || 0),
    capPerTx: numOrNull('#f-cap'),
    minSpend: numOrNull('#f-min') || 0,
    requiresCard: $('#f-card').value.trim() || null,
    validUntil: $('#f-until').value || null,
    conditions: $('#f-conditions').value.trim(),
    source: $('#f-source').value.trim(),
    tags: $('#f-tags').value.split(',').map((t) => t.trim()).filter(Boolean),
    status: $('#f-status').value,
    checkedAt: new Date().toISOString().slice(0, 10),
  };

  const idx = db.benefits.findIndex((b) => b.id === record.id);
  if (idx >= 0) db.benefits[idx] = record;
  else db.benefits.push(record);

  saveDb();
  clearForm();
  renderManageList();
  renderBrowse();
  toast(idx >= 0 ? 'ההטבה עודכנה' : 'ההטבה נוספה');
}

function deleteBenefit(id) {
  const b = db.benefits.find((x) => x.id === id);
  if (!b) return;
  if (!confirm(`למחוק את "${b.title}"?`)) return;
  db.benefits = db.benefits.filter((x) => x.id !== id);
  saveDb();
  renderManageList();
  renderBrowse();
  toast('נמחק');
}

// רשומות שנוספו או שונו מול נתוני הבסיס — כדי לדעת מה עוד לא סונכרן.
function changedBenefits() {
  const baseById = Object.fromEntries((baseDb.benefits || []).map((b) => [b.id, JSON.stringify(b)]));
  return db.benefits.filter((b) => baseById[b.id] !== JSON.stringify(b));
}

function renderManageList() {
  const changed = changedBenefits();
  const box = $('#manage-list');
  if (!changed.length) {
    box.innerHTML = '<div class="empty">עוד לא הוספתם או שיניתם הטבות.</div>';
    return;
  }
  box.innerHTML = changed.map((b) => {
    const prov = providerOf(b.provider);
    return `
      <article class="result">
        <div class="result-head">
          <div>
            <h3 class="result-title">${escapeHtml(b.title)}</h3>
            <div class="result-provider">${escapeHtml(prov.name)}</div>
          </div>
        </div>
        <div class="result-actions">
          <button class="link-btn" data-edit="${escapeHtml(b.id)}">ערוך</button>
          <button class="link-btn" data-del="${escapeHtml(b.id)}">מחק</button>
        </div>
      </article>`;
  }).join('');

  box.querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', () => deleteBenefit(btn.dataset.del));
  });
}

/* ---------- ייצוא, ייבוא, איפוס ---------- */

function exportJson() {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'benefits.json';
  a.click();
  URL.revokeObjectURL(url);
}

function importJson(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!Array.isArray(parsed.benefits)) throw new Error('הקובץ לא בפורמט הנכון');
      db = parsed;
      db.categories = baseDb.categories;
      db.providers = baseDb.providers;
      saveDb();
      renderManageList();
      renderBrowse();
      toast('הנתונים יובאו');
    } catch (err) {
      toast('שגיאה: ' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

function resetToBase() {
  if (!confirm('לאפס לנתוני הבסיס? כל מה שהוספתם בדפדפן הזה יימחק.')) return;
  localStorage.removeItem(LS.db);
  db = JSON.parse(JSON.stringify(baseDb));
  saveDb();
  renderManageList();
  renderBrowse();
  toast('אופס לנתוני הבסיס');
}

/* ---------- סנכרון GitHub ---------- */

function syncConfig() {
  try {
    return JSON.parse(localStorage.getItem(LS.sync) || '{}');
  } catch (_) {
    return {};
  }
}

// btoa לבדו נשבר על עברית — צריך לקודד ל-UTF-8 קודם.
function toBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

function fromBase64Utf8(b64) {
  const binary = atob(b64.replace(/\n/g, ''));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function pushToGithub() {
  const cfg = syncConfig();
  if (!cfg.token || !cfg.repo) {
    toast('הגדירו טוקן וריפו בלשונית "הגדרות"');
    return;
  }

  const status = $('#sync-status');
  status.textContent = 'מסנכרן...';
  const path = 'benefits/data/benefits.json';
  const branch = cfg.branch || 'master';
  const api = `https://api.github.com/repos/${cfg.repo}/contents/${path}`;
  const headers = {
    Authorization: `Bearer ${cfg.token}`,
    Accept: 'application/vnd.github+json',
  };

  try {
    // צריך את ה-sha הנוכחי כדי ש-GitHub יאשר החלפה של קובץ קיים.
    let sha;
    const head = await fetch(`${api}?ref=${encodeURIComponent(branch)}`, { headers });
    if (head.ok) sha = (await head.json()).sha;
    else if (head.status !== 404) throw new Error(`שגיאה בקריאת הקובץ (${head.status})`);

    const body = {
      message: 'עדכון הטבות מהאתר',
      content: toBase64Utf8(JSON.stringify(db, null, 2)),
      branch,
    };
    if (sha) body.sha = sha;

    const res = await fetch(api, { method: 'PUT', headers, body: JSON.stringify(body) });
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      throw new Error(detail.message || `שגיאה ${res.status}`);
    }

    status.textContent = 'סונכרן בהצלחה. בן/בת הזוג יראו את העדכון אחרי רענון.';
    toast('סונכרן ל-GitHub');
  } catch (err) {
    status.textContent = 'הסנכרון נכשל: ' + err.message;
    toast('הסנכרון נכשל');
  }
}

async function pullFromGithub() {
  const cfg = syncConfig();
  const branch = cfg.branch || 'master';
  const path = 'benefits/data/benefits.json';

  try {
    let text;
    if (cfg.token && cfg.repo) {
      const res = await fetch(
        `https://api.github.com/repos/${cfg.repo}/contents/${path}?ref=${encodeURIComponent(branch)}`,
        { headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json' } }
      );
      if (!res.ok) throw new Error(`שגיאה ${res.status}`);
      text = fromBase64Utf8((await res.json()).content);
    } else {
      const res = await fetch(DATA_URL + '?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('שגיאה בטעינה');
      text = await res.text();
    }

    if (!confirm('משיכה תחליף את הנתונים בדפדפן הזה בגרסה מהשרת. להמשיך?')) return;

    const parsed = JSON.parse(text);
    baseDb = parsed;
    db = JSON.parse(JSON.stringify(parsed));
    saveDb();
    renderManageList();
    renderBrowse();
    toast('הנתונים עודכנו מהשרת');
  } catch (err) {
    toast('המשיכה נכשלה: ' + err.message);
  }
}

/* ---------- הגדרות ---------- */

function bindSettings() {
  const settings = db.settings || { pointValueIls: {} };
  $('#s-elal').value = (settings.pointValueIls || {}).elal ?? 0;
  $('#s-max').value = (settings.pointValueIls || {}).max_pinuk ?? 0;

  $('#s-save').addEventListener('click', () => {
    db.settings = db.settings || {};
    db.settings.pointValueIls = {
      elal: parseFloat($('#s-elal').value) || 0,
      max_pinuk: parseFloat($('#s-max').value) || 0,
    };
    saveDb();
    toast('ההגדרות נשמרו');
  });

  const cfg = syncConfig();
  $('#s-token').value = cfg.token || '';
  $('#s-repo').value = cfg.repo || 'arik2/2015_04_Web';
  $('#s-branch').value = cfg.branch || 'master';

  $('#s-save-sync').addEventListener('click', () => {
    localStorage.setItem(LS.sync, JSON.stringify({
      token: $('#s-token').value.trim(),
      repo: $('#s-repo').value.trim(),
      branch: $('#s-branch').value.trim() || 'master',
    }));
    toast('הגדרות הסנכרון נשמרו');
  });

  $('#s-pull').addEventListener('click', pullFromGithub);

  $('#s-save-gate').addEventListener('click', () => {
    const code = $('#s-gate').value.trim();
    if (code.length < 4) { toast('בחרו קוד באורך 4 תווים לפחות'); return; }
    localStorage.setItem(LS.gate, code);
    $('#s-gate').value = '';
    toast('קוד הכניסה עודכן בדפדפן הזה');
  });
}

/* ---------- הפעלה ---------- */

initGate();
