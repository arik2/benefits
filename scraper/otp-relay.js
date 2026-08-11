/*
 * otp-relay.js — הגשר בין הסורק לאריק.
 *
 * הסורק מגיע לשלב הקוד, כותב בקשה, ואריק עונה בטלגרם. זה מה שמאפשר
 * אוטומציה מול אתרים שדורשים קוד חד-פעמי: לא עוקפים את הקוד, רק
 * מעבירים אותו. אוטומציה בלי אדם בלולאה באמת נשברת כאן; עם אדם
 * בלולאה היא עובדת, ובמחיר של הודעה אחת בערך פעם בחודש.
 *
 * ההודעה לטלגרם נשלחת מהסורק ולא מהבוט, כי לסורק ממילא יש את הטוקן
 * ואין טעם בקפיצה נוספת דרך Supabase.
 */

const DEFAULT_TIMEOUT_MS = 4 * 60 * 1000;   // ארבע דקות להוציא טלפון מהכיס
const DEFAULT_POLL_MS = 3000;

/*
 * deps:
 *   db.requestOtp(club) → { id }
 *   db.readOtp(id)      → { status, code }
 *   notify(club, id)    → שולח הודעה בטלגרם (אופציונלי)
 *   sleep(ms)           → מוזרק כדי שהבדיקות לא ימתינו באמת
 *   now()               → Date
 */
function createOtpRelay({ db, notify, sleep, now, timeoutMs, pollMs, log } = {}) {
  const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const clock = now || (() => new Date());
  const limit = timeoutMs || DEFAULT_TIMEOUT_MS;
  const step = pollMs || DEFAULT_POLL_MS;
  const out = log || console;

  return async function requestCode(clubName) {
    const req = await db.requestOtp(clubName);
    if (!req || !req.id) throw new Error('לא ניתן היה לפתוח בקשת קוד');

    if (notify) {
      await notify(clubName, req.id);
    } else {
      out.log(`[${clubName}] נפתחה בקשת קוד ${req.id}, אך אין ערוץ להודיע עליה`);
    }

    const started = clock().getTime();

    for (;;) {
      const current = await db.readOtp(req.id);

      if (current && current.status === 'answered' && current.code) {
        out.log(`[${clubName}] הקוד התקבל`);
        return current.code;
      }

      /*
       * ביטול יזום. בלי זה, ריצה שאריק כבר לא רוצה הייתה ממשיכה
       * להמתין עד סוף הפסק זמן ולשרוף דקות Actions.
       */
      if (current && current.status === 'cancelled') {
        throw new Error(`[${clubName}] בקשת הקוד בוטלה`);
      }

      if (clock().getTime() - started >= limit) {
        await markExpired(db, req.id);
        throw new Error(
          `[${clubName}] לא התקבל קוד תוך ${Math.round(limit / 60000)} דקות`);
      }

      await wait(step);
    }
  };
}

/*
 * בקשה שפג זמנה חייבת להיסגר. אחרת היא נשארת "pending", והבוט יפרש
 * את המספר הבא שאריק ישלח — גם בשאלה רגילה — כקוד לריצה שכבר מתה.
 */
async function markExpired(db, id) {
  if (db.expireOtp) {
    await db.expireOtp(id);
  } else if (db.answerOtp) {
    await db.answerOtp(id, null);
  }
}

/*
 * שליחת ההודעה בטלגרם. מופרד כדי שהממסר עצמו יהיה נבדק בלי רשת.
 */
function telegramNotifier({ token, chatIds, fetch: doFetch }) {
  const f = doFetch || globalThis.fetch;
  return async (clubName) => {
    for (const chatId of chatIds) {
      await f(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: `🔐 ${clubName} מבקש קוד אימות.\nשלחו לי כאן את הקוד שהגיע ב-SMS.`,
        }),
      });
    }
  };
}

module.exports = {
  createOtpRelay,
  telegramNotifier,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_POLL_MS,
};
