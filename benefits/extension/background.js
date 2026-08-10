/*
 * Service worker מינימלי. קיים משתי סיבות:
 * 1. מציג ספירה על אייקון התוסף אחרי סריקה מוצלחת.
 * 2. נותן לתוסף זהות יציבה שקל לאתר בבדיקות אוטומטיות.
 */
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.type === 'captured-count' && sender.tab) {
    chrome.action.setBadgeText({ tabId: sender.tab.id, text: String(msg.count || '') });
    chrome.action.setBadgeBackgroundColor({ color: '#1d4ed8' });
  }
});
