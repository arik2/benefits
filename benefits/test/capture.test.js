/*
 * בדיקות לכלי הלכידה.
 * הרצה:  node benefits/test/capture.test.js
 *
 * בדיקת סריקת ה-DOM דורשת jsdom. אם הוא לא מותקן, אותן בדיקות מדולגות
 * ושאר הבדיקות רצות כרגיל.
 */

const path = require('path');
const C = require(path.join(__dirname, '..', 'capture.js'));

let failed = 0;
let skipped = 0;
function check(name, condition, detail) {
  console.log(`${condition ? 'PASS' : 'FAIL'} | ${name}${detail ? '  -> ' + detail : ''}`);
  if (!condition) failed++;
}

/* --- זיהוי סוג וערך --- */

const v = (t) => C.parseValue(t);

check('אחוז הנחה', JSON.stringify(v('20% הנחה על כל החנות')) === '{"kind":"percent","value":20}');
check('אחוז החזר מזוהה כקאשבק', v('10% החזר כספי').kind === 'cashback');
check('"צבירה" מזוהה כקאשבק', v('15% צבירת נקודות').kind === 'cashback');
check('סכום קבוע בשקלים', JSON.stringify(v('הנחה של 100 ₪')) === '{"kind":"fixed","value":100}');
check('סכום קבוע בסדר הפוך', JSON.stringify(v('50 ש"ח הנחה')) === '{"kind":"fixed","value":50}');
check('סכום עם פסיק אלפים', v('הנחה של 1,200 ₪').value === 1200);
check('1+1', v('1+1 על כל הפריטים').kind === 'bogo');
check('1+1 עם רווחים', v('1 + 1 במסעדות').kind === 'bogo');
check('צבירת נקודות ביחס', JSON.stringify(v('נקודה על כל 4 ₪')) === '{"kind":"points","value":4}');
check('נקודה לכל X', v('נקודה אחת לכל 5 שקלים').value === 5);

// 1+1 חייב להיבדק לפני אחוזים, אחרת הוא ייקרא כהנחה באחוזים
check('1+1 גובר על אחוזים באותו משפט', v('1+1 שווה 50% הנחה').kind === 'bogo');

check('טקסט בלי ערך מוחזר כ-null', v('ברוכים הבאים למועדון') === null);
check('אחוז לא הגיוני נדחה', v('150% משהו') === null);
check('טקסט ריק מוחזר כ-null', v('') === null);

/* --- שדות נלווים --- */

check('מינימום קנייה', C.parseMinSpend('10% הנחה בקנייה מעל 300 ₪') === 300);
check('מינימום עם "החל מ"', C.parseMinSpend('הנחה החל מ-1,500 ₪') === 1500);
check('בלי מינימום מוחזר 0', C.parseMinSpend('10% הנחה') === 0);

check('תקרה לעסקה', C.parseCap('20% הנחה עד 80 ₪') === 80);
check('תקרה עם "מוגבל ל"', C.parseCap('הנחה מוגבלת ל-150 ש"ח') === 150);
check('בלי תקרה מוחזר null', C.parseCap('20% הנחה') === null);

check('תאריך תפוגה', C.parseValidUntil('בתוקף עד 31.12.2026') === '2026-12-31');
check('תאריך עם שנה דו-ספרתית', C.parseValidUntil('תקף עד 1.3.27') === '2027-03-01');
check('תאריך עם קו נטוי', C.parseValidUntil('עד 5/9/2026') === '2026-09-05');
check('בלי תאריך מוחזר null', C.parseValidUntil('20% הנחה') === null);

/* --- כותרות --- */

check('כותרת מנקה רווחים כפולים',
  C.cleanTitle('  20%   הנחה\n\n בפוקס ') === '20% הנחה בפוקס');
check('כותרת ארוכה נחתכת עם שלוש נקודות', (() => {
  const long = C.cleanTitle('א'.repeat(200));
  return long.length <= 91 && long.endsWith('…');
})());
check('כותרת קצרה לא משתנה', C.cleanTitle('20% בפוקס') === '20% בפוקס');

/* --- בניית מועמד --- */

const cand = C.buildCandidate('30% הנחה בפוקס בקנייה מעל 200 ₪, עד 150 ₪, בתוקף עד 31.12.2026');
check('מועמד מלא: אחוז', cand.kind === 'percent' && cand.value === 30);
check('מועמד מלא: מינימום', cand.minSpend === 200);
check('מועמד מלא: תקרה', cand.capPerTx === 150);
check('מועמד מלא: תפוגה', cand.validUntil === '2026-12-31');
check('טקסט בלי ערך לא מייצר מועמד', C.buildCandidate('סתם טקסט שיווקי') === null);

/* --- הסרת כפילויות --- */

const deduped = C.dedupe([
  { kind: 'percent', value: 20, title: '20% הנחה בפוקס', rawText: 'קצר' },
  { kind: 'percent', value: 20, title: '20% הנחה בפוקס', rawText: 'טקסט ארוך יותר עם הקשר' },
  { kind: 'percent', value: 30, title: '30% הנחה בקסטרו', rawText: 'אחר' },
]);
check('כפילויות מוסרות', deduped.length === 2, deduped.length + ' נותרו');
check('נשמרת הגרסה עם יותר הקשר',
  deduped.find((d) => d.value === 20).rawText === 'טקסט ארוך יותר עם הקשר');

/* --- סריקת DOM --- */

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (e) { /* לא מותקן */ }

if (!JSDOM) {
  console.log('SKIP | בדיקות סריקת DOM (jsdom לא מותקן)');
  skipped++;
} else {
  const html = `
    <html><body>
      <nav>תפריט 5% משהו לא רלוונטי</nav>
      <main>
        <ul>
          <li class="card">
            <h3>פוקס</h3>
            <p>20% הנחה על כל החנות בקנייה מעל 300 ₪</p>
          </li>
          <li class="card">
            <img alt="קסטרו">
            <p>1+1 על מכנסיים</p>
          </li>
          <li class="card">
            <p>הנחה של 100 ₪ בקנייה בסניפים, בתוקף עד 31.12.2026</p>
          </li>
          <li class="card"><p>טקסט שיווקי בלי שום מספר</p></li>
          <li class="card" style="display:none"><p>40% הנחה מוסתרת</p></li>
        </ul>
      </main>
    </body></html>`;

  const dom = new JSDOM(html, { pretendToBeVisual: true });
  const doc = dom.window.document;

  // scanDocument משתמש ב-window גלובלי לבדיקת נראות
  global.window = dom.window;
  const found = C.scanDocument(doc);
  const titles = found.map((f) => f.title);

  check('נסרקו הטבות מהעמוד', found.length >= 3, found.length + ' נמצאו: ' + titles.join(' | '));
  check('נמצאה הטבת האחוזים', found.some((f) => f.kind === 'percent' && f.value === 20));
  check('נמצאה הטבת 1+1', found.some((f) => f.kind === 'bogo'));
  check('נמצאה הטבת הסכום הקבוע', found.some((f) => f.kind === 'fixed' && f.value === 100));
  check('פריט בלי מספר לא נלכד', !found.some((f) => /טקסט שיווקי/.test(f.title)));
  check('אלמנט מוסתר לא נלכד', !found.some((f) => f.value === 40));
  check('מינימום נקלט מהעמוד',
    (found.find((f) => f.value === 20) || {}).minSpend === 300);
  check('שם מותג נקלט מתגית alt',
    (found.find((f) => f.kind === 'bogo') || {}).merchant === 'קסטרו');

  // ההורה מכיל את אותו טקסט של הילד — לא רוצים את שניהם
  check('לא נלכדים גם ההורה וגם הילד עם אותו ערך',
    found.filter((f) => f.kind === 'percent' && f.value === 20).length === 1);

  delete global.window;
}

console.log(failed ? `\n${failed} בדיקות נכשלו` : `\nכל הבדיקות עברו ✓${skipped ? ` (${skipped} דולגו)` : ''}`);
process.exit(failed ? 1 : 0);
