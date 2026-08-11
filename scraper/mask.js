/*
 * mask.js — מיסוך סודות בכל דבר שנכתב ללוג.
 *
 * ריצת Actions שנכשלת מדפיסה הרבה: הודעות שגיאה של Playwright, גופי
 * בקשות, כתובות עם פרמטרים. סיסמה שדולפת לשם היא הדליפה הכי קלה
 * לפספס, כי הלוג נראה כמו רעש טכני ואיש לא קורא אותו עד הסוף.
 *
 * GitHub ממסך בעצמו ערכי Secrets, אבל רק בהתאמה מדויקת. סיסמה שעברה
 * encodeURIComponent בתוך כתובת, או כזו שנכנסה ל-JSON עם תווי בריחה,
 * חומקת משם. לכן המיסוך כאן מכסה גם את הצורות האלה.
 *
 * הכלל: כל פלט עובר כאן, ולא רק פלט שנראה מסוכן.
 */

const REDACTED = '***';

/*
 * סוד קצר מדי היה ממסך חצי מהלוג. שש הוא הרף שמתחת אליו ערך אינו
 * מזוהה מספיק כדי להיות שווה מיסוך — וממילא אין סיסמאות כאלה.
 * היוצא מן הכלל הוא קוד ה-OTP, שנמסך בנפרד לפי דפוס ולא לפי ערך.
 */
const MIN_SECRET_LENGTH = 6;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/*
 * הצורות שבהן אותו סוד עלול להופיע בלוג. כל אחת מהן נראתה בפועל
 * בכלים כאלה: הערך עצמו, בתוך כתובת, בתוך JSON, ובקידוד base64
 * (כותרת Authorization מסוג Basic).
 */
function variantsOf(secret) {
  const out = new Set([secret]);
  try { out.add(encodeURIComponent(secret)); } catch { /* ערך לא חוקי */ }
  try { out.add(JSON.stringify(secret).slice(1, -1)); } catch { /* ערך לא חוקי */ }
  try { out.add(Buffer.from(secret, 'utf8').toString('base64')); } catch { /* ערך לא חוקי */ }
  // Basic auth הוא user:pass מקודד, ולכן גם הסיומת בלבד עלולה להופיע
  return [...out].filter((v) => v && v.length >= MIN_SECRET_LENGTH);
}

/*
 * secrets: מערך של מחרוזות, או אובייקט שערכיו הם הסודות.
 */
function createMasker(secrets) {
  const values = Array.isArray(secrets)
    ? secrets
    : Object.values(secrets || {});

  const patterns = [];
  for (const raw of values) {
    if (typeof raw !== 'string' || raw.length < MIN_SECRET_LENGTH) continue;
    for (const v of variantsOf(raw)) patterns.push(new RegExp(escapeRe(v), 'g'));
  }

  /*
   * קוד ה-OTP אינו ידוע מראש ולכן אינו יכול להיכנס לרשימה. הוא נמסך
   * לפי הקשר: רצף ספרות שמופיע ליד מילה שמעידה על קוד.
   */
  const OTP_CONTEXT = /((?:קוד|code|otp|sms|אימות)\D{0,20})(\d{4,8})/gi;

  function mask(input) {
    if (input == null) return input;
    let text = typeof input === 'string' ? input : safeStringify(input);
    for (const re of patterns) text = text.replace(re, REDACTED);
    text = text.replace(OTP_CONTEXT, (_m, ctx) => ctx + REDACTED);
    return text;
  }

  /*
   * מחזיר console חלופי. לא מחליף את הגלובלי — קוד שמחליף את console
   * מאחורי הגב של הקורא הוא קוד שקשה לבדוק ולנפות.
   */
  function maskedConsole(target) {
    const base = target || console;
    const wrap = (fn) => (...args) => fn(...args.map(mask));
    return {
      log: wrap(base.log.bind(base)),
      info: wrap(base.info.bind(base)),
      warn: wrap(base.warn.bind(base)),
      error: wrap(base.error.bind(base)),
    };
  }

  return { mask, maskedConsole, count: patterns.length };
}

/*
 * שגיאות של Playwright נושאות הודעה, מחסנית ולפעמים גם את גוף
 * הבקשה. JSON.stringify רגיל מחזיר {} על Error ומאבד בדיוק את מה
 * שצריך למסך, ולכן הן מטופלות במפורש.
 */
function safeStringify(value) {
  if (value instanceof Error) {
    return [value.message, value.stack].filter(Boolean).join('\n');
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

module.exports = { createMasker, REDACTED, MIN_SECRET_LENGTH };
