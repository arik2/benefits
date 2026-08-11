/*
 * מעתיק את המנוע ואת המטא-דאטה אל תוך תיקיית הפונקציה.
 *
 * למה בכלל להעתיק: supabase functions deploy אורז את תיקיית הפונקציה,
 * והסתמכות על ../../../benefits/ היא סוג התלות שנשברת בפריסה ולא
 * בבדיקות. עדיף עותק מפורש שאפשר לאמת שהוא מעודכן.
 *
 * זה אותו דפוס שכבר קיים ב-benefits/extension/build.js, כולל שורת
 * הכותרת שמונעת מאדם לערוך את העותק בטעות.
 *
 * הרצה:  node supabase/functions/bot/build.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const VENDOR = path.join(__dirname, '_vendor');

const BANNER = '/* קובץ מיוצר. אל תערכו אותו — ערכו את המקור והריצו '
  + 'node supabase/functions/bot/build.js */\n';

const COPIES = [
  { from: path.join(ROOT, 'benefits', 'engine.js'), to: path.join(VENDOR, 'engine.js'), banner: true },
  { from: path.join(ROOT, 'benefits', 'data', 'benefits.json'), to: path.join(VENDOR, 'benefits.json'), banner: false },
];

fs.mkdirSync(VENDOR, { recursive: true });

for (const c of COPIES) {
  const source = fs.readFileSync(c.from, 'utf8');
  // JSON לא סובל הערות, ולכן הכותרת מתווספת רק לקוד
  fs.writeFileSync(c.to, c.banner ? BANNER + source : source);
  console.log(`${path.relative(ROOT, c.from)} → ${path.relative(ROOT, c.to)}`);
}
