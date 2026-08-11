/*
 * בדיקות לסורק, מול אתר מועדון מדומה ודפדפן אמיתי.
 * הרצה:  node test/scraper.test.js
 *
 * אתרי המועדונים חסומים מכאן, ולכן אי אפשר לבדוק בוררים אמיתיים.
 * מה שכן נבדק הוא כל השאר, וזה הרוב: שהזיהוי הגנרי מוצא את השדות
 * בלי שאיש הגדיר בוררים, שממסר ה-OTP עובד, שעוגייה שמורה באמת
 * חוסכת התחברות, ושכישלון של מועדון אחד אינו מפיל את הריצה.
 */

const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const { createServer, USER, PASSWORD } = require('./fixture/server.js');
const { scrapeClub, toBenefits, toStatus, loadClubs } = require(path.join(ROOT, 'scraper', 'run.js'));
const { createOtpRelay } = require(path.join(ROOT, 'scraper', 'otp-relay.js'));
const { createSessionStore, encrypt, decrypt } = require(path.join(ROOT, 'scraper', 'session.js'));
const { createMasker } = require(path.join(ROOT, 'scraper', 'mask.js'));
const { createLocalDb } = require(path.join(ROOT, 'supabase', 'functions', 'bot', 'db.js'));
const captureSource = require('fs').readFileSync(path.join(ROOT, 'benefits', 'capture.js'), 'utf8');
const seed = require(path.join(ROOT, 'benefits', 'data', 'benefits.json'));

let failed = 0;
function check(name, condition, detail) {
  const mark = condition ? 'PASS' : 'FAIL';
  console.log(`${mark} | ${name}${detail ? '  -> ' + detail : ''}`);
  if (!condition) failed++;
}

/* לוג שקט שאוסף שורות, כדי שאפשר יהיה לבדוק מה נכתב */
function collector() {
  const lines = [];
  const push = (...a) => lines.push(a.map((x) => (x instanceof Error ? x.message : String(x))).join(' '));
  return { lines, log: push, info: push, warn: push, error: push };
}

const listen = (server) => new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});

/*
 * ב-CI מותקן דפדפן שתואם לגרסת Playwright, ואז ההפעלה הרגילה עובדת.
 * בסביבות פיתוח שבהן כבר יושב כרום מגרסה אחרת, ההפעלה הרגילה נכשלת
 * בהודעה שמציעה להוריד דפדפן — עצה שאי אפשר לבצע ברשת חסומה. במקום
 * לקבע נתיב בקוד ולשבור את ה-CI, מחפשים כרום קיים ומדווחים על כך.
 */
async function launchChromium() {
  const fsx = require('fs');
  const explicit = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  if (explicit) return chromium.launch({ executablePath: explicit });

  try {
    return await chromium.launch();
  } catch (err) {
    const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
    const found = fsx.existsSync(root)
      ? fsx.readdirSync(root)
        .map((d) => path.join(root, d, 'chrome-linux', 'chrome'))
        .find((p) => fsx.existsSync(p))
      : null;

    if (!found) throw err;
    console.log(`(משתמש בכרום שכבר מותקן: ${found})`);
    return chromium.launch({ executablePath: found });
  }
}

const clubFor = (port, over = {}) => Object.assign({
  id: 'fixture',
  provider: 'max',
  name: 'מועדון בדיקה',
  requiresLogin: true,
  loginUrl: `http://127.0.0.1:${port}/login`,
  pages: [
    { url: `http://127.0.0.1:${port}/benefits`, kind: 'benefits' },
    { url: `http://127.0.0.1:${port}/status`, kind: 'status' },
  ],
  userEnv: 'FIXTURE_USER',
  secretEnv: 'FIXTURE_PASSWORD',
  selectors: {},
  timeoutMs: 15000,
}, over);

(async () => {

  /* ---------- הצפנת עוגיות ---------- */

  {
    const cookies = [{ name: 'sid', value: 'ok', domain: 'x', path: '/' }];
    const KEY = 'a-key-long-enough-for-scrypt';
    const enc = encrypt(cookies, KEY);

    check('עוגייה מוצפנת אינה מכילה את הערך כטקסט',
      !JSON.stringify(enc).includes('sid') && !JSON.stringify(enc).includes('ok'));
    check('עוגייה מוצפנת חוזרת לעצמה בפענוח',
      JSON.stringify(decrypt(enc, KEY)) === JSON.stringify(cookies));

    let wrongKeyFailed = false;
    try { decrypt(enc, 'another-key-long-enough-x'); } catch { wrongKeyFailed = true; }
    check('מפתח שגוי אינו מפענח', wrongKeyFailed);

    // GCM מזהה שינוי בתוכן, ולא מחזיר תוצאה חלקית
    const tampered = Object.assign({}, enc, { data: Buffer.from('xxxx').toString('base64') });
    let tamperFailed = false;
    try { decrypt(tampered, KEY); } catch { tamperFailed = true; }
    check('עוגייה ששונתה נפסלת ולא נטענת חלקית', tamperFailed);

    let shortKeyFailed = false;
    try { encrypt(cookies, 'קצר'); } catch { shortKeyFailed = true; }
    check('מפתח קצר מדי נדחה במפורש', shortKeyFailed);
  }

  /* ---------- פג תוקף של עוגייה ---------- */

  {
    const db = createLocalDb({ seed });
    const KEY = 'a-key-long-enough-for-scrypt';
    let clockNow = new Date('2026-08-10T12:00:00');
    const store = createSessionStore({ db, secret: KEY, now: () => clockNow });

    // עוגייה שפגה בעוד יומיים
    const soon = Math.floor(new Date('2026-08-12T12:00:00').getTime() / 1000);
    await store.save('fixture', [{ name: 'sid', value: 'ok', expires: soon }]);

    check('עוגייה בתוקף נטענת', (await store.load('fixture')) !== null);

    clockNow = new Date('2026-08-20T12:00:00');
    check('עוגייה שפגה נחשבת ללא קיימת ומפעילה התחברות מלאה',
      (await store.load('fixture')) === null);

    // עוגיית סשן בלי תוקף מקבלת תקרה שמרנית ולא נצח
    clockNow = new Date('2026-08-10T12:00:00');
    const exp = await store.save('sess', [{ name: 'sid', value: 'ok' }]);
    const days = (exp - clockNow) / 86400000;
    check('עוגיית סשן בלי תוקף מקבלת תקרה של שבועיים',
      Math.round(days) === 14, `${Math.round(days)} ימים`);
  }

  /* ---------- ממסר ה-OTP ---------- */

  {
    const db = createLocalDb({ seed });
    const log = collector();
    const notified = [];

    const relay = createOtpRelay({
      db, log, sleep: async () => {}, pollMs: 1,
      notify: async (club, id) => {
        notified.push(club);
        // "אריק" עונה מיד, כמו בטלגרם
        await db.answerOtp(id, '482913');
      },
    });

    const code = await relay('מקס');
    check('הממסר מחזיר את הקוד שאריק שלח', code === '482913');
    check('נשלחה הודעה על המועדון הנכון', notified[0] === 'מקס');
    check('הבקשה נסגרת אחרי שנענתה', (await db.pendingOtp()) === null);
  }

  {
    /*
     * פסק זמן. בלי הבדיקה הזו, ריצה שאריק לא ענה לה הייתה תלויה
     * עד שה-workflow ייהרג, ושורפת את מכסת הדקות.
     */
    const db = createLocalDb({ seed });
    let fakeNow = new Date('2026-08-10T12:00:00');
    const relay = createOtpRelay({
      db,
      log: collector(),
      sleep: async () => { fakeNow = new Date(fakeNow.getTime() + 30000); },
      now: () => fakeNow,
      pollMs: 1,
      timeoutMs: 60000,
      notify: async () => { /* איש לא עונה */ },
    });

    let err = null;
    try { await relay('כאל'); } catch (e) { err = e; }
    check('ממסר בלי תשובה נכשל במקום להיתקע', err !== null);
    check('הודעת הכישלון מציינת את המועדון ואת הזמן',
      /כאל/.test(err.message) && /דקות/.test(err.message), err && err.message);

    const req = (await db.readOtp('otp-1'));
    check('בקשה שפג זמנה נסגרת, כדי שלא תבלע מספר עתידי בשאלה רגילה',
      req.status === 'expired', req.status);
  }

  /* ---------- סריקה מלאה מול דפדפן אמיתי ---------- */

  const browser = await launchChromium();

  try {
    /* --- התחברות מלאה עם OTP --- */
    {
      const fixture = createServer();
      const port = await listen(fixture.server);
      const db = createLocalDb({ seed });
      const log = collector();

      const relay = createOtpRelay({
        db, log, sleep: async () => {}, pollMs: 1,
        notify: async (club, id) => {
          // הבדיקה משחקת את אריק: קוראת את הקוד "מה-SMS" ועונה
          const res = await fetch(`http://127.0.0.1:${port}/testing/code`);
          const { otpCode } = await res.json();
          await db.answerOtp(id, otpCode);
        },
      });

      const context = await browser.newContext();
      const store = createSessionStore({ db, secret: 'a-key-long-enough-for-scrypt' });

      const result = await scrapeClub(context, clubFor(port), {
        log, captureSource,
        sessions: store,
        secrets: { FIXTURE_USER: USER, FIXTURE_PASSWORD: PASSWORD },
        otp: relay,
      });

      check('סריקה עם התחברות ו-OTP מצליחה', result.ok === true, result.error);
      check('נדרשה התחברות אחת בלבד', fixture.state.logins === 1, String(fixture.state.logins));
      check('נדרש קוד אחד', fixture.state.otpRequests === 1);
      check('נסרקו הטבות', result.benefits >= 4, String(result.benefits));

      const titles = (result.raw || []).map((b) => b.title).join(' | ');
      check('הזיהוי הגנרי מצא את השדות בלי שהוגדר ולו בורר אחד',
        Object.keys(clubFor(port).selectors).length === 0 && result.ok);
      check('הטבה מוסתרת אינה נלכדת', !/מוסתר|90%/.test(titles), titles);
      check('נלכדו סוגי הטבה שונים ולא רק אחוזים',
        new Set((result.raw || []).map((b) => b.kind)).size >= 3,
        [...new Set((result.raw || []).map((b) => b.kind))].join(','));

      check('נלכד המצב האישי', result.status && result.status.found === true);
      check('נלכדו נקודות', result.status && result.status.points === 1240,
        String(result.status && result.status.points));
      check('נלכדה דרגה', result.status && result.status.tier === 'זהב',
        result.status && result.status.tier);
      check('נלכדה מכסה שנותרה', result.status && result.status.quotaLeft === 3);
      check('נשמרה ראיה לכל שדה, כדי שאפשר יהיה לפסול מספר שגוי',
        result.status && result.status.evidence
        && Object.keys(result.status.evidence).length > 0);

      /* --- הריצה השנייה חוסכת התחברות --- */
      const context2 = await browser.newContext();
      const result2 = await scrapeClub(context2, clubFor(port), {
        log, captureSource,
        sessions: store,
        secrets: { FIXTURE_USER: USER, FIXTURE_PASSWORD: PASSWORD },
        otp: relay,
      });

      check('הסריקה השנייה הצליחה', result2.ok === true, result2.error);
      check('עוגייה שמורה חסכה התחברות שנייה',
        fixture.state.logins === 1, `${fixture.state.logins} התחברויות`);
      check('ולכן גם לא נדרש קוד שני',
        fixture.state.otpRequests === 1, `${fixture.state.otpRequests} בקשות קוד`);
      check('הלוג מציין במפורש שהעוגייה נוצלה',
        log.lines.some((l) => /העוגייה השמורה עדיין תקפה/.test(l)));

      await context.close();
      await context2.close();
      fixture.server.close();
    }

    /* --- עמוד ציבורי: בלי סיסמה ובלי קוד --- */
    {
      const fixture = createServer();
      const port = await listen(fixture.server);
      const log = collector();
      const context = await browser.newContext();

      const club = clubFor(port, {
        id: 'public-club',
        requiresLogin: false,
        secretEnv: null,
        userEnv: null,
        loginUrl: `http://127.0.0.1:${port}/public`,
        pages: [{ url: `http://127.0.0.1:${port}/public`, kind: 'benefits' }],
      });

      const result = await scrapeClub(context, club, {
        log, captureSource, sessions: null, secrets: {}, otp: null,
      });

      check('עמוד ציבורי נסרק בלי התחברות', result.ok === true, result.error);
      check('לא נעשתה שום התחברות', fixture.state.logins === 0);
      check('לא התבקש שום קוד', fixture.state.otpRequests === 0);
      check('נסרקו הטבות מהעמוד הציבורי', result.benefits >= 1, String(result.benefits));

      await context.close();
      fixture.server.close();
    }

    /* --- סיסמה שגויה --- */
    {
      const fixture = createServer();
      const port = await listen(fixture.server);
      const log = collector();
      const context = await browser.newContext();

      const result = await scrapeClub(context, clubFor(port), {
        log, captureSource, sessions: null,
        secrets: { FIXTURE_USER: USER, FIXTURE_PASSWORD: 'WrongPassword!2026' },
        otp: null,
      });

      check('סיסמה שגויה מסתיימת בכישלון מפורש', result.ok === false);
      check('הודעת הכישלון מסבירה מה קרה',
        /נראה מנותק|לא הצליחה/.test(result.error || ''), result.error);
      check('הודעת הכישלון אינה כוללת את תוכן העמוד',
        (result.error || '').length < 200, String((result.error || '').length));

      await context.close();
      fixture.server.close();
    }

    /* --- מועדון שנתקע לא מפיל את השאר --- */
    {
      const fixture = createServer();
      const port = await listen(fixture.server);
      const log = collector();
      const context = await browser.newContext();

      const stuck = clubFor(port, {
        id: 'stuck',
        requiresLogin: false,
        secretEnv: null,
        loginUrl: `http://127.0.0.1:${port}/hang`,
        pages: [{ url: `http://127.0.0.1:${port}/hang`, kind: 'benefits' }],
        timeoutMs: 2500,
      });

      const started = Date.now();
      const result = await scrapeClub(context, stuck, {
        log, captureSource, sessions: null, secrets: {}, otp: null,
      });
      const elapsed = Date.now() - started;

      check('מועדון שנתקע נכשל ולא תולה את הריצה', result.ok === false);
      check('הכישלון מגיע בזמן סביר', elapsed < 12000, `${elapsed}ms`);

      // ומיד אחריו מועדון תקין נסרק כרגיל
      const okClub = clubFor(port, {
        id: 'after-stuck', requiresLogin: false, secretEnv: null,
        loginUrl: `http://127.0.0.1:${port}/public`,
        pages: [{ url: `http://127.0.0.1:${port}/public`, kind: 'benefits' }],
      });
      const after = await scrapeClub(context, okClub, {
        log, captureSource, sessions: null, secrets: {}, otp: null,
      });
      check('המועדון שאחריו נסרק כרגיל', after.ok === true, after.error);

      await context.close();
      fixture.server.close();
    }

    /* --- אתר שמבקש קוד ואין ממסר --- */
    {
      const fixture = createServer();
      const port = await listen(fixture.server);
      const log = collector();
      const context = await browser.newContext();

      const result = await scrapeClub(context, clubFor(port), {
        log, captureSource, sessions: null,
        secrets: { FIXTURE_USER: USER, FIXTURE_PASSWORD: PASSWORD },
        otp: null,
      });

      check('אתר שמבקש קוד בלי ממסר נכשל בהודעה מובנת',
        result.ok === false && /קוד אימות/.test(result.error || ''), result.error);

      await context.close();
      fixture.server.close();
    }

    /* --- מיסוך בזרימה האמיתית --- */
    {
      /*
       * הבדיקה החשובה: ריצה שלמה שנכשלת, דרך ה-console הממוסך,
       * ואימות שהסיסמה אינה מופיעה באף שורה. כישלון כאן = דליפה.
       */
      const fixture = createServer();
      const port = await listen(fixture.server);
      const sink = collector();
      const masker = createMasker([PASSWORD, 'a-key-long-enough-for-scrypt']);
      const masked = masker.maskedConsole(sink);
      const context = await browser.newContext();

      await scrapeClub(context, clubFor(port), {
        log: masked, captureSource, sessions: null,
        secrets: { FIXTURE_USER: USER, FIXTURE_PASSWORD: PASSWORD },
        otp: null,
      });

      const all = sink.lines.join('\n');
      check('ריצה אמיתית שנכשלת אינה מדליפה את הסיסמה',
        !all.includes(PASSWORD), sink.lines.filter((l) => l.includes(PASSWORD)).join(' | '));
      check('הריצה בכל זאת כתבה משהו ללוג', sink.lines.length > 0);

      await context.close();
      fixture.server.close();
    }

  } finally {
    await browser.close();
  }

  /* ---------- המרה לרשומות המאגר ---------- */

  {
    const club = { id: 'max', provider: 'max', pages: [{ url: 'https://x' }] };
    const rows = toBenefits({
      raw: [{ title: 'פוקס 20%', merchant: 'פוקס', kind: 'percent', value: 20, minSpend: 300 }],
    }, club, '2026-08-10');

    check('רשומה שנסרקה מקבלת את הספק של המועדון', rows[0].provider === 'max');
    check('רשומה שנסרקה נכנסת כלא מאומתת', rows[0].status === 'unverified');
    check('בית העסק נשמר כרשימה', JSON.stringify(rows[0].merchants) === '["פוקס"]');
    check('תאריך הבדיקה נרשם', rows[0].checkedAt === '2026-08-10');

    const st = toStatus({ found: true, points: 100, tier: 'זהב', evidence: { points: 'x' } });
    check('מצב אישי מומר לשמות העמודות של הטבלה',
      st.points === 100 && st.tier === 'זהב' && st.evidence.points === 'x');
    check('מצב אישי ריק אינו נשמר', toStatus({ found: false }) === null);
  }

  /* ---------- תצורת המועדונים ---------- */

  {
    const clubs = loadClubs(path.join(ROOT, 'scraper', 'clubs'));
    const providerIds = new Set(seed.providers.map((p) => p.id));

    check('נטענו כל המועדונים', clubs.length === 13, String(clubs.length));

    const orphans = clubs.filter((c) => !providerIds.has(c.provider)).map((c) => c.id);
    check('כל מועדון מצביע על ספק שקיים במאגר', orphans.length === 0, orphans.join(', '));

    const missing = [...providerIds].filter((id) => !clubs.some((c) => c.provider === id));
    check('לכל ספק במאגר יש הגדרת סריקה', missing.length === 0, missing.join(', '));

    /*
     * אריק ביקש במפורש שהמערכת לא תתחבר לחשבון הבנק שלו. זו בדיקה
     * שמונעת מהבקשה הזו להישחק בשקט בעריכה עתידית של קובץ תצורה.
     */
    const banks = ['discount_bank', 'onezero', 'discount_green_wallet'];
    const withLogin = clubs.filter((c) => banks.includes(c.id) && c.requiresLogin !== false);
    check('אף אחד מהבנקים אינו מוגדר להתחברות', withLogin.length === 0,
      withLogin.map((c) => c.id).join(', '));

    const bankSecrets = clubs.filter((c) => banks.includes(c.id) && (c.secretEnv || c.userEnv));
    check('לבנקים אין בכלל שדה סיסמה בתצורה', bankSecrets.length === 0,
      bankSecrets.map((c) => c.id).join(', '));

    /* ולא ייתכן שסוד אמיתי דלף לקובץ תצורה */
    const raw = JSON.stringify(clubs);
    check('אין ערכי סוד בקובצי התצורה, רק שמות משתני סביבה',
      !/password"\s*:\s*"(?!null)./i.test(raw) && !/"pass(word)?":/i.test(raw));
  }

  console.log(failed ? `\n${failed} בדיקות נכשלו` : '\nכל הבדיקות עברו ✓');
  process.exit(failed ? 1 : 0);

})().catch((err) => { console.error(err); process.exit(1); });
