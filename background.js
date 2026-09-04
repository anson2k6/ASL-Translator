// background.js — Service worker
// Opens/closes the ASL detector panel inside Google Meet.

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id || !tab.url?.startsWith("https://meet.google.com/")) {
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_ASL_PANEL" });
  } catch (e) {
    console.warn("ASL panel could not be toggled:", e);
  }
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "ON_MEET" && sender.tab?.id) {
    chrome.action.setBadgeText({ text: "●", tabId: sender.tab.id });
    chrome.action.setBadgeBackgroundColor({ color: "#3ddc84", tabId: sender.tab.id });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.action.setBadgeText({ text: "", tabId }).catch(() => {});
});
