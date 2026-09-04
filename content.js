// content.js — Runs inside Google Meet.
// The detector UI is loaded as an extension-origin iframe so camera access is
// requested from a persistent page instead of the short-lived toolbar popup.

let aslFrame = null;
let liveSubtitleBanner = null;

function getOrCreateSubtitleBanner() {
  if (liveSubtitleBanner && document.contains(liveSubtitleBanner)) {
    return liveSubtitleBanner;
  }
  liveSubtitleBanner = document.createElement("div");
  liveSubtitleBanner.id = "asl-meet-live-subtitles";
  Object.assign(liveSubtitleBanner.style, {
    position: "fixed",
    bottom: "85px",
    left: "50%",
    transform: "translateX(-50%)",
    background: "rgba(10, 10, 10, 0.88)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    color: "#ffffff",
    padding: "10px 24px",
    borderRadius: "30px",
    fontSize: "18px",
    fontWeight: "600",
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    zIndex: "2147483646",
    boxShadow: "0 6px 24px rgba(0,0,0,0.5), 0 0 0 1px rgba(61, 220, 132, 0.4)",
    display: "none",
    alignItems: "center",
    gap: "12px",
    maxWidth: "80vw",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    transition: "all 0.2s ease-in-out",
    pointerEvents: "none"
  });

  liveSubtitleBanner.innerHTML = `
    <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:#3ddc84; box-shadow:0 0 8px #3ddc84; flex-shrink:0;"></span>
    <span style="color:#3ddc84; font-size:13px; font-weight:700; text-transform:uppercase; letter-spacing:1px;">ASL</span>
    <span id="asl-subtitles-text" style="color:#f0fdf4; font-size:17px;">...</span>
  `;

  document.documentElement.appendChild(liveSubtitleBanner);
  return liveSubtitleBanner;
}

function updateLiveSubtitles(text, liveLetter) {
  const banner = getOrCreateSubtitleBanner();
  const textEl = banner.querySelector("#asl-subtitles-text");
  if (!textEl) return;

  const fullText = (text || "").trim();
  const currentLetter = liveLetter ? `<span style="color:#3ddc84; border-bottom:2px solid #3ddc84; margin-left:4px;">${liveLetter}</span>` : "";

  if (!fullText && !liveLetter) {
    banner.style.display = "none";
    return;
  }

  banner.style.display = "flex";
  textEl.innerHTML = (fullText ? fullText : "") + currentLetter;
}

function toggleASLPanel() {
  if (aslFrame) {
    aslFrame.remove();
    aslFrame = null;
    if (liveSubtitleBanner) liveSubtitleBanner.style.display = "none";
    return;
  }

  aslFrame = document.createElement("iframe");
  aslFrame.id = "asl-meet-assistant-frame";
  aslFrame.src = chrome.runtime.getURL("popup.html?embedded=1");
  aslFrame.allow = "camera; microphone; clipboard-write; language-model";
  aslFrame.title = "ASL Meet Assistant";
  Object.assign(aslFrame.style, {
    position: "fixed",
    top: "16px",
    right: "16px",
    width: "400px",
    height: "720px",
    border: "0",
    borderRadius: "12px",
    zIndex: "2147483647",
    background: "#0d0d0d",
    boxShadow: "0 8px 35px rgba(0,0,0,.55)"
  });

  aslFrame.addEventListener("load", () => {
    try { aslFrame.contentWindow?.postMessage({ type: "ASL_IFRAME_READY" }, "*"); } catch (_) {}
  });

  document.documentElement.appendChild(aslFrame);
}

async function sendTextToMeetChat(messageText) {
  if (!messageText || !messageText.trim()) return false;
  const textToSend = `[ASL]: ${messageText.trim()}`;

  // 1. Locate chat input textarea
  let chatTextarea = document.querySelector('textarea[name="chatTextInput"], textarea[aria-label*="Send a message"], textarea[aria-label*="chat"]');

  // 2. If chat is not open, click the Google Meet chat button to open the panel
  if (!chatTextarea) {
    const chatToggleButtons = Array.from(document.querySelectorAll('button[aria-label*="Chat"], button[aria-label*="chat"], button[data-panel-id="2"]'));
    for (const btn of chatToggleButtons) {
      btn.click();
      break;
    }
    // Wait a brief moment for Meet chat side-panel to mount
    await new Promise(r => setTimeout(r, 400));
    chatTextarea = document.querySelector('textarea[name="chatTextInput"], textarea[aria-label*="Send a message"], textarea[aria-label*="chat"]');
  }

  if (!chatTextarea) {
    console.warn("Could not find Google Meet chat textarea.");
    return false;
  }

  // 3. Set text into the textarea and dispatch input events for Google Meet's internal React/Angular state
  chatTextarea.focus();
  chatTextarea.value = textToSend;
  chatTextarea.dispatchEvent(new Event("input", { bubbles: true }));
  chatTextarea.dispatchEvent(new Event("change", { bubbles: true }));

  await new Promise(r => setTimeout(r, 100));

  // 4. Click the Meet send button or send Enter
  const sendBtn = chatTextarea.closest("form, div[role='region'], div")?.querySelector('button[aria-label*="Send"], button[aria-label*="send"]')
               || document.querySelector('button[aria-label*="Send a message to everyone"], button[aria-label*="Send message"]');
  
  if (sendBtn && !sendBtn.disabled) {
    sendBtn.click();
  } else {
    chatTextarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
  }

  return true;
}

window.addEventListener("message", async (event) => {
  if (event.source === aslFrame?.contentWindow) {
    if (event.data?.type === "CLOSE_ASL_PANEL") {
      aslFrame.remove();
      aslFrame = null;
      if (liveSubtitleBanner) liveSubtitleBanner.style.display = "none";
    } else if (event.data?.type === "UPDATE_ASL_TEXT") {
      updateLiveSubtitles(event.data.text, event.data.liveLetter);
      // Relay to the camera stream interceptor running in the main world
      window.postMessage({
        type: "ASL_CAMERA_SUBTITLE_UPDATE",
        text: event.data.text,
        liveLetter: event.data.liveLetter
      }, "*");
    } else if (event.data?.type === "SEND_TO_MEET_CHAT") {
      const ok = await sendTextToMeetChat(event.data.text);
      try {
        aslFrame?.contentWindow?.postMessage({ type: "MEET_CHAT_SENT", success: ok }, "*");
      } catch (_) {}
    } else if (event.data?.type === "SPEAK_INTO_CALL") {
      window.postMessage({
        type: "SPEAK_INTO_CALL",
        text: event.data.text
      }, "*");
    }
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "TOGGLE_ASL_PANEL") toggleASLPanel();
});

chrome.runtime.sendMessage({ type: "ON_MEET", url: window.location.href });
