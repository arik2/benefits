/*
 * run.js — נקודת הכניסה של הסורק ב-GitHub Actions.
 *
 * הסורק אינו מנוע שני. הוא מביא HTML, ואת הניתוח עושות אותן
 * scanDocument ו-scanStatus מ-benefits/capture.js שכבר מכוסות
 * בבדיקות ושרצות גם בתוסף הדפדפן. אותה סריקה מכל מקום.
 *
 * הרצה של מועדון אחד בלי כתיבה למסד, שימושי בכיול בוררים:
 *   node scraper/run.js --only max --no-store
 */

const fs = require('fs');
const path = require('path');

const { createMasker } = require('./mask.js');
const { ensureLoggedIn, injectCapture } = require('./login.js');
const { createOtpRelay, telegramNotifier } = require('./otp-relay.js');
const { createSessionStore } = require('./session.js');

const CAPTURE_PATH = path.join(__dirname, '..', 'benefits', 'capture.js');

/* ---------- טעינת תצורה ---------- */

function loadClubs(dir) {
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/* ---------- סריקת עמוד יחיד ---------- */

/*
 * capture.js נטען לתוך העמוד ומורץ שם. אפשר היה לשלוף את ה-HTML
 * ולנתח בצד שלנו, אבל אז isVisible לא היה עובד: הוא נשען על סגנון
 * מחושב, ורק הדפדפן יודע מה באמת מוצג. הטעות הזו הייתה מכניסה
 * למאגר הטבות שמוסתרות בעמוד.
 */
async function scanPage(page, captureSource) {
  await injectCapture(page, captureSource);
  return page.evaluate(() => ({
    benefits: window.BenefitCapture.scanDocument(document),
    status: window.BenefitCapture.scanStatus(document),
    url: location.href,
  }));
}

/*
 * גלילה עד הסוף. הרבה אתרים טוענים הטבות רק כשגוללים אליהן, ומה
 * שלא נטען לא ייקלט — זה כתוב גם בהוראות לכלי הידני, ומאותה סיבה.
 */
async function scrollToBottom(page, { steps = 12, pauseMs = 350 } = {}) {
  for (let i = 0; i < steps; i++) {
    const done = await page.evaluate(() => {
      const before = window.scrollY;
      window.scrollTo(0, document.body.scrollHeight);
      return window.scrollY === before;
    });
    if (done) break;
    await page.waitForTimeout(pauseMs);
  }
}

/* ---------- סריקת מועדון ---------- */

/*
 * מופרד מ-main כדי שאפשר יהיה להריץ אותו בבדיקות מול אתר דמה,
 * עם דפדפן אמיתי אבל בלי סודות ובלי רשת חיצונית.
 */
async function scrapeClub(context, club, deps) {
  const { log, captureSource, sessions, secrets, otp } = deps;
  const result = { club: club.id, name: club.name, benefits: 0, status: null, ok: false };

  const page = await context.newPage();

  try {
    if (sessions) {
      const cookies = await sessions.load(club.id);
      if (cookies && cookies.length) {
        await context.addCookies(cookies);
        log.log(`[${club.name}] נטענו ${cookies.length} עוגיות שמורות`);
      }
    }

    const creds = club.secretEnv
      ? { user: secrets[club.userEnv] || '', password: secrets[club.secretEnv] || '' }
      : null;

    const state = await ensureLoggedIn(page, club, { creds, otp, log, captureSource });

    if (state.usedPassword && sessions) {
      const expires = await sessions.save(club.id, await context.cookies());
      log.log(`[${club.name}] נשמרה עוגייה חדשה עד ${expires.toISOString().slice(0, 10)}`);
    }

    const found = [];
    let status = null;

    for (const p of club.pages || []) {
      await page.goto(p.url, { waitUntil: 'domcontentloaded', timeout: club.timeoutMs || 30000 });
      await scrollToBottom(page);

      const scanned = await scanPage(page, captureSource);
      if (p.kind !== 'status') found.push(...scanned.benefits);
      if (scanned.status && scanned.status.found) status = scanned.status;
    }

    result.benefits = found.length;
    result.status = status;
    result.raw = found;
    result.ok = true;
    log.log(`[${club.name}] ${found.length} הטבות${status ? ' + מצב אישי' : ''}`);
  } catch (err) {
    /*
     * כישלון של מועדון אחד אינו מפיל את הריצה. אתר שמשנה את עצמו
     * הוא המצב הרגיל כאן, לא החריג, והמועדונים האחרים עדיין שווים
     * את הסריקה.
     */
    result.error = err.message;
    log.error(`[${club.name}] נכשל: ${err.message}`);
  } finally {
    /*
     * אין שמירת צילומי מסך של כישלונות. מסך מחובר של מועדון או
     * בנק מכיל שם, ארבע ספרות של כרטיס ולעיתים יתרה — וב-Actions
     * artifact הוא קובץ שיושב אחר כך ברשימה.
     */
    await page.close();
  }

  return result;
}

/* ---------- המרה לרשומות המאגר ---------- */

/*
 * ההטבות שנסרקו נכנסות תמיד כ-unverified. הזיהוי הוא ניחוש מושכל
 * מטקסט חופשי, ורשומה שנכנסת כמאומתת היא רשומה שאיש כבר לא יבדוק.
 */
function toBenefits(clubResult, club, today) {
  return (clubResult.raw || []).map((c, i) => ({
    id: `${club.id}-auto-${i + 1}`,
    provider: club.provider,
    title: c.title,
    merchants: c.merchant ? [c.merchant] : [],
    categories: [],
    kind: c.kind,
    value: c.value,
    capPerTx: c.capPerTx == null ? null : c.capPerTx,
    minSpend: c.minSpend || 0,
    requiresCard: null,
    validUntil: c.validUntil || null,
    conditions: c.conditions || '',
    source: clubResult.url || (club.pages && club.pages[0] && club.pages[0].url) || '',
    tags: [],
    status: 'unverified',
    checkedAt: today,
  }));
}

function toStatus(scanned) {
  if (!scanned || !scanned.found) return null;
  return {
    points: scanned.points,
    points_unit: scanned.pointsUnit || null,
    tier: scanned.tier || null,
    quota_left: scanned.quotaLeft,
    quota_total: scanned.quotaTotal,
    balance_ils: scanned.balanceIls,
    evidence: scanned.evidence || {},
  };
}

/* ---------- main ---------- */

async function main(argv) {
  const args = new Set(argv);
  const dirArg = argv.indexOf('--clubs-dir');
  const clubsDir = dirArg >= 0 ? argv[dirArg + 1] : path.join(__dirname, 'clubs');
  const onlyArg = argv.indexOf('--only');
  const only = onlyArg >= 0 ? argv[onlyArg + 1] : null;
  const store = !args.has('--no-store');

  const clubs = loadClubs(clubsDir).filter((c) => !only || c.id === only);
  const secrets = process.env;

  /*
   * המיסוך נבנה לפני שנפתח דפדפן, כדי ששום שורה — כולל שגיאת אתחול
   * — לא תיכתב לפני שהוא קיים.
   */
  const secretValues = clubs
    .flatMap((c) => [c.secretEnv, c.userEnv])
    .filter(Boolean)
    .map((k) => secrets[k])
    .concat([secrets.TELEGRAM_BOT_TOKEN, secrets.SUPABASE_SERVICE_ROLE_KEY, secrets.SESSION_KEY])
    .filter(Boolean);

  const masker = createMasker(secretValues);
  const log = masker.maskedConsole(console);

  log.log(`נטענו ${clubs.length} מועדונים, ${masker.count} דפוסי מיסוך פעילים`);

  const captureSource = fs.readFileSync(CAPTURE_PATH, 'utf8');

  let db = null;
  if (store) {
    const { createSupabaseDb } = require(
      path.join(__dirname, '..', 'supabase', 'functions', 'bot', 'db.js'));
    db = createSupabaseDb({
      url: secrets.SUPABASE_URL,
      key: secrets.SUPABASE_SERVICE_ROLE_KEY,
      seed: require(path.join(__dirname, '..', 'benefits', 'data', 'benefits.json')),
    });
  }

  const sessions = db && secrets.SESSION_KEY
    ? createSessionStore({ db, secret: secrets.SESSION_KEY })
    : null;
  if (store && !sessions) {
    log.log('אין SESSION_KEY — כל מועדון ידרוש התחברות מלאה בכל ריצה');
  }

  const otp = db && secrets.TELEGRAM_BOT_TOKEN && secrets.TELEGRAM_CHAT_IDS
    ? createOtpRelay({
      db,
      log,
      notify: telegramNotifier({
        token: secrets.TELEGRAM_BOT_TOKEN,
        chatIds: secrets.TELEGRAM_CHAT_IDS.split(',').map((s) => s.trim()).filter(Boolean),
      }),
    })
    : null;

  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const context = await browser.newContext({
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    viewport: { width: 1280, height: 900 },
  });

  const today = new Date().toISOString().slice(0, 10);
  const results = [];

  try {
    for (const club of clubs) {
      const r = await scrapeClub(context, club, {
        log, captureSource, sessions, secrets, otp,
      });
      results.push({ club: r.club, ok: r.ok, benefits: r.benefits, error: r.error });

      if (db && r.ok) {
        const rows = toBenefits(r, club, today);
        if (rows.length) await db.saveBenefits(rows);

        const st = toStatus(r.status);
        if (st) await db.saveStatus(club.provider, Object.assign(st, { captured_at: today }));
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }

  const ok = results.filter((r) => r.ok).length;
  log.log(`\nסיכום: ${ok}/${results.length} מועדונים נסרקו`);
  for (const r of results.filter((x) => !x.ok)) log.log(`  ✗ ${r.club}: ${r.error}`);

  if (db) await db.recordRun(results, ok === results.length);

  /*
   * יציאה 0 גם כשמועדון נכשל. ריצה אדומה בכל שבוע בגלל אתר אחד
   * שהשתנה הופכת את ההתראה לרעש, ואז גם כישלון אמיתי לא נבדק.
   * הכישלונות נרשמים ל-scrape_runs ומדווחים בסיכום.
   */
  return ok > 0 || results.length === 0 ? 0 : 1;
}

module.exports = { main, scrapeClub, scanPage, scrollToBottom, loadClubs, toBenefits, toStatus };

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => { console.error(err.message); process.exit(1); });
}
