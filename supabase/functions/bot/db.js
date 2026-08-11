/*
 * db.js — שכבת האחסון של הבוט, בשני מימושים שחולקים ממשק אחד.
 *
 *   createLocalDb    — קובץ JSON. משמש את כל הבדיקות, בלי רשת ובלי חשבון.
 *   createSupabaseDb — REST של Supabase. מה שרץ בייצור.
 *
 * bot.js מקבל אחד מהם מבחוץ ואינו יודע במי מדובר. זה מה שמאפשר לבדוק
 * את כל התנהגות הבוט מקומית, וזו גם הסיבה ששני המימושים נמצאים בקובץ
 * אחד: אם הממשק ישתנה רק באחד מהם, ההבדל בולט לעין.
 *
 * מטא-דאטה (settings, categories, providers) אינה יושבת ב-Postgres אלא
 * נשלחת עם הקוד. היא משתנה רק כשאנחנו משנים אותה, ואין טעם לסנכרן
 * דרך מסד נתונים משהו שממילא מגיע מהמאגר.
 */

/* ---------- המרה בין שורת Postgres לרשומת הטבה ---------- */

/*
 * הסכימה ב-Postgres היא snake_case והמנוע עובד ב-camelCase. ההמרה
 * מרוכזת כאן ולא מפוזרת, כי גם הסורק כותב דרכה.
 */
function rowToBenefit(row) {
  return {
    id: row.id,
    provider: row.provider,
    title: row.title,
    merchants: row.merchants || [],
    categories: row.categories || [],
    kind: row.kind,
    value: row.value == null ? null : Number(row.value),
    capPerTx: row.cap_per_tx == null ? null : Number(row.cap_per_tx),
    minSpend: row.min_spend == null ? 0 : Number(row.min_spend),
    requiresCard: row.requires_card || null,
    variants: row.variants || undefined,
    validFrom: row.valid_from || null,
    validUntil: row.valid_until || null,
    validDays: row.valid_days || undefined,
    blackout: row.blackout && row.blackout.length ? row.blackout : undefined,
    conditions: row.conditions || '',
    source: row.source || '',
    tags: row.tags || [],
    status: row.status || 'unverified',
    checkedAt: row.checked_at || null,
  };
}

function benefitToRow(b) {
  return {
    id: b.id,
    provider: b.provider,
    title: b.title,
    merchants: b.merchants || [],
    categories: b.categories || [],
    kind: b.kind,
    value: b.value == null ? null : b.value,
    cap_per_tx: b.capPerTx == null ? null : b.capPerTx,
    min_spend: b.minSpend || 0,
    requires_card: b.requiresCard || null,
    variants: b.variants || [],
    valid_from: b.validFrom || null,
    valid_until: b.validUntil || null,
    valid_days: b.validDays || null,
    blackout: b.blackout || [],
    conditions: b.conditions || '',
    source: b.source || '',
    tags: b.tags || [],
    status: b.status || 'unverified',
    checked_at: b.checkedAt || null,
    updated_at: new Date().toISOString(),
  };
}

/* ---------- מימוש מקומי: קובץ JSON ---------- */

/*
 * seed הוא התוכן של benefits/data/benefits.json — גם מקור המטא-דאטה
 * וגם מאגר ההטבות ההתחלתי.
 *
 * state הוא מה שמשתנה בזמן ריצה. ב-createLocalDb הוא נשמר לקובץ
 * (או מוחזק בזיכרון אם לא ניתן נתיב, כדי שבדיקות לא ישאירו לכלוך).
 */
function createLocalDb({ seed, statePath, fs, now } = {}) {
  if (!seed) throw new Error('createLocalDb: חסר seed');

  const clock = now || (() => new Date());
  let state = {
    allowed: [],
    status: {},
    benefits: null,   // null = להשתמש בזרעים
    otp: [],
    lastQuery: {},
    scrapeRequests: [],
    sessions: {},
    runs: [],
  };

  if (statePath && fs && fs.existsSync(statePath)) {
    state = Object.assign(state, JSON.parse(fs.readFileSync(statePath, 'utf8')));
  }

  const save = () => {
    if (statePath && fs) fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  };

  return {
    _state: state,   // לבדיקות בלבד

    async isAllowed(chatId) {
      return state.allowed.map(String).includes(String(chatId));
    },

    async loadDb() {
      return {
        settings: seed.settings,
        categories: seed.categories,
        providers: seed.providers,
        benefits: state.benefits || seed.benefits,
      };
    },

    async loadStatus() {
      return state.status;
    },

    async saveStatus(provider, fields) {
      state.status[provider] = Object.assign({}, state.status[provider], fields, {
        updated_at: clock().toISOString(),
      });
      save();
    },

    async saveBenefits(list) {
      state.benefits = list;
      save();
    },

    async lastQuery(chatId) {
      return state.lastQuery[String(chatId)] || '';
    },

    async setLastQuery(chatId, text) {
      state.lastQuery[String(chatId)] = text;
      save();
    },

    async pendingOtp() {
      return state.otp.find((o) => o.status === 'pending') || null;
    },

    async requestOtp(club) {
      const req = {
        id: `otp-${state.otp.length + 1}`,
        club,
        status: 'pending',
        code: null,
        created_at: clock().toISOString(),
      };
      state.otp.push(req);
      save();
      return req;
    },

    async readOtp(id) {
      return state.otp.find((o) => o.id === id) || null;
    },

    async answerOtp(id, code) {
      const req = state.otp.find((o) => o.id === id);
      if (!req) return;
      req.code = code;
      req.status = 'answered';
      req.answered_at = clock().toISOString();
      save();
    },

    async expireOtp(id) {
      const req = state.otp.find((o) => o.id === id);
      if (req) { req.status = 'expired'; save(); }
    },

    async requestScrape() {
      state.scrapeRequests.push(clock().toISOString());
      save();
    },

    async loadSession(club) {
      return state.sessions[club] || null;
    },

    async saveSession(club, cookies, expiresAt) {
      state.sessions[club] = { club, cookies, expires_at: expiresAt };
      save();
    },

    async recordRun(results, ok) {
      state.runs.push({ results, ok, finished_at: clock().toISOString() });
      save();
    },
  };
}

/* ---------- מימוש Supabase ---------- */

/*
 * גישה דרך PostgREST עם מפתח השירות. המפתח הזה עוקף RLS, ולכן הוא
 * חי רק בתוך ה-Edge Function ובסודות של Actions — לעולם לא בדפדפן.
 */
function createSupabaseDb({ url, key, fetch: doFetch, dispatch, seed, now } = {}) {
  if (!url || !key) throw new Error('createSupabaseDb: חסרים url או key');
  if (!seed) throw new Error('createSupabaseDb: חסר seed למטא-דאטה');

  const f = doFetch || globalThis.fetch;
  const clock = now || (() => new Date());
  const base = url.replace(/\/+$/, '') + '/rest/v1';

  async function rest(path, opts = {}) {
    const res = await f(base + path, Object.assign({}, opts, {
      headers: Object.assign({
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      }, opts.headers || {}),
    }));
    if (!res.ok) {
      throw new Error(`Supabase ${opts.method || 'GET'} ${path} → ${res.status}`);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  return {
    async isAllowed(chatId) {
      const rows = await rest(`/allowed_users?chat_id=eq.${encodeURIComponent(chatId)}&select=chat_id`);
      return Array.isArray(rows) && rows.length > 0;
    },

    async loadDb() {
      const rows = await rest('/benefits?select=*');
      /*
       * פרויקט טרי מחזיר טבלה ריקה. במצב כזה עדיף להשיב מהזרעים
       * מאשר לומר "לא נמצאה הטבה" — הבוט עובד מהרגע הראשון, לפני
       * שהסורק רץ אפילו פעם אחת.
       */
      const benefits = rows && rows.length ? rows.map(rowToBenefit) : seed.benefits;
      return {
        settings: seed.settings,
        categories: seed.categories,
        providers: seed.providers,
        benefits,
      };
    },

    async loadStatus() {
      const rows = await rest('/my_status?select=*');
      const out = {};
      for (const r of rows || []) out[r.provider] = r;
      return out;
    },

    async saveStatus(provider, fields) {
      await rest('/my_status', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(Object.assign({ provider }, fields, {
          updated_at: clock().toISOString(),
        })),
      });
    },

    async saveBenefits(list) {
      if (!list.length) return;
      await rest('/benefits', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(list.map(benefitToRow)),
      });
    },

    async lastQuery(chatId) {
      const rows = await rest(`/chat_state?chat_id=eq.${encodeURIComponent(chatId)}&select=last_query`);
      return (rows && rows[0] && rows[0].last_query) || '';
    },

    async setLastQuery(chatId, text) {
      await rest('/chat_state', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({
          chat_id: String(chatId),
          last_query: text,
          updated_at: clock().toISOString(),
        }),
      });
    },

    async pendingOtp() {
      const rows = await rest('/otp_requests?status=eq.pending&order=created_at.desc&limit=1&select=*');
      return (rows && rows[0]) || null;
    },

    async requestOtp(club) {
      const rows = await rest('/otp_requests', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ club, status: 'pending' }),
      });
      return rows && rows[0];
    },

    async readOtp(id) {
      const rows = await rest(`/otp_requests?id=eq.${encodeURIComponent(id)}&select=*`);
      return (rows && rows[0]) || null;
    },

    async answerOtp(id, code) {
      await rest(`/otp_requests?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          code,
          status: 'answered',
          answered_at: clock().toISOString(),
        }),
      });
    },

    async expireOtp(id) {
      await rest(`/otp_requests?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'expired' }),
      });
    },

    /*
     * ההפעלה עצמה אינה של Supabase אלא של GitHub, ולכן היא מוזרקת.
     * בלי dispatch הבוט לא נשבר — הוא פשוט לא מפעיל סריקה, וזה מה
     * שקורה עד שאריק מזין את הטוקן.
     */
    async requestScrape() {
      if (!dispatch) throw new Error('לא הוגדרה הפעלת סריקה');
      await dispatch();
    },

    async loadSession(club) {
      const rows = await rest(`/sessions?club=eq.${encodeURIComponent(club)}&select=*`);
      return (rows && rows[0]) || null;
    },

    async saveSession(club, cookies, expiresAt) {
      await rest('/sessions', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({
          club, cookies, expires_at: expiresAt, updated_at: clock().toISOString(),
        }),
      });
    },

    async recordRun(results, ok) {
      await rest('/scrape_runs', {
        method: 'POST',
        body: JSON.stringify({ results, ok, finished_at: clock().toISOString() }),
      });
    },
  };
}

/*
 * ההפעלה של ה-workflow, כפונקציה נפרדת כדי שאפשר יהיה לבדוק את הבוט
 * בלי GitHub בכלל.
 */
function githubDispatch({ repo, token, fetch: doFetch, eventType = 'scrape' }) {
  const f = doFetch || globalThis.fetch;
  return async () => {
    const res = await f(`https://api.github.com/repos/${repo}/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ event_type: eventType }),
    });
    if (!res.ok) throw new Error(`GitHub dispatch → ${res.status}`);
  };
}

module.exports = {
  createLocalDb,
  createSupabaseDb,
  githubDispatch,
  rowToBenefit,
  benefitToRow,
};
