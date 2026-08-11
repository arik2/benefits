/*
 * בדיקות לתוסף הדפדפן, עם כרום אמיתי והתוסף טעון בו.
 * הרצה:  node test/extension.test.js
 *
 * התוסף הוא היום גיבוי — הסריקה השבועית בענן עושה את העבודה — אבל
 * הוא עדיין הדרך היחידה ללכוד ידנית מועדון שלא נסרק, ולכן הוא עדיין
 * צריך לעבוד. הבדיקה הזו ישבה קודם מחוץ למאגר והייתה נעלמת עם
 * הסביבה; כאן היא רצה עם כל השאר.
 *
 * הריצה כוללת אתר שלא מסיים להיטען, ולכן היא איטית במכוון — בערך
 * דקה. זו הדרך היחידה לבדוק שתקרת הזמן באמת עוצרת אותו.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const EXT_DIR = path.join(ROOT, 'benefits', 'extension');
const { createServer } = require('./fixture/server.js');

let failed = 0;
function check(name, condition, detail) {
  const mark = condition ? 'PASS' : 'FAIL';
  console.log(`${mark} | ${name}${detail ? '  -> ' + detail : ''}`);
  if (!condition) failed++;
}

const listen = (server) => new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});

/* שרת סטטי פשוט, כדי להגיש את benefits/ לתוסף בלי תלות חיצונית */
function staticServer(dir) {
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
  return http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(dir, rel.replace(/^\/+/, ''));
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': (TYPES[path.extname(file)] || 'text/plain') + '; charset=utf-8',
    }).end(fs.readFileSync(file));
  });
}

/* ---------- תצורת התוסף, בלי דפדפן ---------- */

/*
 * הפער שהתגלה: ה-manifest התיר 18 דומיינים, אבל CLUB_PAGES הכיל
 * תשעה בלבד — כלומר אל על, ONE ZERO ובנק דיסקונט לא נסרקו, בלי
 * שום הודעת שגיאה. הבדיקה הזו נועלת את ההתאמה בין השניים.
 */
function configChecks() {
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT_DIR, 'manifest.json'), 'utf8'));
  const background = fs.readFileSync(path.join(EXT_DIR, 'background.js'), 'utf8');

  const patterns = manifest.content_scripts[0].matches;
  const clubUrls = [...background.matchAll(/url:\s*'([^']+)'/g)].map((m) => m[1]);

  check('CLUB_PAGES אינו ריק', clubUrls.length > 0, `${clubUrls.length} מועדונים`);

  /*
   * תוסף שמבקש הרשאה ל-localhost מקבל גישה לכל מה שרץ על המחשב.
   * זו הרשאה שנועדה לבדיקות ואין לה מקום בגרסה שמותקנת בפועל —
   * הבדיקה מוסיפה אותה לעותק זמני, ולא למה שאריק מתקין.
   */
  check('התוסף אינו מבקש הרשאה ל-localhost',
    !patterns.some((p) => /localhost|127\.0\.0\.1/.test(p)),
    patterns.filter((p) => /localhost|127/.test(p)).join(', '));

  /* התאמת דומיין לתבנית match של כרום */
  const matches = (url, pattern) => {
    const host = new URL(url).hostname;
    const pHost = pattern.replace(/^https?:\/\//, '').split('/')[0];
    return pHost.startsWith('*.')
      ? host === pHost.slice(2) || host.endsWith('.' + pHost.slice(2))
      : host === pHost;
  };

  const unmatched = clubUrls.filter((u) => !patterns.some((p) => matches(u, p)));
  check('לכל כתובת ב-CLUB_PAGES יש הרשאה ב-manifest', unmatched.length === 0,
    unmatched.join(', '));

  /*
   * הכיוון ההפוך. דומיין שקיבל הרשאה אך אינו נסרק הוא בדיוק הבאג
   * שהיה כאן. שני חריגים מותרים ומוסברים.
   */
  const ALLOWED_EXTRA = {
    '*.americanexpress.co.il': 'אמריקן אקספרס מונפק על ידי ישראכרט, ונסרק דרך פליי קארד',
    '*.pais.co.il': 'הדומיין הראשי של מפעל הפיס; ההטבות יושבות ב-paisplus',
    'be-plus.co.il': 'תת-מותג של הייטקזון',
    '*.be-plus.co.il': 'תת-מותג של הייטקזון',
    '*.elal.co.il': 'דומיין חלופי של אל על, נסרק דרך elal.com',
    'paisplus.co.il': 'מכוסה על ידי הווריאנט עם התחילית',
    'fox.co.il': 'מכוסה על ידי הווריאנט עם התחילית',
  };

  const orphanHosts = patterns
    .map((p) => p.replace(/^https?:\/\//, '').split('/')[0])
    .filter((h) => !ALLOWED_EXTRA[h])
    .filter((h) => !clubUrls.some((u) => matches(u, 'https://' + h)));

  check('כל דומיין שקיבל הרשאה גם נסרק בפועל', orphanHosts.length === 0,
    orphanHosts.join(', '));

  /* והתאמה למועדונים שהסורק בענן מכיר, כדי שהשניים לא ייפרדו */
  const scraperClubs = fs.readdirSync(path.join(ROOT, 'scraper', 'clubs'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'scraper', 'clubs', f), 'utf8')));

  const scraperHosts = new Set(scraperClubs.map((c) => new URL(c.pages[0].url).hostname));
  const extHosts = new Set(clubUrls.map((u) => new URL(u).hostname));
  const onlyInScraper = [...scraperHosts].filter((h) => !extHosts.has(h));

  check('התוסף מכסה את אותם מועדונים כמו הסורק בענן',
    onlyInScraper.length === 0, onlyInScraper.join(', '));

  /*
   * extension/capture.js הוא עותק מיוצר. הבדיקה הזו ישבה קודם
   * ב-workflow הפריסה, שנמחק כשהאתר הציבורי ירד; בלעדיה אפשר
   * לעדכן את הסורק ולשכוח לבנות, והתוסף ימשיך לרוץ עם קוד ישן
   * בלי שאיש ישים לב.
   */
  const built = fs.readFileSync(path.join(EXT_DIR, 'capture.js'), 'utf8');
  const source = fs.readFileSync(path.join(ROOT, 'benefits', 'capture.js'), 'utf8');
  check('העותק של הסורק בתוסף מעודכן', built.includes(source),
    'הריצו: node benefits/extension/build.js');
}

/* ---------- תזמור הסריקה, עם דפדפן ---------- */

(async () => {
  configChecks();

  const fixture = createServer();
  const sitePort = await listen(fixture.server);
  const appServer = staticServer(path.join(ROOT, 'benefits'));
  const appPort = await listen(appServer);

  const TEST_CLUBS = [
    { url: `http://localhost:${sitePort}/club.html`, name: 'מועדון רגיל' },
    { url: `http://localhost:${sitePort}/club-status.html`, name: 'מועדון עם מצב אישי' },
    { url: `http://localhost:${sitePort}/club-locked.html`, name: 'מועדון נעול' },
    { url: `http://localhost:${sitePort}/club-slow.html`, name: 'מועדון איטי' },
  ];

  const profile = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ext-profile-'));

  /*
   * העותק הנבדק זהה למותקן, למעט הרשאה אחת: הכתובת של שרת הבדיקה.
   * בלי זה אי אפשר לבדוק את התוסף בכלל, ועם זה בגרסה המותקנת היינו
   * מבקשים מהמשתמש הרשאה ל-localhost בלי סיבה. ההבדל מפורש וממוקד.
   */
  const testExt = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ext-under-test-'));
  fs.cpSync(EXT_DIR, testExt, { recursive: true });
  const testManifest = JSON.parse(fs.readFileSync(path.join(testExt, 'manifest.json'), 'utf8'));
  testManifest.content_scripts[0].matches.push(`http://localhost:${sitePort}/*`);
  fs.writeFileSync(path.join(testExt, 'manifest.json'), JSON.stringify(testManifest, null, 2));

  /*
   * טעינת תוסף דורשת פרופיל קבוע, ולכן launchPersistentContext ולא
   * launch. הדפדפן נבחר כמו בשאר הבדיקות.
   */
  const exe = process.env.PLAYWRIGHT_CHROMIUM_PATH || findChromium();
  const context = await chromium.launchPersistentContext(profile, Object.assign({
    headless: true,
    args: [`--disable-extensions-except=${testExt}`, `--load-extension=${testExt}`],
    viewport: { width: 480, height: 900 },
  }, exe ? { executablePath: exe } : {}));

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 20000 });
    const extId = new URL(worker.url()).hostname;

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: 'load' });

    // כתובות הבדיקה מוזרקות לאחסון; רשימת הייצור נשארת נקייה מהן
    await popup.evaluate((clubs) => chrome.storage.local.set({ testClubUrls: clubs }), TEST_CLUBS);
    await popup.fill('#app-url', `http://localhost:${appPort}/index.html`);
    await popup.dispatchEvent('#app-url', 'change');

    console.log('  (סורק 4 אתרים, אחד מהם לא מסיים להיטען — עד דקה)');
    await popup.click('#scan-all');
    await popup.waitForFunction(
      () => /הסתיים/.test(document.querySelector('#status').textContent),
      null, { timeout: 120000 });

    const run = await popup.evaluate(
      async () => (await chrome.runtime.sendMessage({ type: 'get-run' })).run);
    const byName = Object.fromEntries(run.sites.map((s) => [s.name, s]));

    check('כל ארבעת האתרים עובדו', run.sites.length === 4 && run.done === true);

    check('מועדון רגיל נסרק בהצלחה',
      byName['מועדון רגיל'].state === 'ok' && byName['מועדון רגיל'].benefits.length >= 5,
      `${byName['מועדון רגיל'].state}, ${byName['מועדון רגיל'].benefits.length} הטבות`);

    // אין אזור אישי בעמוד הרגיל — חייב להיות מסומן ככזה ולא כהצלחה מלאה
    check('מועדון בלי אזור אישי מסומן publicOnly',
      byName['מועדון רגיל'].publicOnly === true);

    const st = byName['מועדון עם מצב אישי'];
    check('מועדון עם מצב אישי נסרק', st.state === 'ok' && st.publicOnly === false, st.state);
    check('נקלטה יתרת נקודות', st.status && st.status.points === 1240,
      String(st.status && st.status.points));
    check('נקלטה דרגה', st.status && st.status.tier === 'זהב', st.status && st.status.tier);
    check('נקלטה מכסה שנותרה', st.status && st.status.quotaLeft === 3);
    check('רגרסיה: הבאנר השיווקי לא נלקח כיתרה', st.status.points !== 5000);

    check('מועדון נעול סומן needs-login',
      byName['מועדון נעול'].state === 'needs-login', byName['מועדון נעול'].state);

    check('מועדון איטי סומן timeout ולא עצר את הריצה',
      byName['מועדון איטי'].state === 'timeout', byName['מועדון איטי'].state);

    // הטאב הנעול נשאר פתוח כדי שהמשתמש יתחבר; השאר נסגרו
    const urls = context.pages().map((p) => p.url());
    check('הטאב הנעול נשאר פתוח', urls.some((u) => u.includes('club-locked')));
    check('הטאבים שנסרקו בהצלחה נסגרו', !urls.some((u) => u.includes('club-status.html')));

    const summary = await popup.textContent('#status');
    check('הסיכום מציג פירוט', /✅ 2/.test(summary) && /🔑 1/.test(summary), summary.trim());

    const runText = (await popup.textContent('#run')).replace(/\s+/g, ' ');
    check('החלונית מציגה את המצב האישי', /1240|1,240/.test(runText) && /זהב/.test(runText));
    check('החלונית מסבירה למה צריך להתחבר', /צריך להתחבר/.test(runText));

  } finally {
    await context.close();
    fixture.server.close();
    appServer.close();
    fs.rmSync(profile, { recursive: true, force: true });
    fs.rmSync(testExt, { recursive: true, force: true });
  }

  console.log(failed ? `\n${failed} בדיקות נכשלו` : '\nכל הבדיקות עברו ✓');
  process.exit(failed ? 1 : 0);

})().catch((err) => { console.error(err); process.exit(1); });

/* אותה נפילה-לאחור כמו ב-scraper.test.js, לסביבות עם כרום מגרסה אחרת */
function findChromium() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (!fs.existsSync(root)) return null;
  return fs.readdirSync(root)
    .map((d) => path.join(root, d, 'chrome-linux', 'chrome'))
    .find((p) => fs.existsSync(p)) || null;
}
