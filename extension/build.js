/*
 * מעתיק את capture.js מתיקיית benefits אל תיקיית התוסף.
 *
 * למה צריך את זה: דפדפן טוען content scripts רק מתוך תיקיית התוסף
 * עצמה, ולכן חייבת להיות שם עותק. כדי שלא יהיו שתי גרסאות שמתרחקות
 * זו מזו, העותק לא נערך ידנית לעולם — עורכים רק את benefits/capture.js
 * ומריצים:  node benefits/extension/build.js
 */
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'capture.js');
const dst = path.join(__dirname, 'capture.js');

const banner = '/* קובץ מיוצר — לא לערוך. המקור: benefits/capture.js ; עדכון: node benefits/extension/build.js */\n';
fs.writeFileSync(dst, banner + fs.readFileSync(src, 'utf8'));
console.log('הועתק:', path.relative(process.cwd(), dst));
