/*
 * בדיקות לבוט הטלגרם.
 * הרצה:  node test/bot.test.js
 *
 * הכל רץ מקומית: אין טלגרם, אין Supabase ואין רשת. עדכוני הטלגרם
 * נבנים ביד, והאחסון הוא createLocalDb בזיכרון.
 *
 * הבדיקה החשובה כאן היא האחרונה — זהות התשובות. הבוט אמור להיות
 * עטיפה של engine.js ולא מנוע שני, וזו הבדיקה שתיפול ביום שמישהו
 * יתחיל לחשב בבוט משהו בעצמו.
 */

const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const Engine = require(path.join(ROOT, 'benefits', 'engine.js'));
const { handleUpdate } = require(path.join(ROOT, 'supabase', 'functions', 'bot', 'bot.js'));
const { createLocalDb, rowToBenefit, benefitToRow } =
  require(path.join(ROOT, 'supabase', 'functions', 'bot', 'db.js'));

const seed = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'benefits', 'data', 'benefits.json'), 'utf8'));

const NOW = new Date('2026-08-10T12:00:00');
const ARIK = '111';
const STRANGER = '999';

let failed = 0;
function check(name, condition, detail) {
  const mark = condition ? 'PASS' : 'FAIL';
  console.log(`${mark} | ${name}${detail ? '  -> ' + detail : ''}`);
  if (!condition) failed++;
}

function newDb() {
  const db = createLocalDb({ seed, now: () => NOW });
  db._state.allowed = [ARIK];
  return db;
}

/* בניית עדכון טלגרם כפי שהוא מגיע מה-webhook */
const message = (chatId, text) => ({ message: { chat: { id: chatId }, text } });
const callback = (chatId, data) => ({
  callback_query: { id: 'cb1', data, message: { chat: { id: chatId } } },
});

const run = (update, db) => handleUpdate(update, { db, engine: Engine, now: NOW });

/* ---------- בקרת גישה ---------- */

(async () => {

  {
    const out = await run(message(STRANGER, 'קנייה בפוקס ב-400 שקל'), newDb());
    const body = out.map((o) => o.text).join('\n');
    check('משתמש לא מאושר נחסם', /אין לך הרשאה/.test(body));
    check('לזר לא דולפת שום הטבה', !/פוקס|הנחה|חיסכון/.test(body), body.slice(0, 60));
    check('הזר מקבל את מזהה השיחה שלו כדי שאפשר יהיה לאשר אותו',
      body.includes(STRANGER));
  }

  {
    const db = newDb();
    const out = await run(message(ARIK, 'קנייה בפוקס ב-400 שקל'), db);
    check('משתמש מאושר מקבל תשובה', out.length >= 1 && out[0].text.length > 20);
    check('התשובה מציינת מה הובן מהשאלה', /הבנתי/.test(out[0].text));
  }

  /* ---------- פקודות ---------- */

  {
    const out = await run(message(ARIK, '/help'), newDb());
    check('/help מחזיר עזרה', /מה אפשר לשאול/.test(out[0].text));
  }

  {
    const out = await run(message(ARIK, '/start'), newDb());
    check('/start מחזיר את אותה עזרה', /מה אפשר לשאול/.test(out[0].text));
  }

  {
    const db = newDb();
    const out = await run(message(ARIK, '/status'), db);
    check('/status בלי נתונים מסביר מה לעשות', /עוד לא נאסף/.test(out[0].text));

    await db.saveStatus('elal_matmid', { points: 12000, points_unit: 'נקודות', tier: 'כסופה' });
    const out2 = await run(message(ARIK, '/status'), db);
    check('/status מציג נקודות אחרי איסוף', /12,000/.test(out2[0].text), out2[0].text);
    check('/status מציג דרגה', /כסופה/.test(out2[0].text));
    check('/status מציג את שם המועדון ולא את המזהה הטכני',
      !/elal_matmid/.test(out2[0].text), out2[0].text);
    // 12,000 × 0.025 = 300 ₪
    check('/status ממיר נקודות אל על לשקלים לפי ההגדרות',
      /300/.test(out2[0].text), out2[0].text);

    await db.saveStatus('max', { points: 5000, points_unit: 'נקודות פינוק' });
    const out3 = await run(message(ARIK, '/status'), db);
    check('נקודות בלי שווי מוגדר מוצגות בלי סכום מומצא',
      /5,000 נקודות פינוק(?! ≈)/.test(out3[0].text), out3[0].text);
  }

  {
    const db = newDb();
    const out = await run(message(ARIK, '/scan'), db);
    check('/scan מפעיל סריקה', db._state.scrapeRequests.length === 1);
    check('/scan מודיע שהתחיל', /התחלתי סריקה/.test(out[0].text));
  }

  /* ---------- ממסר ה-OTP ---------- */

  {
    const db = newDb();
    const notCode = await run(message(ARIK, 'מקרר ב-4000'), db);
    check('בלי בקשה פתוחה, שאלה רגילה אינה נחשבת לקוד',
      !/הקוד התקבל/.test(notCode[0].text));

    // מספר בן שש ספרות בתוך שאלה רגילה, בלי בקשה פתוחה
    const sixDigits = await run(message(ARIK, '123456'), db);
    check('בלי בקשה פתוחה, "123456" מטופל כשאלה ולא כקוד',
      !/הקוד התקבל/.test(sixDigits[0].text), sixDigits[0].text.slice(0, 40));

    const req = await db.requestOtp('מקס');
    const answered = await run(message(ARIK, '123456'), db);
    check('עם בקשה פתוחה, אותו טקסט נקלט כקוד', /הקוד התקבל/.test(answered[0].text));
    check('הקוד נשמר לבקשה', (await db.readOtp(req.id)).code === '123456');
    check('הבקשה נסגרת אחרי מענה', (await db.pendingOtp()) === null);
    check('ההודעה מציינת לאיזה מועדון', /מקס/.test(answered[0].text));
  }

  {
    const db = newDb();
    await db.requestOtp('כאל');
    const out = await run(message(ARIK, 'קנייה בפוקס ב-400 שקל'), db);
    check('בקשה פתוחה אינה בולעת שאלה רגילה', !/הקוד התקבל/.test(out[0].text));
    check('הבקשה נשארת פתוחה', (await db.pendingOtp()) !== null);
  }

  /* ---------- שאלת הבהרה וכפתורים ---------- */

  {
    const db = newDb();
    // מוצאים שאלה אמיתית מתוך המאגר במקום להניח שקיימת
    const withVariants = seed.benefits.find((b) => b.variants && b.variants.length > 1);
    let asked = null;
    if (withVariants) {
      for (const q of [`${withVariants.merchants[0] || withVariants.title} ב-1000 שקל`]) {
        const out = await run(message(ARIK, q), db);
        if (out.length > 1 && out[1].keyboard) { asked = { q, out }; break; }
      }
    }

    if (asked) {
      check('שאלת הבהרה מגיעה עם כפתורים',
        asked.out[1].keyboard.inline_keyboard.length > 1);
      check('השאלה המקורית נשמרה לצורך הבחירה',
        (await db.lastQuery(ARIK)) === asked.q);

      const btn = asked.out[1].keyboard.inline_keyboard[0][0];
      check('נתוני הכפתור נכנסים ל-64 הבתים של טלגרם',
        Buffer.byteLength(btn.callback_data, 'utf8') <= 64,
        `${Buffer.byteLength(btn.callback_data, 'utf8')} בתים`);

      const picked = await run(callback(ARIK, btn.callback_data), db);
      check('בחירה בכפתור מחזירה תשובה סופית בלי שאלה נוספת',
        picked.length === 1 && /הכי משתלם|לא מצאתי/.test(picked[0].text));
      check('הבחירה מאשרת את לחיצת הכפתור לטלגרם', picked[0].answerCallback === 'cb1');
    } else {
      check('שאלת הבהרה מגיעה עם כפתורים', false, 'לא נמצאה הטבה עם variants שמפעילה שאלה');
    }
  }

  {
    // לחיצה על כפתור אחרי שהמצב נמחק (הבוט הופעל מחדש)
    const db = newDb();
    const out = await run(callback(ARIK, 'pick:some-benefit:a'), db);
    check('כפתור בלי שאלה שמורה אינו מחזיר תשובה שגויה',
      /לא זכרתי את השאלה/.test(out[0].text), out[0].text);
  }

  /* ---------- קלט ריק ---------- */

  {
    const out = await run({ message: { chat: { id: ARIK } } }, newDb());
    check('הודעה בלי טקסט אינה מפילה את הבוט', Array.isArray(out) && out.length === 0);

    const out2 = await run({}, newDb());
    check('עדכון בלי הודעה אינו מפיל את הבוט', Array.isArray(out2) && out2.length === 0);
  }

  /* ---------- המרת שורות מסד הנתונים ---------- */

  {
    const original = seed.benefits.find((b) => b.merchants.length && b.tags.length);
    const back = rowToBenefit(benefitToRow(original));
    const fields = ['id', 'provider', 'title', 'kind', 'value', 'minSpend', 'merchants',
      'categories', 'tags', 'conditions', 'source', 'status', 'checkedAt', 'validUntil'];
    const bad = fields.filter((f) => JSON.stringify(back[f]) !== JSON.stringify(original[f]));
    check('הטבה מהמאגר עוברת הלוך ושוב דרך שורת Postgres בלי לאבד שדות',
      bad.length === 0, bad.join(', '));
  }

  {
    /*
     * השדות שהמאגר הנוכחי אינו משתמש בהם עדיין, אבל הסורק כן ייצר:
     * תקרה לעסקה, מגבלת ימים, תקופת חסימה ו-variants. אם ההמרה
     * תאבד אותם, זה יתגלה רק בייצור — ולכן הם נבדקים על רשומה בנויה.
     */
    const synthetic = {
      id: 'x1', provider: 'max', title: 'הטבה מורכבת',
      merchants: ['פוקס'], categories: ['fashion'], kind: 'percent', value: 20,
      capPerTx: 150, minSpend: 300, requiresCard: 'max',
      variants: [{ id: 'a', label: 'אמצע שבוע', value: 20 }],
      validFrom: '2026-01-01', validUntil: '2026-12-31',
      validDays: [0, 1, 2, 3], blackout: [{ from: '2026-09-11', to: '2026-10-04', reason: 'חגים' }],
      conditions: 'תנאי', source: 'https://example.com', tags: ['בגדים'],
      status: 'verified', checkedAt: '2026-08-10',
    };
    const back = rowToBenefit(benefitToRow(synthetic));
    const bad = Object.keys(synthetic)
      .filter((f) => JSON.stringify(back[f]) !== JSON.stringify(synthetic[f]));
    check('הטבה עם תקרה, ימים, חסימה ו-variants שורדת את ההמרה',
      bad.length === 0, bad.join(', '));

    // ההמרה חייבת גם לשמר התנהגות, לא רק שדות
    const evalOrig = Engine.evaluate(synthetic, { amount: 1000, date: new Date('2026-08-10T12:00:00'), settings: seed.settings });
    const evalBack = Engine.evaluate(back, { amount: 1000, date: new Date('2026-08-10T12:00:00'), settings: seed.settings });
    check('המנוע מגיע לאותה תוצאה לפני ואחרי ההמרה',
      JSON.stringify(evalOrig) === JSON.stringify(evalBack));
  }

  {
    const db = newDb();
    const beforeCount = (await db.loadDb()).benefits.length;
    await db.saveBenefits([rowToBenefit(benefitToRow(seed.benefits[0]))]);
    check('שמירת הטבות מחליפה את הזרעים', (await db.loadDb()).benefits.length === 1
      && beforeCount > 1);
  }

  /* ---------- זהות תשובות: הבוט מול המנוע ---------- */

  /*
   * זו הבדיקה שמחזיקה את העיקרון. אותה שאלה עוברת פעם דרך המנוע
   * ישירות ופעם דרך הבוט, ומה שהבוט הציג חייב להיות מה שהמנוע חישב.
   * אם מישהו יוסיף חישוב בבוט, כאן זה ייפול.
   */
  {
    const questions = [
      'קנייה בפוקס ב-400 שקל',
      'מקרר ב-4000',
      'הוצאות בחו"ל ב-5000',
      'מלון ביום שישי ב-2000',
      'דלק ב-300',
      'סופר ב-800',
      'טיסה ב-3000 שקל',
      'שטויות שאין להן שום קשר',
    ];

    let mismatches = [];
    let compared = 0;
    for (const q of questions) {
      const database = await newDb().loadDb();
      const parsed = Engine.parseQuery(database, q, NOW);
      const plan = Engine.composePlan(database, parsed, NOW, {});

      const out = await run(message(ARIK, q), newDb());
      const shown = out.map((o) => o.text).join('\n');

      if (!plan.primary) {
        // בלי מנצח, אסור שהבוט יציג "הכי משתלם"
        if (/הכי משתלם/.test(shown)) mismatches.push(`${q}: הבוט הציג מנצח שהמנוע לא מצא`);
        continue;
      }

      compared++;
      if (!shown.includes(plan.primary.title)) {
        mismatches.push(`${q}: כותרת שונה`);
      }
      if (!shown.includes(Engine.formatIls(plan.primary.saving))) {
        mismatches.push(`${q}: חיסכון שונה (${Engine.formatIls(plan.primary.saving)})`);
      }
      for (const alt of plan.alternatives) {
        if (!shown.includes(alt.title)) mismatches.push(`${q}: חסרה חלופה "${alt.title}"`);
      }
    }

    check('הבוט מציג בדיוק את מה שהמנוע חישב, בכל השאלות',
      mismatches.length === 0, mismatches.join(' | '));

    /*
     * בלי זה, יום שבו אף שאלה לא מחזירה מנצח היה נראה כמו הצלחה.
     * הבדיקה שלמעלה משווה תוצאות, וזו מוודאת שהיה מה להשוות.
     */
    check('בדיקת הזהות אכן השוותה תשובות ולא רצה על ריק',
      compared >= 4, `הושוו ${compared} מתוך ${questions.length}`);
  }

  {
    // סימון "לאימות" חייב להגיע למשתמש — כל המאגר כרגע לא מאומת
    const out = await run(message(ARIK, 'קנייה בפוקס ב-400 שקל'), newDb());
    const shown = out.map((o) => o.text).join('\n');
    check('הטבה לא מאומתת מסומנת ככזו למשתמש',
      !/הכי משתלם/.test(shown) || /לאימות/.test(shown), shown.slice(0, 80));
  }

  /* ---------- מימוש Supabase, מול fetch מזויף ---------- */

  /*
   * המימוש האמיתי אינו נבדק מול Supabase (חסום מכאן), אבל אפשר
   * לבדוק שהוא בונה את הבקשות הנכונות ומפרש נכון את התשובות.
   */
  {
    const { createSupabaseDb } = require(path.join(ROOT, 'supabase', 'functions', 'bot', 'db.js'));
    const calls = [];
    const stub = (routes) => async (url, opts = {}) => {
      calls.push({ url, method: opts.method || 'GET', body: opts.body, headers: opts.headers });
      const key = Object.keys(routes).find((k) => url.includes(k));
      const value = key ? routes[key] : [];
      return { ok: true, status: 200, text: async () => JSON.stringify(value) };
    };

    const sdb = createSupabaseDb({
      url: 'https://proj.supabase.co/',
      key: 'service-key',
      seed,
      fetch: stub({ '/allowed_users': [{ chat_id: ARIK }], '/benefits': [] }),
      now: () => NOW,
    });

    check('isAllowed מתרגם לשאילתת PostgREST', await sdb.isAllowed(ARIK) === true);
    check('הבקשה נושאת את מפתח השירות',
      calls[0].headers.Authorization === 'Bearer service-key');
    check('אין קו נטוי כפול בכתובת',
      !calls[0].url.replace('https://', '').includes('//'), calls[0].url);

    const loaded = await sdb.loadDb();
    check('טבלת הטבות ריקה נופלת חזרה לזרעים כדי שהבוט יעבוד מיד',
      loaded.benefits.length === seed.benefits.length);
    check('המטא-דאטה מגיעה מהקוד ולא ממסד הנתונים',
      loaded.providers === seed.providers && loaded.settings === seed.settings);

    const sdb2 = createSupabaseDb({
      url: 'https://proj.supabase.co',
      key: 'k',
      seed,
      fetch: stub({ '/benefits': [benefitToRow(seed.benefits[0])] }),
    });
    const loaded2 = await sdb2.loadDb();
    check('כשיש הטבות במסד, הן גוברות על הזרעים',
      loaded2.benefits.length === 1 && loaded2.benefits[0].id === seed.benefits[0].id);

    // שגיאת HTTP חייבת להתפוצץ ולא להיבלע כתשובה ריקה
    const failing = createSupabaseDb({
      url: 'https://proj.supabase.co', key: 'k', seed,
      fetch: async () => ({ ok: false, status: 401, text: async () => '' }),
    });
    let threw = false;
    try { await failing.loadDb(); } catch { threw = true; }
    check('שגיאת Supabase אינה נבלעת כרשימה ריקה', threw);

    // בלי dispatch, /scan חייב לומר זאת ולא להעמיד פנים שהצליח
    const noDispatch = createSupabaseDb({
      url: 'https://proj.supabase.co', key: 'k', seed,
      fetch: stub({ '/allowed_users': [{ chat_id: ARIK }] }),
    });
    let scanThrew = false;
    try { await noDispatch.requestScrape(); } catch { scanThrew = true; }
    check('בלי הגדרת הפעלה, /scan אינו מדווח על הצלחה מדומה', scanThrew);
  }

  /* ---------- העותק המקומי של המנוע מעודכן ---------- */

  {
    /*
     * _vendor הוא עותק מיוצר. אם המנוע עודכן ולא הורץ ה-build,
     * הבוט בייצור יריץ קוד ישן בלי שאיש ישים לב.
     */
    const vendored = path.join(ROOT, 'supabase', 'functions', 'bot', '_vendor', 'engine.js');
    const original = fs.readFileSync(path.join(ROOT, 'benefits', 'engine.js'), 'utf8');
    const copy = fs.existsSync(vendored) ? fs.readFileSync(vendored, 'utf8') : '';
    check('העותק של המנוע בתיקיית הפונקציה מעודכן',
      copy.includes(original),
      'הריצו: node supabase/functions/bot/build.js');

    const vendorSeed = path.join(ROOT, 'supabase', 'functions', 'bot', '_vendor', 'benefits.json');
    check('העותק של מאגר ההטבות מעודכן',
      fs.existsSync(vendorSeed)
      && fs.readFileSync(vendorSeed, 'utf8')
         === fs.readFileSync(path.join(ROOT, 'benefits', 'data', 'benefits.json'), 'utf8'),
      'הריצו: node supabase/functions/bot/build.js');
  }

  console.log(failed ? `\n${failed} בדיקות נכשלו` : '\nכל הבדיקות עברו ✓');
  process.exit(failed ? 1 : 0);

})();
