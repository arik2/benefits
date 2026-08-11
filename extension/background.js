/*
 * Service worker — מתזמר סריקה של כל המועדונים.
 *
 * למה כאן ולא בחלונית: חלונית MV3 נסגרת ברגע שנוצר טאב או מתחלף פוקוס,
 * ולולאה שפותחת תשעה טאבים הייתה מתה מיד. ה-worker שורד, והחלונית הופכת
 * לתצוגה שקוראת את מצב הריצה.
 *
 * ה-worker עצמו נהרג אחרי כ-30 שניות ללא פעילות. שתי הגנות: הקריאות
 * ל-chrome.tabs מאפסות את הטיימר, ובנוסף מצב הריצה נשמר ל-storage אחרי
 * כל אתר — כך שגם אם ה-worker נהרג, שום תוצאה שכבר נאספה לא הולכת לאיבוד.
 */

const CLUB_PAGES = [
  { url: 'https://www.htzone.co.il/', name: 'הייטקזון' },
  { url: 'https://www.dts.co.il/', name: 'בהצדעה' },
  { url: 'https://be-plus.co.il/', name: 'Be-Plus' },
  { url: 'https://paisplus.co.il/', name: 'פיס פלוס' },
  { url: 'https://www.max.co.il/benefits/lobby', name: 'מקס' },
  { url: 'https://www.cal-online.co.il/benefits/', name: 'כאל' },
  { url: 'https://www.mafteach.co.il/', name: 'מפתח דיסקונט' },
  { url: 'https://www.isracard.co.il/flycard/private', name: 'פליי קארד' },
  { url: 'https://fox.co.il/pages/dream-card-%D7%94%D7%98%D7%91%D7%95%D7%AA-%D7%9E%D7%95%D7%A2%D7%93%D7%95%D7%9F', name: 'דרים קארד' },
];

const PAGE_TIMEOUT_MS = 25000;

/* רשימת הבדיקה גוברת כשהיא קיימת, כדי שכתובות בדיקה לא ידלפו לייצור */
async function clubList() {
  const { testClubUrls } = await chrome.storage.local.get('testClubUrls');
  return Array.isArray(testClubUrls) && testClubUrls.length ? testClubUrls : CLUB_PAGES;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getRun() {
  const { run } = await chrome.storage.local.get('run');
  return run || null;
}

async function setRun(run) {
  await chrome.storage.local.set({ run });
}

/* המתנה לטעינת הטאב, עם תקרה — אתר תקוע לא יעצור את כל הריצה */
function waitForLoad(tabId, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      resolve(ok);
    };
    const onUpdated = (id, info) => {
      if (id === tabId && info.status === 'complete') finish(true);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);

    // ייתכן שהטאב כבר הספיק להיטען לפני שנרשמנו
    chrome.tabs.get(tabId).then((t) => { if (t && t.status === 'complete') finish(true); }, () => finish(false));
  });
}

/*
 * שולח בקשת סריקה. אם ה-content script לא נמצא בטאב (למשל טאב שנפתח
 * לפני התקנת התוסף), מזריקים אותו ידנית ומנסים שוב.
 */
async function requestScan(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: 'scan' });
  } catch (err) {
    if (!/Receiving end does not exist|Could not establish connection/i.test(err.message || '')) throw err;
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['noautorun.js', 'capture.js', 'content.js'],
    });
    await sleep(400);
    return chrome.tabs.sendMessage(tabId, { type: 'scan' });
  }
}

/*
 * מסווג את תוצאת הסריקה.
 *
 * הנקודה העדינה: דפי בית של מועדונים מציגים הטבות ציבוריות גם כשלא
 * מחוברים, ולכן "נמצאו הטבות" אינו מוכיח התחברות. נתון אישי (נקודות,
 * דרגה, מכסה) הוא ההוכחה החזקה היחידה. כשיש הטבות בלי נתון אישי,
 * מסמנים publicOnly במקום להכריז על הצלחה מלאה.
 */
function classify(res) {
  if (!res || !res.ok) return { state: 'error', error: (res && res.error) || 'שגיאה לא ידועה' };
  if (res.loggedOut) return { state: 'needs-login' };

  const hasStatus = res.status && res.status.found;
  const hasItems = (res.items || []).length > 0;

  if (hasStatus) return { state: 'ok', publicOnly: false };
  if (hasItems) return { state: 'ok', publicOnly: true };
  return { state: 'needs-login' };
}

async function scanOneSite(site) {
  let tabId = null;
  try {
    const tab = await chrome.tabs.create({ url: site.url, active: false });
    tabId = tab.id;

    const loaded = await waitForLoad(tabId, PAGE_TIMEOUT_MS);
    if (!loaded) {
      await chrome.tabs.remove(tabId).catch(() => {});
      return { state: 'timeout', error: 'העמוד לא סיים להיטען' };
    }

    const res = await Promise.race([
      requestScan(tabId),
      sleep(PAGE_TIMEOUT_MS).then(() => ({ ok: false, error: 'הסריקה נתקעה' })),
    ]);

    const verdict = classify(res);
    const out = {
      ...verdict,
      benefits: (res && res.items) || [],
      status: (res && res.status) || null,
      capturedFrom: (res && res.capturedFrom) || site.url,
    };

    // טאב שדורש התחברות נשאר פתוח כדי שהמשתמש יוכל להיכנס
    if (verdict.state === 'needs-login') out.tabId = tabId;
    else await chrome.tabs.remove(tabId).catch(() => {});

    return out;
  } catch (err) {
    if (tabId != null) await chrome.tabs.remove(tabId).catch(() => {});
    return { state: 'error', error: err.message, benefits: [], status: null };
  }
}

/* מריץ את הרשימה לפי הסדר, ושומר מצב אחרי כל אתר */
async function runScan(onlyPending) {
  let run = await getRun();

  if (!onlyPending || !run) {
    const sites = await clubList();
    run = {
      startedAt: new Date().toISOString(),
      sites: sites.map((s) => ({ url: s.url, name: s.name, state: 'pending' })),
      currentIndex: 0,
      done: false,
    };
  } else {
    // "המשך" — רק מה שדרש התחברות או נכשל
    run.sites = run.sites.map((s) => (
      ['needs-login', 'error', 'timeout'].includes(s.state) ? { ...s, state: 'pending' } : s
    ));
    run.done = false;
  }
  await setRun(run);

  for (let i = 0; i < run.sites.length; i++) {
    if (run.sites[i].state !== 'pending') continue;

    run.currentIndex = i;
    run.sites[i].state = 'scanning';
    await setRun(run);

    const result = await scanOneSite(run.sites[i]);
    run.sites[i] = { ...run.sites[i], ...result };
    await setRun(run);
  }

  run.done = true;
  await setRun(run);

  const okCount = run.sites.filter((s) => s.state === 'ok').length;
  chrome.action.setBadgeText({ text: okCount ? String(okCount) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#1d4ed8' });
  return run;
}

let running = false;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;

  if (msg.type === 'captured-count' && sender.tab) {
    chrome.action.setBadgeText({ tabId: sender.tab.id, text: String(msg.count || '') });
    chrome.action.setBadgeBackgroundColor({ color: '#1d4ed8' });
    return;
  }

  if (msg.type === 'scan-all' || msg.type === 'scan-remaining') {
    if (running) { sendResponse({ ok: false, error: 'סריקה כבר רצה' }); return true; }
    running = true;
    runScan(msg.type === 'scan-remaining')
      .then((run) => sendResponse({ ok: true, run }))
      .catch((err) => sendResponse({ ok: false, error: err.message }))
      .finally(() => { running = false; });
    return true;
  }

  if (msg.type === 'get-run') {
    getRun().then((run) => sendResponse({ ok: true, run, running }));
    return true;
  }
});
