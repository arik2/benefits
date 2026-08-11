/*
 * session.js — שמירת עוגיות ההתחברות, מוצפנות.
 *
 * העוגיות הן מה שמאפשר לרוב הסריקות לרוץ בלי סיסמה ובלי קוד. הן גם
 * שוות ערך להתחברות: מי שמחזיק בהן מחובר לחשבון. לכן הן לא נשמרות
 * כטקסט, גם לא במסד נתונים פרטי — Supabase הוא צד שלישי, והמפתח
 * שמפענח אותן חי רק בסודות של Actions.
 *
 * AES-256-GCM ולא CBC, כי GCM מזהה שינוי בתוכן. עוגייה שנפגמה או
 * שונתה תיפסל במפורש במקום להיטען חלקית ולייצר תקלה מבלבלת.
 */

const crypto = require('crypto');

const ALGO = 'aes-256-gcm';

/*
 * המפתח מגיע מסוד טקסטואלי. scrypt הופך אותו ל-32 בתים בצורה
 * שעמידה בפני ניחוש, כדי שסוד קצר לא ייתן מפתח חלש.
 */
function deriveKey(secret) {
  if (!secret || secret.length < 16) {
    throw new Error('SESSION_KEY חייב להיות באורך 16 תווים לפחות');
  }
  return crypto.scryptSync(secret, 'hatavot-session-v1', 32);
}

function encrypt(plainObject, secret) {
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(plainObject), 'utf8'),
    cipher.final(),
  ]);
  return {
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

function decrypt(payload, secret) {
  if (!payload || payload.v !== 1) throw new Error('מבנה עוגייה מוצפנת לא מוכר');
  const key = deriveKey(secret);
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  const out = Buffer.concat([
    decipher.update(Buffer.from(payload.data, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(out.toString('utf8'));
}

/*
 * חנות העוגיות מעל שכבת האחסון. פג התוקף נאכף גם אצלנו ולא רק
 * בדפדפן: עוגייה שפגה נחשבת ללא קיימת, כך שהמערכת עוברת להתחברות
 * מלאה במקום לנסות לסרוק עם זהות מתה ולהיכשל בשקל.
 */
function createSessionStore({ db, secret, now }) {
  const clock = now || (() => new Date());

  return {
    async load(clubId) {
      const row = await db.loadSession(clubId);
      if (!row) return null;

      if (row.expires_at && new Date(row.expires_at) <= clock()) return null;

      try {
        return decrypt(row.cookies, secret);
      } catch {
        /*
         * מפתח שהוחלף, או רשומה פגומה. עדיף להתעלם ולהתחבר מחדש
         * מאשר להפיל את כל הסריקה בגלל מועדון אחד.
         */
        return null;
      }
    },

    async save(clubId, cookies) {
      /*
       * תוקף הרשומה נגזר מהעוגייה המוקדמת ביותר שיש לה תוקף.
       * עוגיות סשן (בלי expires) מקבלות תקרה של שבועיים, שהיא
       * ניחוש שמרני מספיק כדי לא לבזבז סריקה על זהות שפגה.
       */
      const stamps = cookies
        .map((c) => c.expires)
        .filter((e) => typeof e === 'number' && e > 0)
        .map((e) => e * 1000);

      const fallback = clock().getTime() + 14 * 24 * 60 * 60 * 1000;
      const expiresAt = new Date(stamps.length ? Math.min(...stamps, fallback) : fallback);

      await db.saveSession(clubId, encrypt(cookies, secret), expiresAt.toISOString());
      return expiresAt;
    },
  };
}

module.exports = { encrypt, decrypt, deriveKey, createSessionStore };
