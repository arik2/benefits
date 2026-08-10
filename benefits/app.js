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

/*
 * בחירות המשתמש כשלהטבה יש כמה אפשרויות ("קנייה רגילה" מול "יום הולדת").
 * נשמר לפי מזהה הטבה, ומתאפס בכל חיפוש חדש כדי שבחירה משאלה קודמת
 * לא תזלוג לשאלה הבאה ותשנה תשובה בלי שהמשתמש ישים לב.
 */
let variantPicks = {};
let lastQuery = null;   // מאפשר להריץ מחדש את אותה שאילתה אחרי בחירה

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
  receiveHashImport();
}

/*
 * קליטת נתונים שתוסף הדפדפן שלח דרך ה-hash של הכתובת.
 * ה-hash לא נשלח לשום שרת — הוא חי רק בדפדפן, ומנוקה מיד אחרי הקריאה
 * כדי שלא יישאר ברשימת הכתובות או בהיסטוריה.
 */
function receiveHashImport() {
  const hash = window.location.hash || '';
  if (!hash.startsWith('#capimport=')) return;

  let json = '';
  try {
    json = decodeURIComponent(escape(atob(hash.slice('#capimport='.length))));
    JSON.parse(json); // אימות בלבד — התצוגה המקדימה תפענח שוב
  } catch (err) {
    history.replaceState(null, '', window.location.pathname);
    toast('הנתונים מהתוסף לא נקראו. נסו להעתיק ולהדביק ידנית.');
    return;
  }

  history.replaceState(null, '', window.location.pathname);

  // מעבר ללשונית הניהול, מילוי התיבה והצגת התצוגה המקדימה
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === 'manage'));
  $$('.panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-manage'));
  $('#cap-paste').value = json;
  previewCapture();
  $('#cap-preview').scrollIntoView({ block: 'center' });
  toast('התקבלו נתונים מהתוסף — בדקו ואשרו את הייבוא');
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

  // רשימת בתי העסק המוכרים, להשלמה אוטומטית בשדה החיפוש
  $('#merchant-list').innerHTML = Engine.allMerchants(db)
    .map((m) => `<option value="${escapeHtml(m)}"></option>`)
    .join('');

  const examples = [
    'קנייה בפוקס ב-400 שקל',
    'מקרר ב-4,000',
    'מלון ביום שישי ב-2,000',
    'סרט בקולנוע',
    'הוצאות בחו"ל ב-5,000',
  ];
  $('#ask-examples').innerHTML = examples
    .map((ex, i) => `<button class="chip" data-example="${i}">${escapeHtml(ex)}</button>`)
    .join('');
  $('#ask-examples').addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    $('#ask-q').value = examples[Number(btn.dataset.example)];
    runAsk();
  });
}

/* ---------- כרטיס תוצאה ---------- */

function statusBadge(status) {
  if (status === 'verified') return '<span class="badge verified">מאומת</span>';
  if (status === 'example') return '<span class="badge example">דוגמה — לא אמיתי</span>';
  return '<span class="badge unverified">לאימות</span>';
}

function resultCard(row, rank) {
  const b = row.benefit;
  const ev = row.evaluation || { needsChoice: false, choices: [], chosen: null, active: true };
  const prov = providerOf(b.provider);

  // הטבה שעדיין מחכה להבהרה אינה יכולה להיות "הכי משתלם" — המספר שלה
  // הוא תקרה ולא תשובה, ולהכתיר אותה יטעה.
  const isBest = rank === 0 && row.saving.computable && row.saving.amount > 0
    && !ev.needsChoice && !row.saving.isUpperBound;

  const badges = [];
  if (isBest) badges.push('<span class="badge rank">הכי משתלם</span>');
  badges.push(statusBadge(b.status));
  if (!ev.active) badges.push('<span class="badge expired">לא תקף בתאריך שנבחר</span>');
  if (row.expiry.expired) badges.push('<span class="badge expired">פג תוקף</span>');
  else if (row.expiry.soon) badges.push(`<span class="badge expiring">נותרו ${row.expiry.daysLeft} ימים</span>`);
  if (b.requiresCard) badges.push(`<span class="badge card">חובה: ${escapeHtml(b.requiresCard)}</span>`);

  const cats = (b.categories || []).map((id) => categoryOf(id).label).join(' · ');
  const merchants = (b.merchants || []).length
    ? `<div class="merchants">${(b.merchants || []).map((m) => `<span class="merchant">${escapeHtml(m)}</span>`).join('')}</div>`
    : '';

  const savingBox = row.saving.computable
    ? `<div class="saving${row.saving.isUpperBound ? ' bound' : ''}">
         <span class="num">${row.saving.isUpperBound ? 'עד ' : ''}${Engine.formatIls(row.saving.amount)}</span>
         <span class="cap">${escapeHtml(row.saving.label)}</span>
       </div>`
    : `<div class="saving flat">
         <span class="num">—</span>
         <span class="cap">${escapeHtml(row.saving.label)}</span>
       </div>`;

  // שאלת ההבהרה: כשיש כמה אפשרויות, שואלים במקום לנחש.
  let choiceBlock = '';
  if (ev.needsChoice) {
    const options = ev.choices.map((c) => {
      const hint = c.saving.computable ? Engine.formatIls(c.saving.amount) : c.saving.label;
      return `<button class="chip choice-chip" data-pick-benefit="${escapeHtml(b.id)}" data-pick-variant="${escapeHtml(c.id)}">
                ${escapeHtml(c.label)} <span class="chip-val">${escapeHtml(hint)}</span>
              </button>`;
    }).join('');
    choiceBlock = `
      <div class="choice">
        <div class="choice-q">כדי לענות במדויק — מה מתאים לכם?</div>
        <div class="chips">${options}</div>
      </div>`;
  } else if (ev.chosen) {
    choiceBlock = `
      <div class="choice chosen">
        <div class="choice-q">נבחר: <strong>${escapeHtml(ev.chosen.label)}</strong>
          <button class="link-btn" data-pick-benefit="${escapeHtml(b.id)}" data-pick-variant="">שנה</button>
        </div>
        ${ev.chosen.conditions ? `<div class="result-body">${escapeHtml(ev.chosen.conditions)}</div>` : ''}
      </div>`;
  }

  const sourceLink = b.source
    ? `<a class="link-btn" href="${escapeHtml(b.source)}" target="_blank" rel="noopener">מקור</a>`
    : '';

  return `
    <article class="result${isBest ? ' best' : ''}${b.status === 'example' ? ' is-example' : ''}">
      <div class="result-head">
        <div>
          <h3 class="result-title">${escapeHtml(b.title)}</h3>
          <div class="result-provider">${escapeHtml(prov.name)}${cats ? ' · ' + escapeHtml(cats) : ''}</div>
        </div>
        ${savingBox}
      </div>
      ${merchants}
      <div class="badges">${badges.join('')}</div>
      ${choiceBlock}
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
  const editBtn = e.target.closest('[data-edit]');
  if (editBtn) { editBenefit(editBtn.dataset.edit); return; }

  // בחירת אפשרות בשאלת ההבהרה — מריץ מחדש את אותה שאילתה עם הבחירה
  const pickBtn = e.target.closest('[data-pick-benefit]');
  if (pickBtn) {
    const id = pickBtn.dataset.pickBenefit;
    const variant = pickBtn.dataset.pickVariant;
    if (variant) variantPicks[id] = variant;
    else delete variantPicks[id];
    rerunLastQuery();
  }
});

// תאריך שנבחר בטופס, או היום אם לא נבחר
function dateFrom(selector) {
  const raw = $(selector).value;
  if (!raw) return TODAY;
  const d = new Date(raw + 'T12:00:00');
  return isNaN(d.getTime()) ? TODAY : d;
}

function queryOpts(dateSelector) {
  return { date: dateFrom(dateSelector), variantPicks };
}

function rerunLastQuery() {
  if (lastQuery === 'ask') runAsk(true);
  else if (lastQuery === 'compare') runCompare(true);
}

/* ---------- שאלה חופשית — שורה אחת כמו בצ'אט ---------- */

function bindAsk() {
  $('#ask-go').addEventListener('click', () => runAsk());
  $('#ask-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') runAsk(); });
}

/*
 * מפרק את השורה שהמשתמש כתב, מרכיב תוכנית קנייה, ומציג אותה
 * כתשובה אחת ברורה — ומתחתיה כרטיסי כל האפשרויות למי שרוצה לצלול.
 */
function runAsk(keepPicks) {
  const q = $('#ask-q').value.trim();
  if (!q) { toast('כתבו מה אתם רוצים לקנות, איפה ובכמה'); return; }
  if (!keepPicks) variantPicks = {};
  lastQuery = 'ask';

  const parsed = Engine.parseQuery(db, q, TODAY);
  const plan = Engine.composePlan(db, parsed, TODAY, variantPicks);

  // "הבנתי: פוקס · 400 ₪ · יום שישי" — כדי שטעות פירוק תיראה מיד
  const parsedBits = [];
  if (parsed.merchant) parsedBits.push('🏬 ' + parsed.merchant);
  if (parsed.amount) parsedBits.push(Engine.formatIls(parsed.amount));
  if (parsed.date) parsedBits.push('📅 ' + Engine.formatDate(parsed.date.toISOString().slice(0, 10)));
  const parsedEl = $('#ask-parsed');
  parsedEl.hidden = !parsedBits.length;
  parsedEl.textContent = parsedBits.length ? 'הבנתי: ' + parsedBits.join(' · ') : '';

  $('#ask-answer').innerHTML = renderPlan(plan);

  const emptyText = 'לא נמצאה הטבה מתאימה. נסו מילים אחרות, או הוסיפו את ההטבה בלשונית "ניהול".';
  renderResults($('#ask-results'), plan.rows, plan.rows.length ? '' : emptyText);
  if (plan.merchantMiss && plan.rows.length) {
    prependNote($('#ask-results'),
      `אין הטבה שרשומה במפורש על "${escapeHtml(parsed.merchant)}". אלה הטבות כלליות שאולי רלוונטיות.`);
  }
}

function renderPlan(plan) {
  if (!plan.rows.length) return '';

  const parts = [];

  if (plan.noAmount) {
    parts.push(`<div class="plan-note">💡 כתבו גם סכום ("ב-400 שקל") ואחשב כמה תחסכו בכל אפשרות.</div>`);
  }

  if (plan.primary) {
    const p = plan.primary;
    const steps = p.steps.length
      ? `<ol class="plan-steps">${p.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ol>`
      : '';
    const verify = p.verified ? '' : `<div class="plan-caveat">הנתון מסומן "לאימות" — בדקו את המספר באתר המועדון לפני שסומכים עליו.</div>`;
    parts.push(`
      <div class="plan">
        <div class="plan-head">
          <span class="plan-label">הכי משתלם עכשיו</span>
          <span class="plan-saving">חיסכון ~${Engine.formatIls(p.saving)}</span>
        </div>
        <div class="plan-title">${escapeHtml(p.title)} <span class="plan-provider">(${escapeHtml(p.providerName)})</span></div>
        ${steps}
        ${verify}
      </div>`);
  }

  if (plan.question) {
    const qc = plan.question;
    const chips = qc.choices.map((c) => {
      const val = c.saving != null ? Engine.formatIls(c.saving) : '';
      return `<button class="chip choice-chip" data-pick-benefit="${escapeHtml(qc.benefitId)}" data-pick-variant="${escapeHtml(c.id)}">
                ${escapeHtml(c.label)} <span class="chip-val">${val}</span>
              </button>`;
    }).join('');
    parts.push(`
      <div class="plan ask">
        <div class="plan-title">יכול להיות אפילו יותר משתלם — עד ${Engine.formatIls(qc.upTo)} — תלוי במצב שלכם:</div>
        <div class="chips">${chips}</div>
      </div>`);
  }

  if (plan.alternatives.length && plan.primary) {
    const alts = plan.alternatives.map((a) => {
      const val = a.saving != null ? `${a.isUpperBound ? 'עד ' : ''}${Engine.formatIls(a.saving)}` : a.savingLabel;
      return `<li>${escapeHtml(a.title)} (${escapeHtml(a.providerName)}) — ${escapeHtml(val)}</li>`;
    }).join('');
    parts.push(`<div class="plan-alts"><span>עוד אפשרויות:</span><ul>${alts}</ul></div>`);
  }

  return parts.join('');
}

function prependNote(container, html) {
  const note = document.createElement('div');
  note.className = 'note';
  note.innerHTML = html;
  container.prepend(note);
}

/* ---------- השוואה ---------- */

function bindCompare() {
  $('#cmp-go').addEventListener('click', () => runCompare());
}

function runCompare(keepPicks) {
  const cat = $('#cmp-cat').value;
  const amount = parseFloat($('#cmp-amount').value) || 0;
  if (!amount) { toast('הזינו סכום'); return; }

  if (!keepPicks) variantPicks = {};
  lastQuery = 'compare';

  const rows = Engine.rankByCategory(db, cat, amount, TODAY, queryOpts('#cmp-date'));
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
      evaluation: { needsChoice: false, choices: [], chosen: null, active: true },
      expiry: Engine.expiryState(b, TODAY),
    }))
    .filter((row) => !onlyExpiring || row.expiry.expired || row.expiry.soon)
    .sort((a, b) => a.benefit.provider.localeCompare(b.benefit.provider));

  renderResults($('#browse-results'), rows, 'אין הטבות להצגה בסינון הזה.');
}

/* ---------- ניהול ---------- */

/* ---------- עורך האפשרויות (variants) ---------- */

const KIND_LABELS = {
  percent: 'אחוז הנחה',
  cashback: 'אחוז החזר',
  fixed: 'סכום קבוע ₪',
  bogo: '1+1',
  points: 'נקודות',
  info: 'מידע בלבד',
};

function variantRowHtml(v, index) {
  const kindOptions = Object.entries(KIND_LABELS)
    .map(([k, label]) => `<option value="${k}"${(v.kind || 'percent') === k ? ' selected' : ''}>${label}</option>`)
    .join('');

  const days = Engine.DAY_NAMES.map((name, d) => {
    const checked = (v.validDays || []).includes(d) ? ' checked' : '';
    return `<label class="day"><input type="checkbox" data-day="${d}"${checked}><span>${name.slice(0, 2)}</span></label>`;
  }).join('');

  return `
    <div class="variant-row" data-index="${index}">
      <div class="variant-head">
        <input type="text" class="v-label" placeholder="מתי זה חל? למשל: חודש יום הולדת" value="${escapeHtml(v.label || '')}">
        <button type="button" class="link-btn v-remove">הסר</button>
      </div>
      <div class="grid2">
        <select class="v-kind">${kindOptions}</select>
        <input type="number" class="v-value" step="0.01" min="0" placeholder="ערך" value="${v.value != null ? v.value : ''}">
      </div>
      <input type="text" class="v-conditions" placeholder="תנאים" value="${escapeHtml(v.conditions || '')}">
      <div class="days">
        <span class="days-label">תקף בימים (ריק = כל הימים):</span>
        ${days}
      </div>
    </div>`;
}

function renderVariants(variants) {
  $('#f-variants').innerHTML = (variants || []).map(variantRowHtml).join('');
}

function readVariantsFromForm() {
  return $$('#f-variants .variant-row').map((row, i) => {
    const label = row.querySelector('.v-label').value.trim();
    const kind = row.querySelector('.v-kind').value;
    const rawValue = row.querySelector('.v-value').value;
    const validDays = Array.from(row.querySelectorAll('[data-day]'))
      .filter((cb) => cb.checked)
      .map((cb) => Number(cb.dataset.day));

    return {
      id: 'v' + i,
      label: label || 'אפשרות ' + (i + 1),
      kind,
      value: rawValue === '' ? 0 : parseFloat(rawValue),
      conditions: row.querySelector('.v-conditions').value.trim(),
      validDays: validDays.length ? validDays : null,
    };
  });
}

function bindManage() {
  $('#f-kind').addEventListener('change', updateValueLabel);
  updateValueLabel();

  $('#f-add-variant').addEventListener('click', () => {
    const current = readVariantsFromForm();
    current.push({ label: '', kind: 'percent', value: null, conditions: '', validDays: null });
    renderVariants(current);
  });

  $('#f-variants').addEventListener('click', (e) => {
    if (!e.target.classList.contains('v-remove')) return;
    const current = readVariantsFromForm();
    current.splice(Number(e.target.closest('.variant-row').dataset.index), 1);
    renderVariants(current);
  });

  $('#btn-del-examples').addEventListener('click', deleteExamples);
  $('#cap-parse').addEventListener('click', previewCapture);

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
  $('#f-merchants').value = '';
  renderVariants([]);
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
  $('#f-merchants').value = (b.merchants || []).join(', ');
  renderVariants(b.variants || []);
  $('#f-kind').value = b.kind || 'percent';
  $('#f-value').value = b.value != null ? b.value : '';
  $('#f-cap').value = b.capPerTx != null ? b.capPerTx : '';
  $('#f-min').value = b.minSpend || '';
  $('#f-card').value = b.requiresCard || '';
  $('#f-until').value = b.validUntil || '';
  $('#f-conditions').value = b.conditions || '';
  $('#f-source').value = b.source || '';
  $('#f-tags').value = (b.tags || []).join(', ');
  $('#f-status').value = ['verified', 'example'].includes(b.status) ? b.status : 'unverified';
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

  const variants = readVariantsFromForm();

  const record = {
    id: $('#f-id').value || 'local-' + Date.now().toString(36),
    provider: $('#f-provider').value,
    title,
    merchants: $('#f-merchants').value.split(',').map((m) => m.trim()).filter(Boolean),
    categories,
    variants,
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
  buildSelects();   // בית עסק חדש צריך להופיע בהשלמה האוטומטית
  renderManageList();
  renderBrowse();
  toast(idx >= 0 ? 'ההטבה עודכנה' : 'ההטבה נוספה');
}

/* ---------- ייבוא מלכידה ---------- */

let capturedItems = [];

/*
 * שיוך אוטומטי של מועדון לפי הדומיין שממנו נלכדו הנתונים.
 * ככה ייבוא מהתוסף לא דורש בחירה ידנית לכל אתר.
 */
const DOMAIN_PROVIDERS = [
  { pattern: /htzone\.co\.il/, provider: 'htzone' },
  { pattern: /dts\.co\.il|be-plus\.co\.il/, provider: 'behatzdaa' },
  { pattern: /paisplus\.co\.il|pais\.co\.il/, provider: 'pais' },
  { pattern: /max\.co\.il/, provider: 'max' },
  { pattern: /cal-online\.co\.il/, provider: 'cal' },
  { pattern: /mafteach\.co\.il/, provider: 'mafteah_discount' },
  { pattern: /discountbank\.co\.il/, provider: 'discount_bank' },
  { pattern: /isracard\.co\.il|americanexpress\.co\.il/, provider: 'flycard' },
  { pattern: /elal\.com|elal\.co\.il/, provider: 'elal_matmid' },
  { pattern: /fox\.co\.il/, provider: 'dreamcard' },
  { pattern: /onezerobank\.com/, provider: 'onezero' },
];

function providerForUrl(url) {
  const hit = DOMAIN_PROVIDERS.find((d) => d.pattern.test(url || ''));
  return hit ? hit.provider : null;
}

/*
 * מיישר את שני הפורמטים לצורה אחת: רשימת פריטים, כל אחד עם המקור
 * שלו והמועדון שזוהה ממנו.
 * - לכידה בודדת (בוקמרקלט):  { capturedFrom, items }
 * - לכידה מרוכזת (תוסף):     { captures: [ { capturedFrom, items }, ... ] }
 */
function flattenCapturePayload(payload) {
  const groups = Array.isArray(payload && payload.captures)
    ? payload.captures
    : [Array.isArray(payload) ? { items: payload } : payload];

  const flat = [];
  for (const group of groups) {
    if (!group || !Array.isArray(group.items)) continue;
    const source = group.capturedFrom || '';
    const provider = providerForUrl(source);
    for (const item of group.items) {
      flat.push({ ...item, _source: source, _provider: provider });
    }
  }
  return flat;
}

/*
 * מציג תצוגה מקדימה של מה שנקלט לפני שמכניסים אותו למסד.
 * הלכידה היא ניחוש מתוך טקסט חופשי, ולכן חובה לאשר פריט-פריט
 * במקום להכניס הכל בעיוורון.
 */
function previewCapture() {
  const raw = $('#cap-paste').value.trim();
  const box = $('#cap-preview');

  if (!raw) { toast('הדביקו קודם את התוכן'); return; }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (err) {
    box.innerHTML = '<div class="note">מה שהודבק אינו בפורמט הצפוי. ודאו שהעתקתם מכלי הלכידה.</div>';
    return;
  }

  const items = flattenCapturePayload(payload);
  if (!items.length) {
    box.innerHTML = '<div class="note">לא נמצאו הטבות בתוכן שהודבק.</div>';
    return;
  }

  capturedItems = items;
  const sourceHosts = [...new Set(items.map((i) => {
    try { return new URL(i._source).hostname.replace(/^www\./, ''); } catch (e) { return null; }
  }).filter(Boolean))];
  const source = sourceHosts.join(', ');
  const provByIdMap = Object.fromEntries((db.providers || []).map((p) => [p.id, p.name]));

  const provOptions = (db.providers || [])
    .map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  const catOptions = (db.categories || [])
    .map((c) => `<option value="${c.id}">${c.icon} ${escapeHtml(c.label)}</option>`).join('');

  const rows = items.map((item, i) => {
    const val = item.kind === 'percent' || item.kind === 'cashback' ? item.value + '%'
      : item.kind === 'fixed' ? Engine.formatIls(item.value)
      : item.kind === 'bogo' ? '1+1'
      : item.kind === 'points' ? 'נקודה לכל ' + item.value + ' ₪' : item.value;

    const extras = [];
    if (item._provider && provByIdMap[item._provider]) extras.push('מועדון: ' + provByIdMap[item._provider]);
    if (item.minSpend) extras.push('מינימום ' + Engine.formatIls(item.minSpend));
    if (item.capPerTx) extras.push('תקרה ' + Engine.formatIls(item.capPerTx));
    if (item.validUntil) extras.push('עד ' + Engine.formatDate(item.validUntil));
    if (item.merchant) extras.push('בית עסק: ' + item.merchant);

    return `
      <label class="cap-row">
        <input type="checkbox" data-cap="${i}" checked>
        <span class="cap-val">${escapeHtml(val)}</span>
        <span class="cap-txt">${escapeHtml(item.title || '')}
          ${extras.length ? `<em>${escapeHtml(extras.join(' · '))}</em>` : ''}
        </span>
      </label>`;
  }).join('');

  const detectedCount = items.filter((i) => i._provider).length;
  const providerNote = detectedCount === items.length
    ? 'המועדון זוהה אוטומטית לכל ההטבות לפי האתר שממנו נלכדו. הבחירה למטה תשמש רק אם תרצו לדרוס.'
    : detectedCount > 0
      ? `המועדון זוהה אוטומטית ל-${detectedCount} הטבות. השאר ישויכו לבחירה שלמטה.`
      : 'בחרו לאיזה מועדון לשייך את ההטבות.';

  box.innerHTML = `
    <div class="cap-box">
      <p class="muted small">${items.length} הטבות נקלטו${source ? ' מתוך ' + escapeHtml(source) : ''}</p>
      <div class="cap-list">${rows}</div>
      <p class="muted small">${escapeHtml(providerNote)}</p>
      <label for="cap-provider">מועדון (לשיוך ידני)</label>
      <select id="cap-provider">${provOptions}</select>
      <label for="cap-categories">קטגוריות</label>
      <select id="cap-categories" multiple size="5">${catOptions}</select>
      <button class="btn primary" id="cap-add">הוסף את המסומנים</button>
    </div>`;

  $('#cap-add').addEventListener('click', () => addCaptured());
}

function addCaptured() {
  const chosen = $$('#cap-preview [data-cap]')
    .filter((cb) => cb.checked)
    .map((cb) => capturedItems[Number(cb.dataset.cap)]);

  if (!chosen.length) { toast('לא סומנה אף הטבה'); return; }

  const categories = Array.from($('#cap-categories').selectedOptions).map((o) => o.value);
  if (!categories.length) { toast('בחרו לפחות קטגוריה אחת'); return; }

  const fallbackProvider = $('#cap-provider').value;
  const today = new Date().toISOString().slice(0, 10);

  chosen.forEach((item, i) => {
    db.benefits.push({
      id: 'cap-' + Date.now().toString(36) + '-' + i,
      // המועדון שזוהה מהדומיין גובר; הבחירה הידנית משמשת כשאין זיהוי
      provider: item._provider || fallbackProvider,
      title: item.title || 'הטבה שנקלטה',
      merchants: item.merchant ? [item.merchant] : [],
      categories,
      variants: [],
      kind: item.kind,
      value: item.value,
      capPerTx: item.capPerTx == null ? null : item.capPerTx,
      minSpend: item.minSpend || 0,
      requiresCard: null,
      validUntil: item.validUntil || null,
      // הטקסט המלא נשמר כדי שאפשר יהיה לבדוק מה בדיוק היה כתוב במקור
      conditions: item.rawText || '',
      source: item._source || '',
      tags: ['נקלט אוטומטית'],
      // תמיד לאימות: הלכידה מנחשת מתוך טקסט חופשי ואינה מקור סמכות
      status: 'unverified',
      checkedAt: today,
    });
  });

  saveDb();
  buildSelects();
  renderManageList();
  renderBrowse();
  $('#cap-paste').value = '';
  $('#cap-preview').innerHTML = '';
  capturedItems = [];
  toast(`${chosen.length} הטבות נוספו בסטטוס "לאימות"`);
}

function deleteExamples() {
  const examples = db.benefits.filter((b) => b.status === 'example');
  if (!examples.length) { toast('אין רשומות דוגמה'); return; }
  if (!confirm(`למחוק ${examples.length} רשומות דוגמה?`)) return;
  db.benefits = db.benefits.filter((b) => b.status !== 'example');
  saveDb();
  renderManageList();
  renderBrowse();
  toast('רשומות הדוגמה נמחקו');
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
  $('#s-repo').value = cfg.repo || 'arik2/benefits';
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
