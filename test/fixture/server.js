/*
 * server.js — אתר מועדון מדומה, לבדיקת הסורק מקצה לקצה.
 *
 * אתרי המועדונים האמיתיים חסומים מסביבת הפיתוח, ולכן זה מה שיש.
 * הוא לא מנסה להיראות כמו אתר אמיתי, אלא לשחזר בדיוק את המכשולים
 * שהסורק אמור לעבור: התחברות, קוד חד-פעמי, עוגיית סשן, עמוד שנראה
 * מנותק, ועמוד שנתקע.
 *
 * הקוד החד-פעמי נוצר בשרת ונחשף דרך /testing/code, כדי שהבדיקה
 * תוכל לשחק את התפקיד של אריק שמקריא את ה-SMS.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const SITE = path.join(__dirname, 'site');

const USER = 'arik';
const PASSWORD = 'FixturePass!2026';

const page = (title, body) => `<!doctype html><html lang="he" dir="rtl">
<head><meta charset="utf-8"><title>${title}</title></head>
<body>${body}</body></html>`;

const LOGIN_FORM = page('כניסה', `
  <h1>כניסה לאזור האישי</h1>
  <form method="POST" action="/login">
    <input type="text" name="user" placeholder="תעודת זהות" autocomplete="username">
    <input type="password" name="password" placeholder="סיסמה">
    <button type="submit">כניסה</button>
  </form>`);

const OTP_FORM = page('אימות', `
  <h1>אימות בשני שלבים</h1>
  <p>שלחנו קוד לנייד שלך</p>
  <form method="POST" action="/otp">
    <input type="text" name="otp" autocomplete="one-time-code" maxlength="6" placeholder="קוד">
    <button type="submit">אישור</button>
  </form>`);

/*
 * עמוד ההטבות. הכרטיסים כאן מכסים את סוגי ההטבה שהמנוע מכיר, כדי
 * שהבדיקה תוודא שהסריקה מזהה את כולם ולא רק אחוזים.
 */
const BENEFITS = page('ההטבות שלי', `
  <nav>ראשי | ההטבות שלי</nav>
  <h1>ההטבות שלך</h1>
  <div class="card"><h3>פוקס</h3><p>20% הנחה על כל החנות בקנייה מעל 300 ₪</p></div>
  <div class="card"><h3>קסטרו</h3><p>1+1 על כל פריטי הקיץ</p></div>
  <div class="card"><h3>סופר פארם</h3><p>הנחה של 50 ₪ בקנייה מעל 200 ₪, בתוקף עד 31.12.2026</p></div>
  <div class="card"><h3>דלק</h3><p>10% החזר כספי על תדלוק, מוגבל ל-40 ₪ לחודש</p></div>
  <div class="card"><h3>מועדון</h3><p>נקודה על כל 4 ₪ בכל רכישה</p></div>
  <div class="card" style="display:none"><h3>מוסתר</h3><p>90% הנחה שלא אמורה להילכד</p></div>
  <footer>כל הזכויות שמורות | 100% שירות</footer>`);

const STATUS = page('המצב שלי', `
  <header>
    <span>שלום אריק</span>
    <div>יתרת הנקודות שלך: 1,240</div>
    <div>מעמד: זהב</div>
    <div>נותרו לך 3 הטבות החודש</div>
  </header>
  <div class="card"><h3>שופרסל</h3><p>12% הנחה על קניות מעל 250 ₪</p></div>`);

/* קטלוג ציבורי: אין התחברות, אין עוגייה, אין מצב אישי */
const PUBLIC = page('קטלוג', `
  <h1>הטבות המועדון</h1>
  <div class="card"><h3>מקדונלדס</h3><p>15% הנחה לחברי המועדון</p></div>
  <div class="card"><h3>יס פלנט</h3><p>1+1 על כרטיסי קולנוע</p></div>`);

function parseBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => resolve(Object.fromEntries(new URLSearchParams(raw))));
  });
}

const cookiesOf = (req) => Object.fromEntries(
  (req.headers.cookie || '').split(';')
    .map((c) => c.trim().split('='))
    .filter((p) => p[0]));

function createServer(options = {}) {
  const state = {
    otpCode: null,
    /* כמה פעמים נדרשה התחברות מלאה — כך הבדיקה מוכיחה שעוגייה חוסכת אותה */
    logins: 0,
    otpRequests: 0,
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    const cookies = cookiesOf(req);
    const send = (code, body, headers = {}) =>
      res.writeHead(code, Object.assign({ 'Content-Type': 'text/html; charset=utf-8' }, headers))
        .end(body);

    /* עמוד שנתקע: לבדיקת תקרת הזמן */
    if (p.startsWith('/hang')) return;   // בכוונה בלי תשובה

    if (p === '/testing/code') {
      return send(200, JSON.stringify(state), { 'Content-Type': 'application/json' });
    }

    if (p === '/public') return send(200, PUBLIC);

    /* קובצי ה-HTML הסטטיים שכבר שימשו לבדיקות התוסף */
    if (p.startsWith('/static/')) {
      const file = path.join(SITE, path.basename(p));
      if (fs.existsSync(file)) return send(200, fs.readFileSync(file));
      return send(404, 'not found');
    }

    if (p === '/login' && req.method === 'POST') {
      const body = await parseBody(req);
      if (body.user !== USER || body.password !== PASSWORD) {
        return send(200, page('כניסה', '<p>פרטים שגויים</p>' + LOGIN_FORM));
      }
      state.logins++;

      if (options.skipOtp) {
        return send(302, '', { 'Set-Cookie': 'sid=ok; Path=/', Location: '/benefits' });
      }
      state.otpCode = String(100000 + (state.logins * 7919) % 899999);
      state.otpRequests++;
      return send(302, '', { 'Set-Cookie': 'half=1; Path=/', Location: '/otp' });
    }

    if (p === '/otp' && req.method === 'POST') {
      const body = await parseBody(req);
      if (!cookies.half || body.otp !== state.otpCode) {
        return send(200, page('אימות', '<p>קוד שגוי</p>' + OTP_FORM));
      }
      return send(302, '', { 'Set-Cookie': 'sid=ok; Path=/; Max-Age=86400', Location: '/benefits' });
    }

    if (p === '/otp') return send(200, OTP_FORM);
    if (p === '/login') return send(200, LOGIN_FORM);

    /* מכאן והלאה — נדרשת עוגיית סשן */
    if (cookies.sid !== 'ok') return send(200, LOGIN_FORM);

    if (p === '/status') return send(200, STATUS);
    if (p === '/benefits' || p === '/') return send(200, BENEFITS);

    return send(404, page('לא נמצא', '<p>404</p>'));
  });

  return { server, state, USER, PASSWORD };
}

module.exports = { createServer, USER, PASSWORD };

/* הרצה עצמאית, שימושי לבדיקה ידנית */
if (require.main === module) {
  const { server } = createServer();
  server.listen(8777, () => console.log('http://localhost:8777/login'));
}
