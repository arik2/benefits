/*
 * capture.js — לכידת הטבות מעמוד שאתם כבר מחוברים אליו.
 *
 * למה זה קיים: אין דרך בטוחה או אפשרית שהמערכת תתחבר בעצמה למועדונים.
 * הם דורשים OTP, הדפדפן חוסם קריאה בין אתרים, ושמירת סיסמאות היא סיכון.
 * במקום זה, אתם מתחברים בעצמכם, והכלי הזה קורא את מה שכבר מוצג על המסך.
 *
 * הקוד רץ כבוקמרקלט בתוך העמוד של המועדון. הוא רק קורא ומעתיק ללוח —
 * הוא לא שולח שום דבר לשום מקום ולא נוגע בטפסים.
 *
 * הפונקציות שמנתחות טקסט מיוצאות בנפרד כדי שאפשר יהיה לבדוק אותן.
 */

(function (root) {
  'use strict';

  /* ---------- ניתוח טקסט ---------- */

  const FINALS = { 'ם': 'מ', 'ן': 'נ', 'ץ': 'צ', 'ף': 'פ', 'ך': 'כ' };
  const norm = (s) => String(s || '').replace(/[םןץףך]/g, (c) => FINALS[c]);

  /*
   * מזהה את סוג ההטבה ואת ערכה מתוך טקסט חופשי.
   * הסדר חשוב: 1+1 נבדק לפני אחוזים, אחרת "1+1 ב-50% הנחה" ייקרא כאחוזים.
   */
  function parseValue(rawText) {
    const text = norm(rawText);
    if (!text) return null;

    if (/1\s*\+\s*1|אחד\s*\+\s*אחד|שני[יה]?\s+חינ/.test(text)) {
      return { kind: 'bogo', value: 0 };
    }

    if (/נקוד/.test(text)) {
      const per = text.match(/נקודה?\s*(?:אחת\s*)?(?:על\s*כל|לכל|לכ)\s*(\d+(?:\.\d+)?)/);
      if (per) return { kind: 'points', value: parseFloat(per[1]) };
    }

    // כל הספרות נלקחות ולא רק שתיים, אחרת "150%" היה נקרא כ-"50%"
    const pct = text.match(/(\d+(?:\.\d+)?)\s*%/);
    if (pct) {
      const value = parseFloat(pct[1]);
      if (value > 0 && value <= 100) {
        const kind = /החזר|קאשבק|cashback|צביר/i.test(text) ? 'cashback' : 'percent';
        return { kind, value };
      }
    }

    const ils = text.match(/(?:הנחה\s*(?:של)?\s*|זיכוי\s*(?:של)?\s*|מתנה\s*(?:של)?\s*)(\d[\d,]*)\s*(?:₪|ש"?ח|שח)/)
      || text.match(/(\d[\d,]*)\s*(?:₪|ש"?ח|שח)\s*(?:הנחה|זיכוי|מתנה|החזר)/);
    if (ils) {
      const value = parseFloat(ils[1].replace(/,/g, ''));
      if (value > 0) return { kind: 'fixed', value };
    }

    return null;
  }

  /* מינימום קנייה, אם מוזכר */
  function parseMinSpend(rawText) {
    const text = norm(rawText);
    const m = text.match(/(?:מ-?|מעל|החל\s*מ-?|בקניי?ה?\s*(?:מעל|מ-?)|בסכום\s*(?:של)?\s*מעל)\s*(\d[\d,]*)\s*(?:₪|ש"?ח|שח)/);
    if (!m) return 0;
    const value = parseFloat(m[1].replace(/,/g, ''));
    return value > 0 ? value : 0;
  }

  /* תקרה לעסקה, אם מוזכרת */
  function parseCap(rawText) {
    const text = norm(rawText);
    const m = text.match(/(?:עד\s*(?:ל-?)?|מוגבל(?:ת|ים|ות)?\s*(?:ל-?)?|תקרה\s*(?:של)?\s*)(\d[\d,]*)\s*(?:₪|ש"?ח|שח)/);
    if (!m) return null;
    const value = parseFloat(m[1].replace(/,/g, ''));
    return value > 0 ? value : null;
  }

  /* תאריך תפוגה בפורמטים הנפוצים בעברית */
  function parseValidUntil(rawText) {
    const text = norm(rawText);
    const m = text.match(/(?:עד|בתוקף\s*עד|תקף\s*עד)\s*(?:ל-?|ה-?)?\s*(\d{1,2})[./](\d{1,2})[./](\d{2,4})/);
    if (!m) return null;
    let [, d, mo, y] = m;
    if (y.length === 2) y = '20' + y;
    const pad = (n) => String(n).padStart(2, '0');
    const iso = `${y}-${pad(mo)}-${pad(d)}`;
    return isNaN(new Date(iso + 'T00:00:00').getTime()) ? null : iso;
  }

  /* מנקה כותרת: רווחים כפולים, שורות, ואורך סביר */
  function cleanTitle(rawText, maxLen) {
    const limit = maxLen || 90;
    const text = String(rawText || '').replace(/\s+/g, ' ').trim();
    if (text.length <= limit) return text;
    const cut = text.slice(0, limit);
    const lastSpace = cut.lastIndexOf(' ');
    return (lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut) + '…';
  }

  /*
   * בונה מועמד מתוך טקסט של פריט בעמוד.
   * מחזיר null אם אין בטקסט שום ערך מספרי — כלומר זה כנראה לא הטבה.
   */
  function buildCandidate(text, extra) {
    const parsed = parseValue(text);
    if (!parsed) return null;

    const title = cleanTitle(text);
    if (title.length < 4) return null;

    return {
      title,
      kind: parsed.kind,
      value: parsed.value,
      minSpend: parseMinSpend(text),
      capPerTx: parseCap(text),
      validUntil: parseValidUntil(text),
      merchant: (extra && extra.merchant) || '',
      rawText: cleanTitle(text, 400),
    };
  }

  /*
   * מסיר כפילויות. אותה הטבה מופיעה בעמוד כמה פעמים (כרטיס, רשימה,
   * חלונית) ובלי זה הרשימה מתמלאת חזרות.
   */
  function dedupe(candidates) {
    const seen = new Map();
    for (const c of candidates) {
      const key = `${c.kind}|${c.value}|${cleanTitle(c.title, 45)}`;
      const existing = seen.get(key);
      // בין שתי גרסאות של אותה הטבה, שומרים את זו עם יותר הקשר
      if (!existing || (c.rawText || '').length > (existing.rawText || '').length) {
        seen.set(key, c);
      }
    }
    return Array.from(seen.values());
  }

  /* ---------- סריקת העמוד ---------- */

  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'HEAD', 'NAV', 'FOOTER']);

  /*
   * נראות נקבעת לפי סגנון מחושב של האלמנט ושל אבותיו.
   * לא לפי getBoundingClientRect: הוא מחזיר אפס גם לאלמנטים לגיטימיים
   * שטרם עברו פריסה, וזה היה מפיל הטבות אמיתיות.
   */
  function isVisible(el) {
    let node = el;
    while (node && node.nodeType === 1) {
      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      node = node.parentElement;
    }
    return true;
  }

  /*
   * שם בית העסק יושב לרוב לא בתוך הטקסט של ההטבה אלא לידו — בכותרת
   * הכרטיס או ב-alt של הלוגו. מטפסים למעלה, אבל רק כל עוד האב עדיין
   * "מדבר" על אותו פריט, אחרת נגרוף את הכותרת של כל העמוד.
   */
  function findMerchant(el) {
    const ownLength = ((el.textContent || '').trim()).length || 1;
    let node = el;

    for (let depth = 0; node && node.nodeType === 1 && depth < 4; depth++) {
      if ((node.textContent || '').trim().length > ownLength * 3 + 40) break;

      if (node.querySelector) {
        const img = node.querySelector('img[alt]');
        if (img && img.alt && img.alt.trim()) return img.alt.trim();

        const heading = node.querySelector('h1, h2, h3, h4');
        if (heading) {
          const text = (heading.textContent || '').replace(/\s+/g, ' ').trim();
          if (text && text.length <= 40 && !parseValue(text)) return text;
        }
      }
      node = node.parentElement;
    }
    return '';
  }

  /*
   * מחפש את היחידות הקטנות ביותר שמכילות ערך הטבה.
   * העדפה ליחידה קטנה: אלמנט גדול מדי גורר טקסט של כל העמוד לכותרת.
   */
  function scanDocument(doc) {
    const results = [];
    const all = doc.querySelectorAll('li, article, section, div, td, p, a, h2, h3, h4');

    for (const el of all) {
      if (SKIP_TAGS.has(el.tagName)) continue;

      const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length < 6 || text.length > 400) continue;
      if (!parseValue(text)) continue;

      // אם לצאצא יש את אותו ערך, הצאצא ספציפי יותר ונעדיף אותו
      const childHasSame = Array.from(el.children).some((child) => {
        const childText = (child.innerText || child.textContent || '').replace(/\s+/g, ' ').trim();
        return childText && childText.length >= 6 && parseValue(childText);
      });
      if (childHasSame) continue;

      if (!isVisible(el)) continue;

      const candidate = buildCandidate(text, { merchant: findMerchant(el) });
      if (candidate) results.push(candidate);
    }

    return dedupe(results);
  }

  /* ---------- שכבת האישור ---------- */

  function showOverlay(candidates, pageUrl) {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;';
    const shadow = host.attachShadow({ mode: 'open' });

    const rows = candidates.map((c, i) => `
      <label class="row">
        <input type="checkbox" data-i="${i}" checked>
        <span class="val">${c.kind === 'percent' || c.kind === 'cashback' ? c.value + '%'
          : c.kind === 'fixed' ? c.value + ' ₪'
          : c.kind === 'bogo' ? '1+1' : c.value}</span>
        <span class="ttl"></span>
      </label>`).join('');

    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .back { position:fixed; inset:0; background:rgba(15,23,42,.55); display:flex;
                align-items:center; justify-content:center; padding:16px;
                font-family:Arial,Helvetica,sans-serif; direction:rtl; }
        .box { background:#fff; color:#0f172a; border-radius:14px; width:min(560px,100%);
               max-height:82vh; display:flex; flex-direction:column; overflow:hidden;
               box-shadow:0 10px 40px rgba(0,0,0,.35); }
        .hd { padding:14px 16px; border-bottom:1px solid #e2e8f0; }
        .hd h2 { margin:0 0 3px; font-size:17px; }
        .hd p { margin:0; font-size:13px; color:#475569; }
        .list { overflow:auto; padding:8px 16px; flex:1; }
        .row { display:flex; gap:9px; align-items:flex-start; padding:9px 0;
               border-bottom:1px solid #f1f5f9; font-size:13px; cursor:pointer; }
        .row input { margin-top:3px; }
        .val { font-weight:700; color:#047857; white-space:nowrap; min-width:52px; }
        .ttl { color:#334155; line-height:1.45; }
        .ft { padding:12px 16px; border-top:1px solid #e2e8f0; display:flex; gap:8px; }
        button { flex:1; padding:11px; border-radius:9px; font-size:15px; font-weight:600;
                 font-family:inherit; cursor:pointer; border:1px solid #cbd5e1; background:#fff; }
        .primary { background:#1d4ed8; color:#fff; border-color:#1d4ed8; }
        .empty { padding:26px 16px; text-align:center; color:#475569; font-size:14px; }
      </style>
      <div class="back">
        <div class="box">
          <div class="hd">
            <h2>נמצאו ${candidates.length} הטבות אפשריות</h2>
            <p>סמנו מה לשמור. שום דבר לא נשלח לשום מקום — רק מועתק ללוח.</p>
          </div>
          <div class="list">${candidates.length ? rows : '<div class="empty">לא זוהו הטבות בעמוד הזה.<br>נסו לגלול כדי שכל ההטבות ייטענו, ואז ללחוץ שוב.</div>'}</div>
          <div class="ft">
            <button class="primary" id="copy">העתק ללוח</button>
            <button id="close">סגור</button>
          </div>
        </div>
      </div>`;

    // הכנסת הטקסט דרך textContent ולא כ-HTML, כדי שתוכן מהעמוד לא יורץ
    shadow.querySelectorAll('.ttl').forEach((node, i) => {
      node.textContent = candidates[i].title;
    });

    shadow.getElementById('close').onclick = () => host.remove();
    shadow.getElementById('copy').onclick = () => {
      const chosen = Array.from(shadow.querySelectorAll('input[data-i]'))
        .filter((cb) => cb.checked)
        .map((cb) => candidates[Number(cb.dataset.i)]);

      const payload = JSON.stringify({
        capturedFrom: pageUrl,
        capturedAt: new Date().toISOString().slice(0, 10),
        items: chosen,
      }, null, 2);

      const done = () => {
        shadow.getElementById('copy').textContent = `הועתקו ${chosen.length} הטבות ✓`;
        setTimeout(() => host.remove(), 1200);
      };

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(payload).then(done, () => fallbackCopy(payload, done));
      } else {
        fallbackCopy(payload, done);
      }
    };

    document.body.appendChild(host);
  }

  // דפדפנים חוסמים לפעמים כתיבה ללוח בהקשר של אתר אחר
  function fallbackCopy(text, onDone) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); onDone(); } catch (e) { window.prompt('העתיקו ידנית:', text); }
    ta.remove();
  }

  /* ---------- הפעלה ---------- */

  function run() {
    try {
      showOverlay(scanDocument(document), location.href);
    } catch (err) {
      alert('הלכידה נכשלה: ' + err.message);
    }
  }

  const api = {
    parseValue, parseMinSpend, parseCap, parseValidUntil,
    cleanTitle, buildCandidate, dedupe, scanDocument, findMerchant, isVisible, run,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.BenefitCapture = api; if (root.document) run(); }
})(typeof globalThis !== 'undefined' ? globalThis : this);
