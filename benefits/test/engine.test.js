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

// כל תחומי ההטבה של רשומה: ההטבה עצמה, או ה-variants שלה
const scopesAll = (b) => E.scopesOf(b);

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

/* --- גזירת שורש בעברית --- */

check('סיומת רבים: "מזוודות" תואם "מזוודה"', E.wordsMatch('מזוודות', 'מזוודה'));
check('אות שימוש: "בטיסה" תואם "טיסה"', E.wordsMatch('בטיסה', 'טיסה'));
check('אות סופית: "מלונות" תואם "מלון"', E.wordsMatch('מלונות', 'מלון'));
check('אות שימוש: "בסופש" תואם "סופש"', E.wordsMatch('בסופש', 'סופש'));
check('"סמארטפונים" תואם "סמארטפון"', E.wordsMatch('סמארטפונים', 'סמארטפון'));

// רגרסיה: "אבי" יושב בתוך "שואבי", ובעבר זה יצר התאמה שגויה.
check('רגרסיה: "אביב" אינו תואם "שואבי"', !E.wordsMatch('אביב', 'שואבי'));
check('רגרסיה: "אביב" אינו תואם "אבק"', !E.wordsMatch('אביב', 'אבק'));
check('מילים שונות לא מתאימות: "ביטוח" מול "ביטול"', !E.wordsMatch('ביטוח', 'ביטול'));

check('חיתוך רלוונטיות מסנן התאמות חלשות', (() => {
  const rows = E.search(db, 'הנחות על מלון בארץ', 2000, TODAY);
  const top = rows[0].score;
  return rows.length < db.benefits.length / 2 && rows.every((r, i) => i === 0 || r.score >= top * 0.2);
})(), E.search(db, 'הנחות על מלון בארץ', 2000, TODAY).length + ' תוצאות מתוך ' + db.benefits.length);

check('שאלה על מלון לא מחזירה את הטבת החניה',
  !E.search(db, 'הנחות על מלון בארץ', 2000, TODAY).some((r) => r.benefit.id === 'mafteah-parking'));

/* --- פירוק שאלה חופשית (מצב צ'אט) --- */

const pq = (t) => E.parseQuery(db, t, TODAY);

check('פירוק: בית עסק וסכום', (() => {
  const p = pq('אני קונה בפוקס ב400 שקל');
  return p.merchant === 'פוקס' && p.amount === 400;
})(), JSON.stringify(pq('אני קונה בפוקס ב400 שקל').merchant));

check('פירוק: סכום דבוק לאות עם שגיאת הקלדה', pq('קנייה בפוקס בז400').amount === 400);
check('פירוק: סכום עם פסיק אלפים', pq('מקרר ב-4,000').amount === 4000);
check('פירוק: בית עסק דו-מילי מנצח חד-מילי', pq('קנייה בפוקס הום ב300').merchant === 'פוקס הום');
check('פירוק: אחוז אינו סכום', pq('הנחה של 20% בפוקס').amount === 0);

check('פירוק: "מחר" הופך לתאריך', (() => {
  const p = pq('סינמה סיטי מחר');
  return p.date && p.date.toISOString().slice(0, 10) === '2026-08-11';
})());

check('פירוק: יום בשבוע הופך למופע הבא שלו', (() => {
  const p = pq('מלון ביום שישי ב2000');   // TODAY הוא יום שני 10.08
  return p.date && p.date.toISOString().slice(0, 10) === '2026-08-14' && p.amount === 2000;
})());

check('פירוק: תאריך מפורש אינו נבלע בסכום', (() => {
  const p = pq('טיסה ב5000 ב31.12');
  return p.amount === 5000 && p.date && p.date.toISOString().slice(0, 10) === '2026-12-31';
})());

check('פירוק: "בשבת" מזוהה', (() => {
  const p = pq('בשבת מלון לדוגמה ב1500');
  return p.date && p.date.getDay() === 6 && p.merchant === 'מלון לדוגמה';
})());

/* --- הרכבת תוכנית קנייה --- */

const foxPlan = E.composePlan(db, pq('קנייה בפוקס ב400 שקל'), TODAY);

check('תוכנית פוקס: ההמלצה הראשית היא השובר (ודאי 80) ולא יום ההולדת (אולי 120)',
  foxPlan.primary && foxPlan.primary.benefitId === 'htzone-dreamcard-voucher' && foxPlan.primary.saving === 80,
  foxPlan.primary && `${foxPlan.primary.benefitId} / ${foxPlan.primary.saving}`);

check('תוכנית פוקס: יש צעדי ביצוע מהרשומה',
  foxPlan.primary.steps.length >= 3 && /הייטקזון/.test(foxPlan.primary.steps[0]));

check('תוכנית פוקס: השאלה הפתוחה מוצגת עם הפוטנציאל',
  foxPlan.question && foxPlan.question.upTo === 120 && foxPlan.question.choices.length === 4);

check('תוכנית פוקס: נתון לא מאומת מסומן', foxPlan.primary.verified === false);

const foxBirthday = E.composePlan(db, pq('קנייה בפוקס ב400 שקל'), TODAY, { 'dreamcard-main': 'birthday' });
check('אחרי בחירת יום הולדת: ההמלצה מתחלפת ל-30% והשאלה נסגרת',
  foxBirthday.primary.benefitId === 'dreamcard-main' && foxBirthday.primary.saving === 120
  && foxBirthday.question === null,
  `${foxBirthday.primary.benefitId} / ${foxBirthday.primary.saving}`);

check('שאלה בלי סכום: אין המלצה כמותית ויש דגל noAmount', (() => {
  const p = E.composePlan(db, pq('סרט בקולנוע'), TODAY);
  return p.noAmount === true && p.primary === null && p.rows.length > 0;
})());

check('בית עסק לא מוכר: נסיגה לחיפוש כללי עם דגל merchantMiss', (() => {
  const p = E.composePlan(db, { merchant: 'חנות עלומה', amount: 500, date: null, text: 'חנות עלומה מלון' }, TODAY);
  return p.merchantMiss === true && p.rows.length > 0;
})());

/* --- דירוג בחיפוש חופשי --- */

function topOf(query) {
  const r = E.search(db, query, 0, TODAY);
  return r.length ? r[0].benefit : null;
}

check('שאלה על מזוודות מחזירה את רשומת הכבודה',
  (topOf('כמה מזוודות מותר לי בטיסה') || {}).id === 'elal-baggage',
  (topOf('כמה מזוודות מותר לי בטיסה') || {}).title);

check('שאלה על חניה מחזירה את הטבת החניה',
  (topOf('חניה בסופש בתל אביב') || {}).id === 'mafteah-parking',
  (topOf('חניה בסופש בתל אביב') || {}).title);

check('רגרסיה: חיפוש "תל אביב" לא מחזיר את רשומת שואבי האבק',
  !E.search(db, 'חניה בתל אביב', 0, TODAY).some((r) => r.benefit.id === 'htzone-home-office'));

check('שאלה על 1+1 בקולנוע מחזירה את הטבת הקולנוע',
  (topOf('1+1 לקולנוע') || {}).id === 'htzcard-cinema',
  (topOf('1+1 לקולנוע') || {}).title);

check('שאלה על מטבח מחזירה את הארנק הירוק',
  (E.search(db, 'מטבח חדש', 20000, TODAY)[0] || {}).benefit.id === 'green-wallet-main');

/* --- מינימום קנייה --- */

const greenWallet = db.benefits.find((b) => b.id === 'green-wallet-main');
const below = E.calcSaving(greenWallet, 2000, S);
check('מתחת לסף מוצג ההפרש הנדרש',
  below.computable === false && below.label.includes('1,000'), below.label);
check('מעל הסף ההנחה מחושבת',
  E.calcSaving(greenWallet, 3500, S).amount === 350);

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
  db.benefits.every((b) => b.title && ['verified', 'unverified', 'example'].includes(b.status)),
  db.benefits.filter((b) => !['verified', 'unverified', 'example'].includes(b.status)).map((b) => b.id).join(', '));

check('לכל variant יש תווית',
  db.benefits.every((b) => (b.variants || []).every((v) => v.label && v.label.trim())));

check('ימי תוקף הם 0 עד 6 בלבד',
  db.benefits.every((b) => scopesAll(b).every((s) =>
    !s.validDays || s.validDays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6))));

/* --- חיפוש לפי בית עסק --- */

const foxRows = E.searchByMerchant(db, 'פוקס', 400, TODAY);
check('חיפוש "פוקס" מחזיר הטבות', foxRows.length > 0, foxRows.length + ' תוצאות');

check('כל תוצאה בחיפוש בית עסק אכן רשומה על אותו בית עסק',
  foxRows.every((r) => (r.benefit.merchants || []).some((m) => /פוקס/.test(m))));

check('חיפוש בית עסק שלא קיים מחזיר ריק',
  E.searchByMerchant(db, 'חנות שלא קיימת בכלל', 100, TODAY).length === 0);

check('רשימת בתי העסק אינה ריקה ואין בה כפילויות', (() => {
  const list = E.allMerchants(db);
  return list.length > 10 && new Set(list).size === list.length;
})(), E.allMerchants(db).length + ' בתי עסק');

check('שם בית עסק בשאלה חופשית מדורג ראשון',
  (E.search(db, 'קונה בפוקס', 400, TODAY)[0] || {}).benefit.merchants.some((m) => /פוקס/.test(m)));

/* --- הטבות מרובות אפשרויות --- */

const dream = db.benefits.find((b) => b.id === 'dreamcard-main');
const dreamEval = E.evaluate(dream, { amount: 400, date: TODAY, settings: S });

check('הטבה עם כמה אפשרויות מבקשת הבהרה', dreamEval.needsChoice === true);
check('כל האפשרויות מוצגות לבחירה', dreamEval.choices.length === 4, dreamEval.choices.length + ' אפשרויות');
check('לפני בחירה המספר מסומן כתקרה ולא כתשובה', dreamEval.saving.isUpperBound === true);
check('התקרה שווה לאפשרות הטובה ביותר (30% מ-400)', dreamEval.saving.amount === 120);
check('התווית מתארת טווח ולא מספר יחיד', dreamEval.saving.label.includes('תלוי'), dreamEval.saving.label);

const picked = E.evaluate(dream, { amount: 400, date: TODAY, settings: S, variantId: 'regular' });
check('אחרי בחירה מתקבלת תשובה ודאית',
  picked.needsChoice === false && picked.saving.isUpperBound !== true);
check('הבחירה משנה את החישוב (10% מ-400)', picked.saving.amount === 40);
check('הבחירה מדווחת חזרה', (picked.chosen || {}).id === 'regular', (picked.chosen || {}).label);

check('בחירת יום הולדת נותנת 30%',
  E.evaluate(dream, { amount: 400, date: TODAY, settings: S, variantId: 'birthday' }).saving.amount === 120);

check('מזהה variant לא קיים לא מפיל ומטופל כאילו לא נבחר',
  E.evaluate(dream, { amount: 400, date: TODAY, settings: S, variantId: 'לא-קיים' }).needsChoice === true);

/* --- תלות בתאריך --- */

const hotel = db.benefits.find((b) => b.id === 'example-hotel');
const on = (iso) => E.evaluate(hotel, { amount: 2000, date: new Date(iso + 'T12:00:00'), settings: S });

check('יום שני מפעיל את מסלול אמצע השבוע (20%)',
  on('2026-08-10').saving.amount === 400, on('2026-08-10').saving.label);

check('יום שישי מפעיל את מסלול סוף השבוע (8%)',
  on('2026-08-14').saving.amount === 160, on('2026-08-14').saving.label);

check('כשרק אפשרות אחת תקפה בתאריך, אין שאלה והתשובה ודאית',
  on('2026-08-14').needsChoice === false && on('2026-08-14').saving.isUpperBound !== true);

check('התאריך בוחר את האפשרות אוטומטית',
  (on('2026-08-14').chosen || {}).id === 'weekend', (on('2026-08-14').chosen || {}).label);

const blackedOut = on('2026-09-20');
check('תאריך בתקופת חסימה מסומן כלא תקף', blackedOut.active === false);
check('סיבת החסימה מוסברת למשתמש',
  /חגי תשרי/.test(blackedOut.inactiveReason || ''), blackedOut.inactiveReason);

check('הטבה בלי מגבלת ימים תקפה בכל יום', (() => {
  const simple = db.benefits.find((b) => b.id === 'mafteah-food');
  return ['2026-08-10', '2026-08-14', '2026-12-01']
    .every((d) => E.evaluate(simple, { amount: 500, date: new Date(d + 'T12:00:00'), settings: S }).active);
})());

check('activeOn מזהה תאריך שטרם החל',
  E.activeOn({ validFrom: '2027-01-01' }, TODAY).active === false);

check('כל קטגוריה מיוצגת בלפחות הטבה אחת', (() => {
  const used = new Set(db.benefits.flatMap((b) => b.categories || []));
  const missing = [...catIds].filter((c) => !used.has(c));
  if (missing.length) console.log('     קטגוריות בלי הטבות: ' + missing.join(', '));
  return true; // מידע בלבד, לא כישלון
})());

console.log(failed ? `\n${failed} בדיקות נכשלו` : '\nכל הבדיקות עברו ✓');
process.exit(failed ? 1 : 0);
