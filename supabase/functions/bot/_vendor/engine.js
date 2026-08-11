/* קובץ מיוצר. אל תערכו אותו — ערכו את המקור והריצו node supabase/functions/bot/build.js */
/*
 * engine.js — לוגיקת החיפוש והחישוב.
 * מופרד מה-UI בכוונה: אפשר לבדוק אותו בנפרד, והוא לא נוגע ב-DOM.
 *
 * שלוש רמות של הטבה:
 *   1. הטבה רחבה על קטגוריה  ("10% על אופנה")
 *   2. הטבה על בית עסק מסוים ("10% בפוקס")
 *   3. הטבה על מוצר או מצב מסוים בתוך בית העסק ("30% ביום הולדת")
 *
 * רמה 3 מיוצגת כ-variants. כשלהטבה יש כמה variants ואי אפשר לדעת איזה
 * רלוונטי, המנוע לא מנחש - הוא מחזיר needsChoice, והממשק שואל את המשתמש.
 */

/* ---------- עזרי טקסט ---------- */

// אותיות סופיות מומרות לצורתן הרגילה, אחרת "מלון" ו"מלונות" לא נראים קרובים.
const FINAL_LETTERS = { 'ם': 'מ', 'ן': 'נ', 'ץ': 'צ', 'ף': 'פ', 'ך': 'כ' };

// מנקה ניקוד, גרשיים וסימני פיסוק כדי ש"חו\"ל" ו"חול" ייחשבו זהים.
function normalize(text) {
  return String(text || '')
    .replace(/[֑-ׇ]/g, '')      // ניקוד וטעמים
    .replace(/["'`׳״]/g, '')
    .replace(/[.,!?;:()\[\]{}\/\\|-]/g, ' ')
    .replace(/[םןץףך]/g, (c) => FINAL_LETTERS[c])
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// מילות קישור שלא נושאות מידע — מסירים כדי שלא ינפחו ציון התאמה.
const STOPWORDS = new Set(normalize(
  'איפה מאיפה כדאי לי לנצל את של עם על יש אני אנחנו מה כמה איזה איזו הכי יותר הטבה הטבות ' +
  'כרטיס מועדון לקנות קונה רוצה צריך תשלום לשלם שקל שקלים ש ח ב ה ו כ ל מ אם או גם רק כל ' +
  'עכשיו היום מחר יכול אפשר לקבל לקחת עדיף טוב שם משם'
).split(' '));

function tokenize(text) {
  return normalize(text)
    .split(' ')
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

/*
 * גזירת שורש בסיסית לעברית.
 *
 * ההשוואה נעשית בין מילים שלמות ולא כתת-מחרוזת בתוך טקסט רציף.
 * זה קריטי: חיפוש "אביב" התאים בעבר ל"שואבי אבק", כי "אבי" יושב בתוך "שואבי".
 *
 * לכל מילה נבנית קבוצת צורות אפשריות — המקור, בלי אות שימוש בהתחלה,
 * בלי סיומת נטייה, ובלי שתיהן. שתי מילים נחשבות תואמות אם יש צורה משותפת.
 * גזירה חד-משמעית בעברית היא בעיה קשה, ולכן נשמרות כל האפשרויות
 * במקום לבחור אחת ולטעות.
 */
const PREFIX_LETTERS = ['ומה', 'שה', 'כש', 'מה', 'לה', 'בה', 'ו', 'ב', 'ל', 'מ', 'ה', 'ש', 'כ'];
const SUFFIXES = ['יות', 'ות', 'ים', 'ין', 'ה', 'ת', 'י'];

function wordForms(rawWord) {
  // קיפול אותיות סופיות נעשה כאן ולא רק ב-normalize, כדי שהפונקציה תהיה
  // נכונה גם כשקוראים לה ישירות עם מילה גולמית. הפעולה אידמפוטנטית.
  const word = String(rawWord || '').replace(/[םןץףך]/g, (c) => FINAL_LETTERS[c]);
  const forms = new Set([word]);
  const bases = [word];

  for (const p of PREFIX_LETTERS) {
    if (word.startsWith(p) && word.length - p.length >= 3) {
      const stripped = word.slice(p.length);
      forms.add(stripped);
      bases.push(stripped);
      break; // אות שימוש אחת בלבד, אחרת מפרקים מילים אמיתיות
    }
  }

  for (const base of bases) {
    for (const s of SUFFIXES) {
      if (base.endsWith(s) && base.length - s.length >= 3) {
        forms.add(base.slice(0, -s.length));
        break;
      }
    }
  }

  return forms;
}

function wordsOf(text) {
  return String(text || '').split(' ').filter(Boolean);
}

// שתי מילים תואמות אם יש להן צורה משותפת, או שאחת היא תחילית של השנייה.
function wordsMatch(rawA, rawB) {
  if (rawA === rawB) return true;
  const formsA = wordForms(rawA);
  const formsB = wordForms(rawB);
  for (const fa of formsA) {
    if (formsB.has(fa)) return true;
    for (const fb of formsB) {
      const min = Math.min(fa.length, fb.length);
      if (min >= 4 && (fa.startsWith(fb) || fb.startsWith(fa))) return true;
    }
  }
  return false;
}

function tokenMatches(token, targetWords) {
  return targetWords.some((w) => wordsMatch(token, w));
}

/* ---------- תחומי הטבה (variants) ---------- */

/*
 * "תחום" הוא יחידה שאפשר לחשב עליה חיסכון: או ההטבה עצמה, או אחד
 * ה-variants שלה. variant יורש מההטבה כל שדה שלא הוגדר בו במפורש,
 * כדי שלא נצטרך לחזור על אותם ערכים בכל שורה.
 */
function scopesOf(benefit) {
  if (!benefit.variants || !benefit.variants.length) {
    return [{
      id: null,
      label: null,
      isBase: true,
      provider: benefit.provider,
      kind: benefit.kind,
      value: benefit.value,
      capPerTx: benefit.capPerTx == null ? null : benefit.capPerTx,
      minSpend: benefit.minSpend || 0,
      conditions: benefit.conditions || '',
      validFrom: benefit.validFrom || null,
      validUntil: benefit.validUntil || null,
      validDays: benefit.validDays || null,
      blackout: benefit.blackout || null,
    }];
  }

  const pick = (v, key, fallback) => (v[key] === undefined || v[key] === null ? fallback : v[key]);

  return benefit.variants.map((v, i) => ({
    id: v.id || 'v' + i,
    label: v.label || 'אפשרות ' + (i + 1),
    isBase: false,
    provider: benefit.provider,
    kind: pick(v, 'kind', benefit.kind),
    value: pick(v, 'value', benefit.value),
    capPerTx: v.capPerTx === undefined ? (benefit.capPerTx == null ? null : benefit.capPerTx) : v.capPerTx,
    minSpend: pick(v, 'minSpend', benefit.minSpend || 0),
    conditions: v.conditions || '',
    validFrom: pick(v, 'validFrom', benefit.validFrom || null),
    validUntil: v.validUntil === undefined ? (benefit.validUntil || null) : v.validUntil,
    validDays: pick(v, 'validDays', benefit.validDays || null),
    blackout: pick(v, 'blackout', benefit.blackout || null),
  }));
}

/* ---------- תוקף בתאריך ---------- */

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

function dayOnly(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseDate(str) {
  if (!str) return null;
  const d = new Date(str + 'T00:00:00');
  return isNaN(d.getTime()) ? null : d;
}

/*
 * בודק אם תחום ההטבה תקף בתאריך מסוים. מחזיר גם סיבה מילולית,
 * כי "לא תקף" בלי הסבר שולח את המשתמש לחפש למה.
 */
function activeOn(scope, date) {
  const day = dayOnly(date);

  const from = parseDate(scope.validFrom);
  if (from && day < from) {
    return { active: false, reason: `נכנס לתוקף ב-${formatDate(scope.validFrom)}`, kind: 'future' };
  }

  const until = parseDate(scope.validUntil);
  if (until && day > until) {
    return { active: false, reason: `פג תוקף ב-${formatDate(scope.validUntil)}`, kind: 'expired' };
  }

  if (scope.validDays && scope.validDays.length && !scope.validDays.includes(day.getDay())) {
    const names = scope.validDays.map((d) => DAY_NAMES[d]).join(', ');
    return { active: false, reason: `תקף רק בימים ${names}`, kind: 'day' };
  }

  for (const b of scope.blackout || []) {
    const bFrom = parseDate(b.from);
    const bTo = parseDate(b.to);
    if (bFrom && bTo && day >= bFrom && day <= bTo) {
      return {
        active: false,
        reason: `לא תקף בין ${formatDate(b.from)} ל-${formatDate(b.to)}${b.note ? ' — ' + b.note : ''}`,
        kind: 'blackout',
      };
    }
  }

  return { active: true, reason: null, kind: null };
}

function expiryState(benefit, today) {
  if (!benefit.validUntil) return { expired: false, soon: false, daysLeft: null };
  const end = new Date(benefit.validUntil + 'T23:59:59');
  const days = Math.ceil((end - today) / 86400000);
  return { expired: days < 0, soon: days >= 0 && days <= 45, daysLeft: days };
}

/* ---------- חישוב חיסכון ---------- */

/*
 * מחזיר { amount, label, computable } עבור תחום הטבה בסכום נתון.
 * computable=false פירושו שאי אפשר לכמת בכסף — הטבת מידע, או נקודות
 * ששוויין לא הוגדר. במקרה כזה ההטבה עדיין מוצגת, אבל בלי מספר מדומה.
 */
function calcSaving(scope, amount, settings) {
  const cap = scope.capPerTx == null ? Infinity : scope.capPerTx;
  const min = scope.minSpend || 0;

  // כשחסר מעט כדי לעבור את הסף, ההפרש עצמו הוא המידע השימושי.
  if (amount < min) {
    const gap = min - amount;
    const label = amount > 0
      ? `חסרים ${formatIls(gap)} לסף של ${formatIls(min)}`
      : `דורש מינימום ${formatIls(min)}`;
    return { amount: 0, label, computable: false };
  }

  switch (scope.kind) {
    case 'percent':
    case 'cashback': {
      const raw = (amount * scope.value) / 100;
      const saving = Math.min(raw, cap);
      return {
        amount: saving,
        label: `${scope.value}%${raw > cap ? ` (מוגבל ל-${formatIls(cap)})` : ''}`,
        computable: true,
      };
    }

    case 'fixed':
      return { amount: Math.min(scope.value, cap), label: 'סכום קבוע', computable: true };

    case 'bogo': {
      // 1+1: החיסכון הוא מחיר הפריט השני, כלומר עד מחצית מהסכום.
      return { amount: Math.min(amount / 2, cap), label: '1+1 (חיסכון של עד חצי)', computable: true };
    }

    case 'points': {
      // value = כמה שקלים נדרשים לנקודה אחת.
      const perShekel = scope.value;
      const pointValue = pointValueFor(scope, settings);
      const points = perShekel > 0 ? Math.floor(amount / perShekel) : 0;
      if (!pointValue) {
        return { amount: 0, label: `${points} נקודות (שווי הנקודה לא הוגדר)`, computable: false, points };
      }
      return { amount: points * pointValue, label: `${points} נקודות × ${pointValue} ₪`, computable: true, points };
    }

    case 'info':
    default:
      return { amount: 0, label: 'הטבה שלא ניתן לכמת בכסף', computable: false };
  }
}

// שווי נקודה נגזר מהמנפיק. ניתן לעריכה בהגדרות כי זו הערכה, לא נתון רשמי.
function pointValueFor(scope, settings) {
  const values = (settings && settings.pointValueIls) || {};
  if (scope.provider === 'flycard' || scope.provider === 'elal_matmid') return values.elal || 0;
  if (scope.provider === 'max') return values.max_pinuk || 0;
  if (scope.provider === 'dreamcard') return values.dreamcard || 0;
  return 0;
}

/* ---------- הערכת הטבה שלמה ---------- */

/*
 * מעריך הטבה בהקשר נתון (סכום, תאריך, ובחירת variant אם נעשתה).
 *
 * העיקרון: כשיש כמה אפשרויות ואי אפשר לדעת איזו רלוונטית, לא מנחשים.
 * needsChoice מסמן לממשק שצריך לשאול את המשתמש לפני שנותנים תשובה.
 */
function evaluate(benefit, ctx) {
  const { amount = 0, settings = {}, variantId = null } = ctx || {};
  const date = ctx && ctx.date ? ctx.date : new Date();

  const all = scopesOf(benefit);
  const withActivity = all.map((s) => ({ scope: s, activity: activeOn(s, date) }));
  const active = withActivity.filter((x) => x.activity.active);

  // אין אף תחום תקף בתאריך הזה — מדווחים למה, במקום להחביא את ההטבה.
  if (!active.length) {
    const first = withActivity[0];
    return {
      saving: { amount: 0, label: first.activity.reason || 'לא תקף בתאריך שנבחר', computable: false },
      needsChoice: false,
      choices: [],
      chosen: null,
      active: false,
      inactiveReason: first.activity.reason,
      scopeCount: all.length,
    };
  }

  const priced = active.map((x) => ({
    id: x.scope.id,
    label: x.scope.label,
    conditions: x.scope.conditions,
    scope: x.scope,
    saving: calcSaving(x.scope, amount, settings),
  }));

  // נבחר variant מפורש
  if (variantId != null) {
    const chosen = priced.find((p) => p.id === variantId);
    if (chosen) {
      return {
        saving: chosen.saving,
        needsChoice: false,
        choices: priced,
        chosen: { id: chosen.id, label: chosen.label, conditions: chosen.conditions },
        active: true,
        inactiveReason: null,
        scopeCount: all.length,
      };
    }
  }

  /*
   * אפשרות אחת בלבד — אין מה לשאול, וזו תשובה ודאית ולא תקרה.
   * זה קורה גם כשההטבה פשוטה, וגם כשהתאריך שנבחר סינן את כל שאר
   * האפשרויות (למשל מלון שבסוף שבוע יש בו רק מסלול אחד).
   */
  if (priced.length === 1) {
    const only = priced[0];
    return {
      saving: only.saving,
      needsChoice: false,
      choices: [],
      chosen: only.scope.isBase ? null : { id: only.id, label: only.label, conditions: only.conditions },
      active: true,
      inactiveReason: null,
      scopeCount: all.length,
    };
  }

  // כמה אפשרויות: מדווחים על הטווח ומבקשים הבהרה.
  const computable = priced.filter((p) => p.saving.computable);
  const best = computable.slice().sort((a, b) => b.saving.amount - a.saving.amount)[0];
  const worst = computable.slice().sort((a, b) => a.saving.amount - b.saving.amount)[0];

  const rangeLabel = best && worst && best.saving.amount !== worst.saving.amount
    ? `${formatIls(worst.saving.amount)} – ${formatIls(best.saving.amount)} תלוי במה שקונים`
    : (best ? best.saving.label : priced[0].saving.label);

  return {
    // עד שהמשתמש יבחר, מציגים את המקסימום האפשרי ומסמנים שזו תקרה.
    saving: best
      ? { amount: best.saving.amount, label: rangeLabel, computable: true, isUpperBound: true }
      : { amount: 0, label: rangeLabel, computable: false },
    needsChoice: priced.length > 1,
    choices: priced,
    chosen: null,
    active: true,
    inactiveReason: null,
    scopeCount: all.length,
  };
}

/* ---------- שאילתות ---------- */

/*
 * "איפה הכי כדאי" — כל ההטבות בקטגוריה, ממוינות לפי חיסכון בפועל.
 * הטבות שפג תוקפן יורדות; הטבות מידע יורדות מתחת למכומתות.
 */
function rankByCategory(db, categoryId, amount, today, opts) {
  const settings = db.settings || {};
  const date = (opts && opts.date) || today;
  const picks = (opts && opts.variantPicks) || {};

  return db.benefits
    .filter((b) => (b.categories || []).includes(categoryId))
    .map((b) => ({
      benefit: b,
      evaluation: evaluate(b, { amount, date, settings, variantId: picks[b.id] || null }),
      expiry: expiryState(b, today),
    }))
    .map((row) => ({ ...row, saving: row.evaluation.saving }))
    .filter((row) => !row.expiry.expired)
    .sort(compareRows);
}

/*
 * חיפוש בבית עסק מסוים — התשובה ל"אני קונה בפוקס ב-400 ₪".
 * מחזיר רק הטבות שמזכירות את בית העסק במפורש.
 */
function searchByMerchant(db, merchantQuery, amount, today, opts) {
  const settings = db.settings || {};
  const date = (opts && opts.date) || today;
  const picks = (opts && opts.variantPicks) || {};
  const tokens = tokenize(merchantQuery);
  if (!tokens.length) return [];

  return db.benefits
    .filter((b) => {
      const words = wordsOf(normalize((b.merchants || []).join(' ')));
      return words.length && tokens.some((t) => tokenMatches(t, words));
    })
    .map((b) => ({
      benefit: b,
      evaluation: evaluate(b, { amount, date, settings, variantId: picks[b.id] || null }),
      expiry: expiryState(b, today),
    }))
    .map((row) => ({ ...row, saving: row.evaluation.saving }))
    .filter((row) => !row.expiry.expired)
    .sort(compareRows);
}

/* כל בתי העסק המוכרים למערכת, לרשימת השלמה בממשק */
function allMerchants(db) {
  const set = new Set();
  for (const b of db.benefits) for (const m of b.merchants || []) set.add(m);
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'he'));
}

function compareRows(a, b) {
  if (a.evaluation.active !== b.evaluation.active) return a.evaluation.active ? -1 : 1;
  if (a.saving.computable !== b.saving.computable) return a.saving.computable ? -1 : 1;
  return b.saving.amount - a.saving.amount;
}

/*
 * שאלה חופשית. מדרג לפי כמה מהמילים בשאלה נמצאו, ואיפה נמצאו —
 * שם של בית עסק הוא האות החזק ביותר, ולכן מקבל את המשקל הגבוה ביותר.
 */
function search(db, query, amount, today, opts) {
  const tokens = tokenize(query);
  if (!tokens.length) return [];

  const settings = db.settings || {};
  const date = (opts && opts.date) || today;
  const picks = (opts && opts.variantPicks) || {};
  const catById = Object.fromEntries((db.categories || []).map((c) => [c.id, c]));
  const provById = Object.fromEntries((db.providers || []).map((p) => [p.id, p]));

  const rows = db.benefits.map((b) => {
    const provider = provById[b.provider] || { name: '' };
    const cats = (b.categories || []).map((id) => catById[id]).filter(Boolean);
    const variantWords = (b.variants || []).map((v) => v.label || '').join(' ');

    // כל שדה מקבל משקל לפי כמה הוא מעיד על רלוונטיות אמיתית.
    const fields = [
      { weight: 9, words: wordsOf(normalize((b.merchants || []).join(' '))) },
      { weight: 6, words: wordsOf(normalize(cats.map((c) => c.label + ' ' + (c.synonyms || []).join(' ')).join(' '))) },
      { weight: 5, words: wordsOf(normalize(b.title)) },
      { weight: 5, words: wordsOf(normalize(variantWords)) },
      { weight: 4, words: wordsOf(normalize((b.tags || []).join(' '))) },
      { weight: 3, words: wordsOf(normalize(provider.name)) },
      { weight: 1, words: wordsOf(normalize(b.conditions)) },
    ];

    let score = 0;
    let hits = 0;
    for (const token of tokens) {
      let best = 0;
      let matchedFields = 0;
      for (const f of fields) {
        if (tokenMatches(token, f.words)) {
          best = Math.max(best, f.weight);
          matchedFields += 1;
        }
      }
      if (best) {
        // מילה שמופיעה גם בקטגוריה וגם בכותרת או בתגיות מעידה חזק יותר
        // מאשר מילה שנתפסה רק דרך הקטגוריה הרחבה, שמשותפת להטבות רבות.
        score += best + (matchedFields - 1);
        hits += 1;
      }
    }

    // בונוס לכיסוי: התאמה של כל מילות השאלה עדיפה על התאמה חזקה למילה אחת.
    if (hits === tokens.length && tokens.length > 1) score *= 1.5;

    const evaluation = evaluate(b, { amount, date, settings, variantId: picks[b.id] || null });
    return { benefit: b, score, hits, evaluation, saving: evaluation.saving, expiry: expiryState(b, today) };
  });

  const matched = rows
    .filter((r) => r.score > 0 && !r.expiry.expired)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return compareRows(a, b);
    });

  /*
   * חיתוך רלוונטיות. מילה בודדת שנתפסה בשדה התנאים מספיקה כדי לקבל ניקוד,
   * ולכן שאלה על מלון החזירה גם הטבת חניה. הסף יחסי ולא מוחלט, כדי
   * שגם שאלה שכל ההתאמות בה חלשות עדיין תחזיר את הטובות שבהן.
   */
  if (!matched.length) return matched;
  const cutoff = matched[0].score * 0.2;
  return matched.filter((r, i) => i === 0 || r.score >= cutoff);
}

/* ---------- הבנת שאלה חופשית ---------- */

const DAY_WORDS = { 'ראשון': 0, 'שני': 1, 'שלישי': 2, 'רביעי': 3, 'חמישי': 4, 'שישי': 5, 'שבת': 6 };

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function nextDayOfWeek(base, dow) {
  const d = dayOnly(base);
  const diff = (dow - d.getDay() + 7) % 7 || 7;
  return addDays(d, diff);
}

/*
 * מפרק משפט חופשי ("קנייה בפוקס ב-400 שקל ביום שישי") לחלקים:
 * בית עסק, סכום ותאריך. מה שלא זוהה נשאר null והמערכת מסתדרת בלעדיו.
 */
function parseQuery(db, rawText, today) {
  const base = today ? dayOnly(today) : dayOnly(new Date());

  /*
   * התאריך והסכום מחולצים מהטקסט הגולמי, לא מהמנורמל:
   * normalize הופך נקודות ופסיקים לרווחים, ואז "31.12" מתפרק לשני
   * מספרים ו"4,000" נהיה "4 000" שנקרא בטעות כ-000.
   */
  let raw = String(rawText || '').replace(/(\d),(?=\d{3})/g, '$1');

  /* תאריך מפורש (31.12 או 31/12/2026) — מזוהה ומוסר לפני חילוץ הסכום,
     אחרת "31" היה נקרא כסכום */
  let date = null;
  const explicit = raw.match(/(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{2,4}))?/);
  if (explicit) {
    let [, d, mo, y] = explicit;
    y = y ? (y.length === 2 ? '20' + y : y) : String(base.getFullYear());
    const cand = new Date(Number(y), Number(mo) - 1, Number(d));
    if (!isNaN(cand.getTime())) {
      if (!explicit[3] && cand < base) cand.setFullYear(cand.getFullYear() + 1);
      date = cand;
    }
    raw = raw.replace(explicit[0], ' ');
  }

  const text = normalize(raw);

  if (!date) {
    if (/מחרתיים/.test(text)) date = addDays(base, 2);
    else if (/מחר/.test(text)) date = addDays(base, 1);
    else {
      /* "ביום שישי" / "בשבת" — המופע הבא של אותו יום.
         נבדק על הטקסט המנורמל, שבו אותיות סופיות כבר קופלו */
      const dw = text.match(/(?:ביומ|יומ)\s+(ראשונ|שני|שלישי|רביעי|חמישי|שישי|שבת)/)
        || (/(?:^|\s)בשבת(?:\s|$)/.test(text) ? [null, 'שבת'] : null);
      if (dw) {
        const key = { 'ראשונ': 'ראשון', 'שני': 'שני', 'שלישי': 'שלישי', 'רביעי': 'רביעי', 'חמישי': 'חמישי', 'שישי': 'שישי', 'שבת': 'שבת' }[dw[1]];
        date = nextDayOfWeek(base, DAY_WORDS[key]);
      }
    }
  }

  /* סכום: המספר הראשון בן 2-6 ספרות, גם כשהוא דבוק לאות ("ב400").
     אחוזים אינם סכום. */
  let amount = 0;
  const m = raw.match(/(?:^|[^\d+])(\d{2,6})(?!\s*%|\d)/);
  if (m) amount = parseInt(m[1], 10);

  /* בית עסק: ההתאמה הארוכה ביותר מבין בתי העסק המוכרים למערכת */
  const tokens = text.split(' ').filter(Boolean);
  let merchant = null;
  let merchantWords = 0;
  for (const name of allMerchants(db)) {
    const words = wordsOf(normalize(name));
    if (!words.length) continue;
    const allFound = words.every((w) => tokens.some((t) => wordsMatch(t, w)));
    if (allFound && words.length > merchantWords) {
      merchant = name;
      merchantWords = words.length;
    }
  }

  return { merchant, amount, date, text: rawText };
}

/* ---------- הרכבת תשובה: תוכנית קנייה ---------- */

function isVoucherBenefit(b) {
  if (b.voucher === true) return true;
  const hay = normalize(b.title + ' ' + (b.tags || []).join(' '));
  return /שובר|תו קנייה|תווים/.test(hay);
}

/* צעדי ביצוע: מהרשומה עצמה אם הוגדרו, אחרת נבנים לפי סוג ההטבה */
function stepsFor(row, amount, provider) {
  const b = row.benefit;
  if (Array.isArray(b.howTo) && b.howTo.length) return b.howTo;

  const sv = row.saving;
  const steps = [];
  if (isVoucherBenefit(b) && sv.computable && amount > 0) {
    const pay = amount - sv.amount;
    steps.push(`קנו באתר ${provider.name} שוברים בשווי ${formatIls(amount)} — תשלמו בערך ${formatIls(pay)}`);
    steps.push('בקופה שלמו עם השוברים במקום בכרטיס');
    steps.push('אם סכום הקנייה יוצא מעל השוברים — השלימו את ההפרש בכרטיס עם ההטבה הבאה ברשימה');
  } else {
    switch (b.kind) {
      case 'cashback':
        if (b.requiresCard) steps.push(`שלמו עם ${b.requiresCard}`);
        steps.push('ההחזר או הצבירה נרשמים אחרי החיוב — לא תראו הנחה בקופה');
        break;
      case 'percent':
      case 'fixed':
        if (b.requiresCard) steps.push(`שלמו עם ${b.requiresCard}`);
        else steps.push(`ההטבה דרך ${provider.name} — בדקו באתר או באפליקציה שלהם איך מממשים לפני התשלום`);
        break;
      case 'bogo':
        steps.push('קחו שני פריטים — השני חינם. בדקו בתנאים על מה ההטבה חלה');
        break;
      case 'points':
        if (b.requiresCard) steps.push(`שלמו עם ${b.requiresCard} — הנקודות נצברות אוטומטית`);
        break;
      default:
        break;
    }
  }
  return steps;
}

/*
 * הלב של מצב הצ'אט: לוקח שאלה מפורקת ומרכיב תשובה אחת ברורה.
 *
 * העיקרון: ההמלצה הראשית היא תמיד האפשרות הטובה ביותר שהיא ודאית.
 * אפשרות שדורשת הבהרה ("אולי יום הולדת?") לעולם לא נבחרת בשקט —
 * היא מוצגת כשאלה, וכשעונים עליה התוכנית מתעדכנת.
 */
function composePlan(db, parsed, today, variantPicks) {
  const date = parsed.date || today;
  const opts = { date, variantPicks: variantPicks || {} };

  let rows = parsed.merchant
    ? searchByMerchant(db, parsed.merchant, parsed.amount, today, opts)
    : search(db, parsed.text, parsed.amount, today, opts);
  let merchantMiss = false;

  if (parsed.merchant && !rows.length) {
    rows = search(db, parsed.text, parsed.amount, today, opts);
    merchantMiss = true;
  }

  if (!rows.length) {
    return { rows: [], parsed, primary: null, question: null, alternatives: [], merchantMiss, noAmount: !parsed.amount };
  }

  const provById = Object.fromEntries((db.providers || []).map((p) => [p.id, p]));

  const priced = rows.filter((r) => r.saving.computable && r.evaluation.active);
  const certain = priced.filter((r) => !r.evaluation.needsChoice && !r.saving.isUpperBound);
  const bestCertain = certain[0] ? certain.reduce((a, b) => (b.saving.amount > a.saving.amount ? b : a)) : null;
  const bestAny = priced[0] ? priced.reduce((a, b) => (b.saving.amount > a.saving.amount ? b : a)) : null;

  let primary = null;
  if (bestCertain && parsed.amount > 0) {
    const provider = provById[bestCertain.benefit.provider] || { name: '' };
    primary = {
      benefitId: bestCertain.benefit.id,
      title: bestCertain.benefit.title,
      providerName: provider.name,
      saving: bestCertain.saving.amount,
      savingLabel: bestCertain.saving.label,
      steps: stepsFor(bestCertain, parsed.amount, provider),
      verified: bestCertain.benefit.status === 'verified',
    };
  }

  /* שאלה פתוחה: יש אפשרות שאולי עדיפה, אבל תלויה במשהו שרק המשתמש יודע */
  let question = null;
  if (bestAny && bestAny.evaluation.needsChoice
      && (!bestCertain || bestAny.saving.amount > bestCertain.saving.amount)) {
    question = {
      benefitId: bestAny.benefit.id,
      title: bestAny.benefit.title,
      upTo: bestAny.saving.amount,
      choices: bestAny.evaluation.choices.map((c) => ({
        id: c.id,
        label: c.label,
        saving: c.saving.computable ? c.saving.amount : null,
      })),
    };
  }

  const alternatives = priced
    .filter((r) => (!primary || r.benefit.id !== primary.benefitId)
      && (!question || r.benefit.id !== question.benefitId))
    .slice(0, 3)
    .map((r) => ({
      title: r.benefit.title,
      providerName: (provById[r.benefit.provider] || { name: '' }).name,
      saving: r.saving.computable ? r.saving.amount : null,
      savingLabel: r.saving.label,
      isUpperBound: !!r.saving.isUpperBound,
    }));

  return {
    rows,
    parsed,
    primary,
    question,
    alternatives,
    merchantMiss,
    noAmount: !parsed.amount,
  };
}

/* ---------- פורמט ---------- */

/*
 * תיאור מילולי של שיעור ההטבה, לשימוש כשאין סכום להשוות אליו.
 * בלי זה, עיון ללא סכום היה מציג "0 ₪" וזה נקרא כאילו אין הטבה.
 */
function describeRate(benefit) {
  const scopes = scopesOf(benefit);
  if (scopes.length > 1) {
    const percents = scopes.filter((s) => s.kind === 'percent' || s.kind === 'cashback').map((s) => s.value);
    if (percents.length > 1) {
      const min = Math.min(...percents);
      const max = Math.max(...percents);
      if (min !== max) return `${min}%–${max}% לפי המוצר`;
    }
    return `${scopes.length} אפשרויות`;
  }
  const s = scopes[0];
  switch (s.kind) {
    case 'percent': return `${s.value}% הנחה`;
    case 'cashback': return `${s.value}% החזר`;
    case 'fixed': return `${formatIls(s.value)} הנחה`;
    case 'bogo': return '1+1';
    case 'points': return `נקודה לכל ${s.value} ₪`;
    default: return 'מידע';
  }
}

function formatIls(n) {
  if (!isFinite(n)) return '—';
  const rounded = Math.round(n * 100) / 100;
  return rounded.toLocaleString('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 2 });
}

function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

/* ייצוא גם ל-<script> רגיל וגם לסביבת בדיקות (Node) */
const Engine = {
  normalize, tokenize, wordsMatch, wordForms,
  scopesOf, activeOn, expiryState,
  calcSaving, evaluate, pointValueFor,
  rankByCategory, search, searchByMerchant, allMerchants,
  parseQuery, composePlan, isVoucherBenefit,
  describeRate, formatIls, formatDate, DAY_NAMES,
};
if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
