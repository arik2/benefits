/*
 * login.js — זרימת התחברות אחת שמשרתת את כל המועדונים.
 *
 * העיקרון: הקוד כאן גנרי, וקובצי clubs/ רק *עוקפים* אותו כשצריך.
 * אתרי המועדונים חסומים מסביבת הפיתוח, ולכן אין דרך לכתוב בוררים
 * מדויקים מראש. במקום לנחש בוודאות מזויפת, כל בורר הוא רשימת
 * מועמדים שנוסים לפי סדר, ואחריהם ניחוש כללי לפי סוג השדה.
 * מועדון שלא נסרק הוא שלב בכיול, ואריק מוסיף בורר אחד לקובץ.
 *
 * סדר העדיפויות בזיהוי — עוגייה תחילה, סיסמה כמוצא אחרון:
 *   1. עוגייה שמורה ותקפה → אין סיסמה ואין OTP
 *   2. פגה → התחברות מלאה → בקשת OTP בטלגרם
 *   3. העוגייה החדשה נשמרת לסריקות הבאות
 */

/* ---------- ניחושים כלליים ---------- */

/*
 * שדה סיסמה הוא הדבר היחיד שאפשר לזהות כמעט בוודאות בכל אתר.
 * שדה המשתמש מזוהה יחסית אליו: הקלט הרגיל שלפניו באותו טופס.
 */
const GENERIC = {
  password: ['input[type="password"]'],
  user: [
    'input[autocomplete="username"]',
    'input[type="tel"]',
    'input[type="email"]',
    'input[name*="user" i]',
    'input[name*="id" i]',
  ],
  submit: [
    'button[type="submit"]',
    'input[type="submit"]',
    'form button',
  ],
  otp: [
    'input[autocomplete="one-time-code"]',
    'input[name*="otp" i]',
    'input[name*="code" i]',
    'input[id*="otp" i]',
    'input[maxlength="6"]',
  ],
};

/*
 * capture.js כבר יודע לזהות עמוד מנותק (looksLoggedOut), וזה הקו
 * הראשון. הבוררים כאן הם רק חיזוק, למקרים שהוא מפספס.
 */
const LOGGED_OUT_HINTS = [
  'input[type="password"]',
  'a[href*="login" i]',
];

const first = (...lists) => lists.flat().filter(Boolean);

/*
 * מנסה בוררים לפי סדר ומחזיר את הראשון שקיים וגלוי. מחזיר null
 * במקום לזרוק, כי חלק מהשדות אופציונליים (למשל שדה משתמש בעמוד
 * שמבקש רק סיסמה).
 */
async function findOne(page, selectors, timeoutMs = 4000) {
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      await el.waitFor({ state: 'visible', timeout: timeoutMs });
      return el;
    } catch {
      /* הבורר הבא */
    }
  }
  return null;
}

/* ---------- זיהוי מצב העמוד ---------- */

/*
 * טוען את capture.js לתוך העמוד, פעם אחת. הוא חייב לרוץ שם ולא
 * אצלנו: looksLoggedOut ו-isVisible נשענים על סגנון מחושב, ורק
 * הדפדפן יודע מה באמת מוצג. ניתוח HTML בצד שלנו היה מכריז "מחובר"
 * על עמוד שיש בו טופס התחברות מוסתר, ולהפך.
 */
async function injectCapture(page, captureSource) {
  if (!captureSource) return false;
  const already = await page.evaluate(() => typeof window.BenefitCapture !== 'undefined')
    .catch(() => false);
  if (already) return true;
  await page.addScriptTag({
    content: 'window.__BENEFIT_CAPTURE_NO_AUTORUN = true;\n' + captureSource,
  });
  return true;
}

async function isLoggedIn(page, club, captureSource) {
  // סימן מפורש מהתצורה גובר על כל היוריסטיקה
  if (club.selectors && club.selectors.loggedIn) {
    const el = await findOne(page, [].concat(club.selectors.loggedIn), 2500);
    if (el) return true;
  }

  if (await injectCapture(page, captureSource)) {
    const loggedOut = await page.evaluate(
      () => window.BenefitCapture.looksLoggedOut(document, location.href));
    if (loggedOut) return false;
  }

  for (const sel of first(
    (club.selectors && club.selectors.loggedOut) || [],
    LOGGED_OUT_HINTS,
  )) {
    /*
     * גלוי, לא רק קיים. אתרים רבים משאירים בעמוד טופס התחברות
     * מוסתר, וספירה בלבד הייתה מכריזה "מנותק" על כל עמוד כזה.
     */
    if (await page.locator(sel).first().isVisible().catch(() => false)) return false;
  }

  return (await page.content()).length > 0;
}

/* ---------- זרימת ההתחברות ---------- */

/*
 * page      — עמוד Playwright
 * club      — תצורת המועדון מ-clubs/
 * creds     — { user, password } מתוך הסודות; ריק = ניסיון בלי התחברות
 * otp       — פונקציה שמבקשת קוד ומחזירה אותו, או null אם אין ממסר
 * log       — console ממוסך
 * captureSource — קוד benefits/capture.js כטקסט, להזרקה לעמוד
 */
async function ensureLoggedIn(page, club, { creds, otp, log, captureSource } = {}) {
  const sel = club.selectors || {};
  const timeout = club.timeoutMs || 30000;

  /*
   * קטלוג ציבורי. אין מה לאמת ואין למה להתחבר — וחשוב מכך, אין
   * סיסמה במערכת בכלל. כך נשמרת הבקשה שהמערכת לא תיגע בחשבון הבנק.
   */
  if (club.requiresLogin === false) {
    log.log(`[${club.name}] עמוד ציבורי — נסרק בלי התחברות`);
    return { loggedIn: false, usedPassword: false, usedOtp: false, public: true };
  }

  /*
   * הבדיקה אם העוגייה עדיין תקפה נעשית על עמוד *מוגן*, לא על עמוד
   * ההתחברות. עמוד התחברות מציג טופס בין אם המשתמש מחובר ובין אם
   * לא, ולכן בדיקה עליו הייתה מכריזה "מנותק" תמיד — והמערכת הייתה
   * מתחברת מחדש ומבקשת קוד בכל סריקה, בדיוק מה שהעוגיות אמורות למנוע.
   */
  const probe = (club.pages && club.pages[0] && club.pages[0].url) || club.loginUrl;
  await page.goto(probe, { waitUntil: 'domcontentloaded', timeout });

  if (await isLoggedIn(page, club, captureSource)) {
    log.log(`[${club.name}] העוגייה השמורה עדיין תקפה — בלי סיסמה ובלי קוד`);
    return { loggedIn: true, usedPassword: false, usedOtp: false };
  }

  if (!creds || !creds.password) {
    throw new Error(`[${club.name}] נדרשת התחברות ואין סיסמה בסודות (${club.secretEnv})`);
  }

  log.log(`[${club.name}] העוגייה פגה — מתחבר מחדש`);

  /*
   * חלק מהאתרים מציגים את טופס ההתחברות בעמוד המוגן עצמו. ניווט
   * לעמוד ההתחברות נעשה רק אם אין שם טופס.
   */
  if (club.loginUrl && !(await findOne(page, first(sel.password, GENERIC.password), 1500))) {
    await page.goto(club.loginUrl, { waitUntil: 'domcontentloaded', timeout });
  }

  const passField = await findOne(page, first(sel.password, GENERIC.password));
  if (!passField) throw new Error(`[${club.name}] לא נמצא שדה סיסמה בעמוד ההתחברות`);

  const userField = await findOne(page, first(sel.user, GENERIC.user), 2500);
  if (userField && creds.user) await userField.fill(creds.user);
  await passField.fill(creds.password);

  const submit = await findOne(page, first(sel.submit, GENERIC.submit));
  if (!submit) throw new Error(`[${club.name}] לא נמצא כפתור שליחה`);
  await submit.click();

  await page.waitForLoadState('domcontentloaded', { timeout })
    .catch(() => { /* אתרים שמעדכנים בלי ניווט */ });

  /* --- שלב הקוד החד-פעמי --- */

  const otpField = await findOne(page, first(sel.otp, GENERIC.otp), 8000);
  let usedOtp = false;

  if (otpField) {
    if (!otp) throw new Error(`[${club.name}] האתר מבקש קוד אימות ואין ממסר מוגדר`);

    log.log(`[${club.name}] האתר מבקש קוד אימות — שולח בקשה לטלגרם`);
    const code = await otp(club.name);
    await otpField.fill(code);
    usedOtp = true;

    const otpSubmit = await findOne(page, first(sel.otpSubmit, GENERIC.submit), 4000);
    if (otpSubmit) await otpSubmit.click();
    await page.waitForLoadState('domcontentloaded', { timeout })
      .catch(() => {});
  }

  if (!(await isLoggedIn(page, club, captureSource))) {
    /*
     * ההודעה לא כוללת את תוכן העמוד. עמוד כישלון של בנק או מועדון
     * מכיל לעיתים את שם המשתמש או ארבע ספרות של כרטיס.
     */
    throw new Error(`[${club.name}] ההתחברות לא הצליחה — העמוד עדיין נראה מנותק`);
  }

  log.log(`[${club.name}] מחובר${usedOtp ? ' (נדרש קוד)' : ''}`);
  return { loggedIn: true, usedPassword: true, usedOtp };
}

module.exports = { ensureLoggedIn, isLoggedIn, injectCapture, findOne, GENERIC };
