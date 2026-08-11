/*
 * bot.js — לוגיקת הבוט. פונקציה טהורה: מקבלת עדכון טלגרם ומחזירה פעולות.
 *
 * אין כאן רשת, אין Supabase ואין טלגרם — הכל מוזרק דרך deps. זה מה
 * שמאפשר להריץ את כל הבדיקות מקומית, בלי לפרוס כלום ובלי חשבון.
 *
 * הבוט אינו מנוע שני: הוא עוטף את benefits/engine.js, אותו קוד שרץ
 * באתר ושכוסה ב-82 בדיקות. שאלה זהה חייבת להחזיר תשובה זהה בשניהם.
 */

/* ---------- עזרי פורמט לטלגרם ---------- */

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function formatPlan(plan, Engine) {
  if (!plan.rows.length) {
    return 'לא מצאתי הטבה מתאימה.\nנסו לנסח אחרת, למשל: <i>קנייה בפוקס ב-400 שקל</i>';
  }

  const lines = [];
  const p = plan.parsed;
  const bits = [];
  if (p.merchant) bits.push('🏬 ' + p.merchant);
  if (p.amount) bits.push(Engine.formatIls(p.amount));
  if (p.date) bits.push('📅 ' + Engine.formatDate(p.date.toISOString().slice(0, 10)));
  if (bits.length) lines.push('<i>הבנתי: ' + esc(bits.join(' · ')) + '</i>\n');

  if (plan.noAmount) {
    lines.push('💡 הוסיפו סכום ("ב-400 שקל") ואחשב כמה תחסכו בכל אפשרות.\n');
  }

  if (plan.primary) {
    const pr = plan.primary;
    lines.push(`<b>✅ הכי משתלם — חיסכון ~${esc(Engine.formatIls(pr.saving))}</b>`);
    lines.push(`${esc(pr.title)} <i>(${esc(pr.providerName)})</i>`);
    if (pr.steps.length) {
      lines.push('');
      pr.steps.forEach((s, i) => lines.push(`${i + 1}. ${esc(s)}`));
    }
    if (!pr.verified) {
      lines.push('\n⚠️ <i>הנתון מסומן "לאימות" — בדקו באתר המועדון לפני שסומכים עליו.</i>');
    }
  }

  if (plan.alternatives.length && plan.primary) {
    lines.push('\n<b>עוד אפשרויות:</b>');
    for (const a of plan.alternatives) {
      const v = a.saving != null
        ? `${a.isUpperBound ? 'עד ' : ''}${Engine.formatIls(a.saving)}`
        : a.savingLabel;
      lines.push(`• ${esc(a.title)} — ${esc(v)}`);
    }
  }

  return lines.join('\n');
}

/* כפתורי טלגרם לשאלת ההבהרה, במקום הצ'יפים שבאתר */
function choiceKeyboard(question, Engine) {
  return {
    inline_keyboard: question.choices.map((c) => [{
      text: `${c.label}${c.saving != null ? ' · ' + Engine.formatIls(c.saving) : ''}`,
      callback_data: `pick:${question.benefitId}:${c.id}`,
    }]),
  };
}

function formatStatus(status, providers, Engine, settings) {
  const ids = Object.keys(status || {});
  if (!ids.length) {
    return 'עוד לא נאסף מצב אישי.\nשלחו /סרוק כדי לעדכן מהמועדונים.';
  }

  const name = (id) => (providers.find((p) => p.id === id) || {}).name || id;
  const lines = ['<b>📊 המצב שלי</b>\n'];

  for (const id of ids) {
    const s = status[id];
    const bits = [];
    if (s.points != null) {
      const val = Engine.pointValueFor({ provider: id }, settings || {});
      const worth = val ? ` ≈ ${Engine.formatIls(s.points * val)}` : '';
      bits.push(`${Number(s.points).toLocaleString('he-IL')} ${s.points_unit || s.pointsUnit || 'נקודות'}${worth}`);
    }
    if (s.tier) bits.push(`דרגה: ${s.tier}`);
    const left = s.quota_left != null ? s.quota_left : s.quotaLeft;
    if (left != null) bits.push(`נותרו ${left}`);
    const bal = s.balance_ils != null ? s.balance_ils : s.balanceIls;
    if (bal != null) bits.push(`יתרה: ${Engine.formatIls(bal)}`);
    if (bits.length) lines.push(`<b>${esc(name(id))}</b>\n  ${esc(bits.join(' · '))}`);
  }

  return lines.join('\n');
}

const HELP = `<b>מה אפשר לשאול</b>

פשוט תכתבו בשפה חופשית:
• <i>קנייה בפוקס ב-400 שקל</i>
• <i>מקרר ב-4000</i>
• <i>מלון ביום שישי ב-2000</i>
• <i>הוצאות בחו"ל ב-5000</i>

<b>פקודות</b>
/status — כמה נקודות ואיזו דרגה בכל מועדון
/scan — לעדכן את ההטבות מהמועדונים
/help — ההודעה הזו`;

/* ---------- הלוגיקה הראשית ---------- */

/*
 * deps:
 *   db.isAllowed(chatId)      → boolean
 *   db.loadDb()               → { benefits, providers, categories, settings }
 *   db.loadStatus()           → { [provider]: {...} }
 *   db.pendingOtp()           → { id, club } | null
 *   db.answerOtp(id, code)    → void
 *   db.requestScrape()        → void
 *   db.lastQuery(chatId)      → string
 *   db.setLastQuery(chatId,s) → void
 *   engine                    → benefits/engine.js
 *   now                       → Date
 */
async function handleUpdate(update, deps) {
  const { db, engine: Engine } = deps;
  const now = deps.now || new Date();

  const cb = update.callback_query;
  const msg = update.message || (cb && cb.message);
  if (!msg) return [];

  const chatId = String(msg.chat.id);
  const text = (cb ? cb.data : (update.message && update.message.text) || '').trim();

  /*
   * בקרת גישה. משתמש לא מאושר מקבל את מזהה השיחה שלו בלבד — כך אריק
   * יכול להוסיף את אשתו בלי לנחש מספרים, ואדם זר שמצא את הבוט
   * לא מקבל שום נתון.
   */
  if (!(await db.isAllowed(chatId))) {
    return [{
      chatId,
      text: `אין לך הרשאה לבוט הזה.\n\nמזהה השיחה שלך: <code>${esc(chatId)}</code>`,
    }];
  }

  if (!text) return [];

  /*
   * בחירה בשאלת הבהרה. טלגרם מחזיר בכפתור רק את מה שנשלח בו, ו-64
   * בתים לא מספיקים לשאלה בעברית. לכן השאלה המקורית נשמרת באחסון
   * לפי מזהה שיחה, והכפתור נושא רק את הבחירה.
   */
  if (cb && text.startsWith('pick:')) {
    const [, benefitId, variantId] = text.split(':');
    const db2 = await db.loadDb();
    const previous = await db.lastQuery(chatId);
    if (!previous) {
      return [{
        chatId,
        answerCallback: cb.id,
        text: 'לא זכרתי את השאלה המקורית. תשאלו אותה שוב ואענה עם הבחירה.',
      }];
    }
    const parsed = Engine.parseQuery(db2, previous, now);
    const plan = Engine.composePlan(db2, parsed, now, { [benefitId]: variantId });
    return [{ chatId, text: formatPlan(plan, Engine), answerCallback: cb.id }];
  }

  // --- פקודות ---
  if (/^\/(start|help)/.test(text)) {
    return [{ chatId, text: HELP }];
  }

  if (/^\/status/.test(text) || /^המצב שלי$/.test(text)) {
    const db2 = await db.loadDb();
    const status = await db.loadStatus();
    return [{ chatId, text: formatStatus(status, db2.providers, Engine, db2.settings) }];
  }

  if (/^\/scan/.test(text) || /^סרוק$/.test(text)) {
    await db.requestScrape();
    return [{ chatId, text: '🔄 התחלתי סריקה של המועדונים.\nאם יידרש קוד אימות — אשלח לכם הודעה.' }];
  }

  /*
   * קוד OTP. מזוהה רק כשיש בקשה פתוחה, אחרת "123456" בשאלה רגילה
   * היה נבלע כקוד. זו הסיבה שהבדיקה על הבקשה קודמת לבדיקה על הטקסט.
   */
  const pending = await db.pendingOtp();
  if (pending && /^\d{4,8}$/.test(text)) {
    await db.answerOtp(pending.id, text);
    return [{ chatId, text: `✅ הקוד התקבל, ממשיך בהתחברות ל${pending.club}.` }];
  }

  // --- שאלה חופשית ---
  const database = await db.loadDb();
  const parsed = Engine.parseQuery(database, text, now);
  const plan = Engine.composePlan(database, parsed, now, {});

  const out = [{ chatId, text: formatPlan(plan, Engine) }];
  if (plan.question) {
    // נשמר כדי שלחיצה על כפתור תדע על מה נשאלה השאלה
    await db.setLastQuery(chatId, text);
    out.push({
      chatId,
      text: `יכול להיות משתלם יותר — עד ${Engine.formatIls(plan.question.upTo)}. מה מתאים לכם?`,
      keyboard: choiceKeyboard(plan.question, Engine),
    });
  }
  return out;
}

module.exports = { handleUpdate, formatPlan, formatStatus, choiceKeyboard, HELP };
