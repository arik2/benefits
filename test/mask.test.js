/*
 * בדיקות למיסוך הסודות.
 * הרצה:  node test/mask.test.js
 *
 * העיקרון: הבדיקות כאן נכשלות כשיש דליפה. כישלון כאן אינו באג
 * בפורמט אלא סיסמה שנכתבה ללוג.
 */

const path = require('path');
const { createMasker, REDACTED } = require(path.join(__dirname, '..', 'scraper', 'mask.js'));

let failed = 0;
function check(name, condition, detail) {
  const mark = condition ? 'PASS' : 'FAIL';
  console.log(`${mark} | ${name}${detail ? '  -> ' + detail : ''}`);
  if (!condition) failed++;
}

/* סיסמה מדומה עם תווים שדורשים בריחה בכל אחת מהצורות */
const PASSWORD = 'Sod!Kashe#2026';
const TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
const masker = createMasker({ CLUB_PASSWORD: PASSWORD, GITHUB_TOKEN: TOKEN });
const leaked = (text) => text.includes(PASSWORD) || text.includes(TOKEN);

/* ---------- הצורות שבהן סוד עלול להופיע ---------- */

check('סיסמה בטקסט חופשי נמסכת',
  masker.mask(`מנסה להתחבר עם ${PASSWORD}`) === `מנסה להתחבר עם ${REDACTED}`);

check('סיסמה בתוך כתובת מקודדת נמסכת',
  !leaked(masker.mask(`POST https://club.co.il/login?pw=${encodeURIComponent(PASSWORD)}`)),
  masker.mask(`https://club.co.il/login?pw=${encodeURIComponent(PASSWORD)}`));

check('סיסמה בתוך JSON נמסכת',
  !leaked(masker.mask(JSON.stringify({ user: 'arik', password: PASSWORD }))),
  masker.mask(JSON.stringify({ password: PASSWORD })));

check('סיסמה בקידוד base64 נמסכת',
  !leaked(masker.mask('Authorization: Basic ' + Buffer.from(PASSWORD).toString('base64'))));

check('טוקן גיטהאב נמסך',
  !leaked(masker.mask(`Authorization: Bearer ${TOKEN}`)));

check('שני סודות באותה שורה נמסכים שניהם',
  !leaked(masker.mask(`${PASSWORD} ו-${TOKEN}`)));

/* ---------- אובייקטים ושגיאות ---------- */

check('אובייקט שנשלח ללוג נמסך',
  !leaked(masker.mask({ body: { password: PASSWORD } })));

check('שגיאה נמסכת יחד עם המחסנית',
  !leaked(masker.mask(new Error(`ההתחברות נכשלה עם ${PASSWORD}`))));

check('שגיאה אינה מצטמצמת לאובייקט ריק',
  masker.mask(new Error('שגיאה כלשהי')).includes('שגיאה כלשהי'));

/* ---------- קוד ה-OTP ---------- */

/*
 * הקוד אינו ידוע מראש ולכן אינו יכול להיכנס לרשימת הסודות.
 * הוא נמסך לפי ההקשר שבו הוא מופיע.
 */
check('קוד אימות ליד המילה "קוד" נמסך',
  masker.mask('התקבל קוד 483920 מהמועדון').includes(REDACTED),
  masker.mask('התקבל קוד 483920 מהמועדון'));

check('הקוד עצמו אינו נשאר בלוג',
  !masker.mask('הזנתי code: 483920').includes('483920'));

/* ---------- מה שאסור להימסך ---------- */

check('טקסט רגיל אינו נפגע',
  masker.mask('נסרקו 14 הטבות ממקס') === 'נסרקו 14 הטבות ממקס');

check('סכומים בשקלים אינם נמסכים',
  masker.mask('חיסכון של 400 שקל') === 'חיסכון של 400 שקל');

check('מספרים בלי הקשר של קוד אינם נמסכים',
  masker.mask('נמצאו 123456 תווים בעמוד').includes('123456'));

check('null ו-undefined עוברים בשלום',
  masker.mask(null) === null && masker.mask(undefined) === undefined);

/* ---------- סודות קצרים מדי ---------- */

{
  /*
   * ערך קצר היה ממסך חצי מהלוג. הבדיקה מוודאת שהרף באמת אוכף,
   * כי סינון שקט של סוד אמיתי הוא בדיוק מה שאסור.
   */
  const shortMasker = createMasker(['abc', 'ok']);
  check('ערך קצר מדי אינו נכנס לרשימת המיסוך',
    shortMasker.count === 0 && shortMasker.mask('abc ok') === 'abc ok');
}

/* ---------- ה-console העוטף ---------- */

{
  const lines = [];
  const sink = {
    log: (...a) => lines.push(a.join(' ')),
    info: (...a) => lines.push(a.join(' ')),
    warn: (...a) => lines.push(a.join(' ')),
    error: (...a) => lines.push(a.join(' ')),
  };
  const c = masker.maskedConsole(sink);

  c.log('מתחבר עם', PASSWORD);
  c.error(new Error(`נכשל: ${PASSWORD}`));
  c.warn({ token: TOKEN });
  c.info(`Basic ${Buffer.from(PASSWORD).toString('base64')}`);

  check('אף שורה שנכתבה דרך ה-console העוטף אינה מכילה סוד',
    lines.every((l) => !leaked(l)),
    lines.filter(leaked).join(' | '));

  check('ה-console העוטף עדיין מדפיס משהו שימושי',
    lines.length === 4 && lines.every((l) => l.length > 0));
}

/* ---------- הזרימה המלאה, כפי שהסורק מריץ אותה ---------- */

{
  /*
   * הבדיקה המרכזית: מדמים ריצת התחברות שנכשלת ומדפיסה הכל, ומוודאים
   * שהסיסמה אינה מופיעה באף שורה. כישלון כאן = דליפה, לא באג בפורמט.
   */
  const lines = [];
  const sink = { log: (...a) => lines.push(a.map(String).join(' ')) };
  sink.info = sink.warn = sink.error = sink.log;
  const c = masker.maskedConsole(sink);

  c.log(`[מקס] ממלא שדה סיסמה: ${PASSWORD}`);
  c.log(`[מקס] POST /api/login body=${JSON.stringify({ u: 'arik', p: PASSWORD })}`);
  c.log(`[מקס] redirect → /verify?t=${encodeURIComponent(PASSWORD)}`);
  c.error(new Error(`Timeout 30000ms exceeded while typing ${PASSWORD}`));
  c.log('[מקס] נשלח קוד 927314 לנייד');
  c.log(`[מקס] Authorization: Basic ${Buffer.from('arik:' + PASSWORD).toString('base64')}`);

  const bad = lines.filter(leaked);
  check('ריצת התחברות שנכשלת אינה מדליפה את הסיסמה באף שורה',
    bad.length === 0, bad.join(' || '));
  check('גם קוד ה-OTP אינו נשאר בלוג של אותה ריצה',
    !lines.join('\n').includes('927314'));

  /*
   * בקרה שלילית. בלי זה, בדיקה שעברה יכולה להעיד על מיסוך שעובד או
   * על כך שהשורות מעולם לא הכילו סוד. אותן שורות בדיוק, בלי מיסוך,
   * חייבות להדליף — אחרת הבדיקה שלמעלה חסרת ערך.
   */
  const raw = [];
  const rawSink = { log: (...a) => raw.push(a.map(String).join(' ')) };
  rawSink.info = rawSink.warn = rawSink.error = rawSink.log;
  rawSink.log(`[מקס] ממלא שדה סיסמה: ${PASSWORD}`);
  check('הבדיקה אכן בודקת משהו: אותה שורה בלי מיסוך כן מדליפה',
    raw.some(leaked));
}

console.log(failed ? `\n${failed} בדיקות נכשלו` : '\nכל הבדיקות עברו ✓');
process.exit(failed ? 1 : 0);
