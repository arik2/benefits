/*
 * index.ts — נקודת הכניסה של הבוט ב-Supabase Edge Function.
 *
 * כל מה שיש כאן הוא חיבורים: קבלת webhook מטלגרם, בניית האחסון,
 * קריאה ל-handleUpdate ושליחת התשובות. אין כאן שום לוגיקה של הטבות —
 * היא כולה ב-bot.js וב-engine.js, ושם היא גם נבדקת.
 *
 * פריסה:
 *   node supabase/functions/bot/build.js
 *   supabase functions deploy bot --no-verify-jwt
 *
 * --no-verify-jwt נדרש כי טלגרם אינו יודע לשלוח JWT של Supabase.
 * במקומו האימות נעשה בכותרת הסוד של טלגרם, שנבדקת למטה.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Engine = require('./_vendor/engine.js');
const seed = require('./_vendor/benefits.json');
const { handleUpdate } = require('./bot.js');
const { createSupabaseDb, githubDispatch } = require('./db.js');

const env = (k: string) => Deno.env.get(k) || '';

const BOT_TOKEN = env('TELEGRAM_BOT_TOKEN');
const WEBHOOK_SECRET = env('TELEGRAM_WEBHOOK_SECRET');
const SUPABASE_URL = env('SUPABASE_URL');
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const GH_REPO = env('GITHUB_REPO');
const GH_TOKEN = env('GITHUB_TOKEN');

const api = (method: string) => `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;

async function tg(method: string, body: unknown) {
  const res = await fetch(api(method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    /*
     * מודפס שם השיטה והסטטוס בלבד. גוף התשובה של טלגרם מכיל את
     * ההודעה שנשלחה, וזו כבר עלולה להיות מידע אישי בלוג.
     */
    console.error(`telegram ${method} → ${res.status}`);
  }
  return res;
}

const db = createSupabaseDb({
  url: SUPABASE_URL,
  key: SERVICE_KEY,
  seed,
  dispatch: GH_REPO && GH_TOKEN
    ? githubDispatch({ repo: GH_REPO, token: GH_TOKEN })
    : null,
});

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('ok');

  /*
   * כתובת ה-Edge Function גלויה למי שמכיר אותה. הכותרת הזו היא מה
   * שמונע מזר לשלוח עדכון מזויף שנראה כאילו הגיע מאריק.
   */
  if (WEBHOOK_SECRET
      && req.headers.get('x-telegram-bot-api-secret-token') !== WEBHOOK_SECRET) {
    return new Response('forbidden', { status: 403 });
  }

  let update: Record<string, unknown>;
  try {
    update = await req.json();
  } catch {
    return new Response('bad request', { status: 400 });
  }

  let actions: Array<Record<string, unknown>> = [];
  try {
    actions = await handleUpdate(update, { db, engine: Engine, now: new Date() });
  } catch (err) {
    console.error('handleUpdate נכשל:', (err as Error).message);
    /*
     * מוחזר 200 בכוונה. טלגרם חוזר על עדכון שנכשל, ותקלה קבועה
     * הייתה הופכת ללולאה אינסופית של אותה הודעה.
     */
    const chat = (update as any)?.message?.chat?.id
      ?? (update as any)?.callback_query?.message?.chat?.id;
    if (chat) await tg('sendMessage', { chat_id: chat, text: 'משהו נשבר אצלי. נסו שוב בעוד רגע.' });
    return new Response('ok');
  }

  for (const a of actions) {
    if (a.answerCallback) {
      await tg('answerCallbackQuery', { callback_query_id: a.answerCallback });
    }
    if (a.text) {
      await tg('sendMessage', {
        chat_id: a.chatId,
        text: a.text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...(a.keyboard ? { reply_markup: a.keyboard } : {}),
      });
    }
  }

  return new Response('ok');
});
