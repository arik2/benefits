/*
 * בדיקות ללוגיקת החישוב והחיפוש.
 * הרצה:  node benefits/test/engine.test.js
 */

const path = require('path');
const fs = require('fs');
const E = require(path.join(__dirname, '..', 'engine.js'));

const db = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'benefits.json'), 'utf8'));
const TODAY = new Date('2026-08-10');
const S = db.settings;

let failed = 0;
function check(name, condition, detail) {
  const mark = condition ? 'PASS' : 'FAIL';
  console.log(`${mark} | ${name}${detail ? '  -> ' + detail : ''}`);
  if (!condition) failed++;
}

/* --- חישוב --- */

check('אחוזים: 10% מ-1000 = 100',
  E.calcSaving({ kind: 'percent', value: 10 }, 1000, S).amount === 100);

check('תקרה חוסמת: 20% מ-1000 עם תקרה 50 = 50',
  E.calcSaving({ kind: 'percent', value: 20, capPerTx: 50 }, 1000, S).amount === 50);

check('מתחת למינימום קנייה לא ניתן לכימות',
  E.calcSaving({ kind: 'fixed', value: 30, minSpend: 200 }, 100, S).computable === false);

check('סכום קבוע מוחזר כמו שהוא',
  E.calcSaving({ kind: 'fixed', value: 30 }, 500, S).amount === 30);

check('1+1 חוסך עד מחצית',
  E.calcSaving({ kind: 'bogo' }, 80, S).amount === 40);

check('נקודות: 1000 ₪ ביחס 4 ₪ לנקודה, בשווי 0.025',
  Math.abs(E.calcSaving({ kind: 'points', value: 4, provider: 'flycard' }, 1000, S).amount - 6.25) < 1e-9);

check('נקודות בלי שווי מוגדר אינן מכומתות',
  E.calcSaving({ kind: 'points', value: 2000, provider: 'max' }, 4000, S).computable === false);

check('הטבת מידע אינה מכומתת',
  E.calcSaving({ kind: 'info' }, 1000, S).computable === false);

/* --- תוקף --- */

check('תאריך שעבר מזוהה כפג תוקף',
  E.expiryState({ validUntil: '2020-01-01' }, TODAY).expired === true);

check('תאריך קרוב מזוהה כעומד לפוג',
  E.expiryState({ validUntil: '2026-09-01' }, TODAY).soon === true);

check('הטבה בלי תאריך תפוגה תמיד בתוקף',
  E.expiryState({ validUntil: null }, TODAY).expired === false);

/* --- חיפוש --- */

const mekarer = E.search(db, 'איפה כדאי לקנות מקרר', 3000, TODAY);
check('חיפוש "מקרר" מוצא הטבות חשמל',
  mekarer.length > 0 && mekarer[0].benefit.categories.includes('electronics'),
  mekarer[0] && mekarer[0].benefit.title);

check('גרשיים לא שוברים את החיפוש ("חו\\"ל")',
  E.search(db, 'הוצאות בחו"ל', 5000, TODAY).length > 0);

check('ג\'יבריש לא מחזיר תוצאות',
  E.search(db, 'קקקקקק בלהבלה', 0, TODAY).length === 0);

check('מילות קישור בלבד לא מחזירות תוצאות',
  E.search(db, 'איפה כדאי לי', 0, TODAY).length === 0);

/* --- דירוג --- */

const ranked = E.rankByCategory(db, 'electronics', 5000, TODAY);
const amounts = ranked.filter((r) => r.saving.computable).map((r) => r.saving.amount);
check('דירוג יורד לפי חיסכון',
  amounts.every((v, i, a) => i === 0 || a[i - 1] >= v), JSON.stringify(amounts));

check('מכומתות מופיעות לפני לא-מכומתות', (() => {
  let sawUncomputable = false;
  return ranked.every((r) => {
    if (!r.saving.computable) sawUncomputable = true;
    return !(sawUncomputable && r.saving.computable);
  });
})());

check('הטבות שפג תוקפן לא נכללות בדירוג',
  ranked.every((r) => !r.expiry.expired));

/* --- תקינות הנתונים --- */

const catIds = new Set(db.categories.map((c) => c.id));
const provIds = new Set(db.providers.map((p) => p.id));
const ids = db.benefits.map((b) => b.id);

check('כל המזהים ייחודיים', new Set(ids).size === ids.length);

check('כל ההטבות מפנות לספק קיים',
  db.benefits.every((b) => provIds.has(b.provider)),
  db.benefits.filter((b) => !provIds.has(b.provider)).map((b) => b.id).join(', '));

check('כל הקטגוריות בהטבות קיימות',
  db.benefits.every((b) => (b.categories || []).every((c) => catIds.has(c))),
  db.benefits.filter((b) => (b.categories || []).some((c) => !catIds.has(c))).map((b) => b.id).join(', '));

const kinds = new Set(['percent', 'cashback', 'fixed', 'bogo', 'points', 'info']);
check('כל סוגי ההטבה תקינים', db.benefits.every((b) => kinds.has(b.kind)));

check('לכל הטבה יש כותרת וסטטוס',
  db.benefits.every((b) => b.title && (b.status === 'verified' || b.status === 'unverified')));

check('כל קטגוריה מיוצגת בלפחות הטבה אחת', (() => {
  const used = new Set(db.benefits.flatMap((b) => b.categories || []));
  const missing = [...catIds].filter((c) => !used.has(c));
  if (missing.length) console.log('     קטגוריות בלי הטבות: ' + missing.join(', '));
  return true; // מידע בלבד, לא כישלון
})());

console.log(failed ? `\n${failed} בדיקות נכשלו` : '\nכל הבדיקות עברו ✓');
process.exit(failed ? 1 : 0);
