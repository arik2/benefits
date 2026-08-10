/*
 * engine.js — לוגיקת החיפוש והחישוב.
 * מופרד מה-UI בכוונה: אפשר לבדוק אותו בנפרד, והוא לא נוגע ב-DOM.
 */

/* ---------- עזרי טקסט ---------- */

// מנקה ניקוד, גרשיים וסימני פיסוק כדי ש"חו\"ל" ו"חול" ייחשבו זהים.
function normalize(text) {
  return String(text || '')
    .replace(/[֑-ׇ]/g, '')      // ניקוד וטעמים
    .replace(/["'`׳״]/g, '')
    .replace(/[.,!?;:()\[\]{}\/\\|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// מילות קישור שלא נושאות מידע — מסירים כדי שלא ינפחו ציון התאמה.
const STOPWORDS = new Set(normalize(
  'איפה מאיפה כדאי לי לנצל את של עם על יש אני אנחנו מה כמה איזה איזו הכי יותר הטבה הטבות ' +
  'כרטיס מועדון לקנות קונה רוצה צריך תשלום לשלם שקל שקלים ש ח ב ה ו כ ל מ אם או גם רק כל ' +
  'עכשיו היום מחר יכול אפשר לקבל לקחת עדיף טוב'
).split(' '));

function tokenize(text) {
  return normalize(text)
    .split(' ')
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

// התאמה חלקית: "מלונות" צריך להתאים ל"מלון".
function tokenMatches(token, target) {
  if (target.includes(token)) return true;
  if (token.length >= 4 && token.slice(0, -1) && target.includes(token.slice(0, -1))) return true;
  return false;
}

/* ---------- חישוב חיסכון ---------- */

/*
 * מחזיר { amount, label, computable } עבור הטבה בודדת בסכום נתון.
 * computable=false פירושו שאי אפשר לכמת בכסף — הטבת מידע, או נקודות
 * ששוויין לא הוגדר. במקרה כזה ההטבה עדיין מוצגת, אבל בלי מספר מדומה.
 */
function calcSaving(benefit, amount, settings) {
  const cap = benefit.capPerTx == null ? Infinity : benefit.capPerTx;
  const min = benefit.minSpend || 0;

  if (amount < min) {
    return { amount: 0, label: `דורש מינימום ${formatIls(min)}`, computable: false };
  }

  switch (benefit.kind) {
    case 'percent':
    case 'cashback': {
      const raw = (amount * benefit.value) / 100;
      const saving = Math.min(raw, cap);
      const capped = raw > cap;
      return {
        amount: saving,
        label: `${benefit.value}%${capped ? ` (מוגבל ל-${formatIls(cap)})` : ''}`,
        computable: true,
      };
    }

    case 'fixed':
      return { amount: Math.min(benefit.value, cap), label: 'סכום קבוע', computable: true };

    case 'bogo': {
      // 1+1: החיסכון הוא מחיר הפריט השני, כלומר עד מחצית מהסכום.
      const saving = Math.min(amount / 2, cap);
      return { amount: saving, label: '1+1 (חיסכון של עד חצי)', computable: true };
    }

    case 'points': {
      // value = כמה שקלים נדרשים לנקודה אחת.
      const perShekel = benefit.value;
      const pointValue = pointValueFor(benefit, settings);
      const points = perShekel > 0 ? Math.floor(amount / perShekel) : 0;
      if (!pointValue) {
        return {
          amount: 0,
          label: `${points} נקודות (שווי הנקודה לא הוגדר)`,
          computable: false,
          points,
        };
      }
      return {
        amount: points * pointValue,
        label: `${points} נקודות × ${pointValue} ₪`,
        computable: true,
        points,
      };
    }

    case 'info':
    default:
      return { amount: 0, label: 'הטבה שלא ניתן לכמת בכסף', computable: false };
  }
}

// שווי נקודה נגזר מהמנפיק. ניתן לעריכה בהגדרות כי זו הערכה, לא נתון רשמי.
function pointValueFor(benefit, settings) {
  const values = (settings && settings.pointValueIls) || {};
  if (benefit.provider === 'flycard' || benefit.provider === 'elal_matmid') return values.elal || 0;
  if (benefit.provider === 'max') return values.max_pinuk || 0;
  return 0;
}

/* ---------- סטטוס תוקף ---------- */

function expiryState(benefit, today) {
  if (!benefit.validUntil) return { expired: false, soon: false, daysLeft: null };
  const end = new Date(benefit.validUntil + 'T23:59:59');
  const days = Math.ceil((end - today) / 86400000);
  return { expired: days < 0, soon: days >= 0 && days <= 45, daysLeft: days };
}

/* ---------- שאילתות ---------- */

/*
 * "איפה הכי כדאי" — כל ההטבות בקטגוריה, ממוינות לפי חיסכון בפועל.
 * הטבות שפג תוקפן יורדות; הטבות מידע יורדות מתחת למכומתות.
 */
function rankByCategory(db, categoryId, amount, today) {
  const settings = db.settings || {};
  return db.benefits
    .filter((b) => (b.categories || []).includes(categoryId))
    .map((b) => ({
      benefit: b,
      saving: calcSaving(b, amount, settings),
      expiry: expiryState(b, today),
    }))
    .filter((row) => !row.expiry.expired)
    .sort((a, b) => {
      if (a.saving.computable !== b.saving.computable) return a.saving.computable ? -1 : 1;
      return b.saving.amount - a.saving.amount;
    });
}

/*
 * שאלה חופשית. מדרג לפי כמה מהמילים בשאלה נמצאו, ואיפה נמצאו —
 * התאמה לשם הרשת או לקטגוריה שווה יותר מהתאמה בתוך הערות.
 */
function search(db, query, amount, today) {
  const tokens = tokenize(query);
  if (!tokens.length) return [];

  const settings = db.settings || {};
  const catById = Object.fromEntries((db.categories || []).map((c) => [c.id, c]));
  const provById = Object.fromEntries((db.providers || []).map((p) => [p.id, p]));

  const rows = db.benefits.map((b) => {
    const provider = provById[b.provider] || { name: '' };
    const cats = (b.categories || []).map((id) => catById[id]).filter(Boolean);

    // כל שדה מקבל משקל לפי כמה הוא מעיד על רלוונטיות אמיתית.
    const fields = [
      { weight: 6, text: normalize(cats.map((c) => c.label + ' ' + (c.synonyms || []).join(' ')).join(' ')) },
      { weight: 5, text: normalize(b.title) },
      { weight: 4, text: normalize((b.tags || []).join(' ')) },
      { weight: 3, text: normalize(provider.name) },
      { weight: 1, text: normalize(b.conditions) },
    ];

    let score = 0;
    let hits = 0;
    for (const token of tokens) {
      let best = 0;
      for (const f of fields) if (tokenMatches(token, f.text)) best = Math.max(best, f.weight);
      if (best) { score += best; hits += 1; }
    }

    // בונוס לכיסוי: התאמה של כל מילות השאלה עדיפה על התאמה חזקה למילה אחת.
    if (hits === tokens.length && tokens.length > 1) score *= 1.5;

    return { benefit: b, score, hits, saving: calcSaving(b, amount, settings), expiry: expiryState(b, today) };
  });

  return rows
    .filter((r) => r.score > 0 && !r.expiry.expired)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.saving.computable !== b.saving.computable) return a.saving.computable ? -1 : 1;
      return b.saving.amount - a.saving.amount;
    });
}

/*
 * תיאור מילולי של שיעור ההטבה, לשימוש כשאין סכום להשוות אליו.
 * בלי זה, עיון ללא סכום היה מציג "0 ₪" וזה נקרא כאילו אין הטבה.
 */
function describeRate(benefit) {
  switch (benefit.kind) {
    case 'percent': return `${benefit.value}% הנחה`;
    case 'cashback': return `${benefit.value}% החזר`;
    case 'fixed': return `${formatIls(benefit.value)} הנחה`;
    case 'bogo': return '1+1';
    case 'points': return `נקודה לכל ${benefit.value} ₪`;
    default: return 'מידע';
  }
}

/* ---------- פורמט ---------- */

function formatIls(n) {
  if (!isFinite(n)) return '—';
  const rounded = Math.round(n * 100) / 100;
  return rounded.toLocaleString('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 2 });
}

/* ייצוא גם ל-<script> רגיל וגם לסביבת בדיקות (Node) */
const Engine = {
  normalize, tokenize, calcSaving, expiryState, rankByCategory, search, formatIls, pointValueFor, describeRate,
};
if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
