// ─────────────────────────────────────────────────────────────────────────────
// popup.js — ASL detection engine
// MediaPipe Hands + rule-based classifier + smoothing + Chrome Storage
// ─────────────────────────────────────────────────────────────────────────────

const video         = document.getElementById("video");
const canvas        = document.getElementById("canvas");
const ctx           = canvas.getContext("2d");
const letterEl      = document.getElementById("detected-letter");
const confEl        = document.getElementById("confidence");
const textEl        = document.getElementById("accumulated-text");
const statusEl      = document.getElementById("status-dot");
const camStatusEl   = document.getElementById("camera-status");
const signsCountEl  = document.getElementById("session-count");
const streakEl      = document.getElementById("streak-display");
const sessionTimeEl = document.getElementById("session-time");
const closePanelBtn = document.getElementById("close-panel-btn");

if (closePanelBtn) {
  closePanelBtn.addEventListener("click", () => {
    // Ask the parent Meet page to remove this iframe.
    window.parent.postMessage({ type: "CLOSE_ASL_PANEL" }, "*");
  });
}



// ── State ────────────────────────────────────────────────────────────────────
let accText       = [];
let predBuf       = [];
let lastDetected  = null;
let holdStart     = 0;
let committedThisHold = false;
let signsThisSession = 0;
let sessionStart  = Date.now();

const BUFFER_SIZE      = 4;          // Tight buffer for instant prediction response
const MIN_CONFIDENCE   = 0.15;       // Accept valid letter predictions without delay

// ── Extension/Meet panel state ───────────────────────────────────────────────
// This page is embedded inside Google Meet by content.js. It no longer depends
// on the short-lived Chrome action popup, which caused camera DOMExceptions.
statusEl.textContent = "● Live on Meet";
statusEl.className = "live";
document.getElementById("not-meet-warning").style.display = "none";
document.getElementById("main-content").style.display = "block";

// Start only after the iframe has loaded and the media element is ready.
startCamera();

// ── Load saved text from last session ────────────────────────────────────────
chrome.storage.local.get(["lastText", "streak", "totalSigns"], (r) => {
  if (r.lastText) {
    accText  = r.lastText.split(" ").filter(Boolean);
    textEl.textContent = accText.join(" ") || "Start signing...";
  }
  streakEl.textContent = `Streak: ${r.streak || 0}d`;
});

// ── Model-backed ASL detection ───────────────────────────────────────────────
// The browser still does ONLY hand landmark extraction. The supplied trained
// RandomForest model performs the actual letter classification in the local
// Python process, using the exact preprocessing from p3.py.
const MODEL_SERVER = "http://127.0.0.1:8765";
let modelBusy = false;
let lastModelTime = 0;
const MODEL_INTERVAL_MS = 90; // ~11 checks/sec: perfectly smooth for ASL while saving ~75% CPU

function landmarksForModel(lm) {
  // In p3.py, cv2.flip(frame, 1) mirrors the video horizontally before MediaPipe processes it.
  // In JavaScript MediaPipe, the raw webcam is not flipped before landmark extraction.
  // We flip the x coordinate (1 - p.x) so it identically matches p3.py's input features.
  return lm.map(p => ({ x: Number(1 - p.x), y: Number(p.y), z: Number(p.z) }));
}

async function predictWithSuppliedModel(lm) {
  const now = performance.now();
  if (modelBusy || now - lastModelTime < MODEL_INTERVAL_MS) return;
  modelBusy = true;
  lastModelTime = now;
  try {
    const response = await fetch(`${MODEL_SERVER}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ landmarks: landmarksForModel(lm) })
    });
    if (!response.ok) throw new Error(`Model server HTTP ${response.status}`);
    const result = await response.json();
    if (!result.ok) throw new Error(result.error || "Prediction failed");
    const letter = String(result.letter);
    const conf = Number(result.confidence) || 0;
    
    if (conf < MIN_CONFIDENCE) return;

    predBuf.push(letter);
    if (predBuf.length > BUFFER_SIZE) predBuf.shift();
    const freq = {};
    predBuf.forEach(x => freq[x] = (freq[x] || 0) + 1);
    const smoothed = Object.keys(freq).reduce((a, b) => freq[a] > freq[b] ? a : b);
    
    letterEl.textContent = smoothed;
    confEl.textContent = `Confidence: ${Math.round(conf * 100)}%`;
    camStatusEl.textContent = "AI model detection ✓";

    // Broadcast current live letter to on-screen banner
    try {
      window.parent.postMessage({
        type: "UPDATE_ASL_TEXT",
        text: accText.slice(-15).join(" "),
        liveLetter: smoothed
      }, "*");
    } catch (_) {}

    if (smoothed !== lastDetected) {
      lastDetected = smoothed;
      stableCount = 1;
      committedThisHold = false;
    } else {
      stableCount++;
      // Commit quickly once sign is held for ~3 consecutive frames (~0.25s)
      if (!committedThisHold && stableCount >= 3) {
        accText.push(smoothed);
        signsThisSession++;
        signsCountEl.textContent = `Signs: ${signsThisSession}`;
        textEl.textContent = accText.slice(-25).join(" ");
        chrome.storage.local.set({ lastText: accText.join(" "), totalSigns: signsThisSession });
        committedThisHold = true;
        
        // Broadcast newly committed text
        try {
          window.parent.postMessage({
            type: "UPDATE_ASL_TEXT",
            text: accText.slice(-15).join(" "),
            liveLetter: ""
          }, "*");
        } catch (_) {}
      }
    }
  } catch (err) {
    console.error("Prediction error:", err);
    camStatusEl.textContent = "AI detector unavailable — run start_ai_detector.bat";
  } finally {
    modelBusy = false;
  }
}

// ── MediaPipe setup: landmarks only; classification is NOT rule-based ────────
const hands = new Hands({
  locateFile: f => chrome.runtime.getURL(`mediapipe/${f}`)
});

hands.setOptions({
  maxNumHands: 1,
  modelComplexity: 0,
  minDetectionConfidence: 0.7,
  minTrackingConfidence: 0.7
});

hands.onResults((results) => {
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (results.multiHandLandmarks?.length > 0) {
    const lm = results.multiHandLandmarks[0];
    drawConnectors(ctx, lm, HAND_CONNECTIONS, { color: "#3ddc84", lineWidth: 2 });
    drawLandmarks(ctx, lm, { color: "#ffffff", lineWidth: 1, radius: 3 });
    predictWithSuppliedModel(lm);
  } else {
    letterEl.textContent = "—";
    confEl.textContent = "Confidence: —";
    camStatusEl.textContent = "Show your hand...";
    predBuf = [];
    stableCount = 0;
    lastDetected = null;
  }
});

async function checkModelServer() {
  try {
    const r = await fetch(`${MODEL_SERVER}/health`, { cache: "no-store" });
    if (!r.ok) throw new Error();
    const data = await r.json();
    camStatusEl.textContent = `Model ready ✓ (${data.classes.length} letters)`;
  } catch {
    camStatusEl.textContent = "AI detector unavailable — run start_ai_detector.bat";
  }
}
checkModelServer();

// ── Start camera ──────────────────────────────────────────────────────────────
async function startCamera() {
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Camera API is not available in this context.");
    }

    camStatusEl.textContent = "Requesting camera permission...";

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        width: { ideal: 380 },
        height: { ideal: 210 },
        facingMode: "user"
      }
    });

    video.srcObject = stream;
    await video.play();
    camStatusEl.textContent = "Camera ready ✓";

    let processingFrame = false;
    let lastFrameTime = 0;
    const FRAME_INTERVAL_MS = 50; // Cap MediaPipe processing to max ~20 FPS for smooth performance

    const camera = new Camera(video, {
      onFrame: async () => {
        const now = performance.now();
        if (processingFrame || now - lastFrameTime < FRAME_INTERVAL_MS) return;
        processingFrame = true;
        lastFrameTime = now;
        try {
          await hands.send({ image: video });
        } catch (e) {
          // ignore transient frame drop errors
        } finally {
          processingFrame = false;
        }
      },
      width: 320,
      height: 180
    });
    camera.start();

    // Stop the hardware camera cleanly when the Meet panel is removed.
    window.addEventListener("pagehide", () => {
      stream.getTracks().forEach(track => track.stop());
    }, { once: true });
  } catch (err) {
    const name = err?.name || "CameraError";
    const message = err?.message || "Unable to access the camera.";
    console.error("Camera error:", name, message);

    if (name === "NotAllowedError" || name === "SecurityError") {
      camStatusEl.textContent = "Camera permission denied — allow camera for this site.";
    } else if (name === "NotReadableError" || name === "TrackStartError") {
      camStatusEl.textContent = "Camera is busy. Close other camera apps and try again.";
    } else if (name === "NotFoundError") {
      camStatusEl.textContent = "No camera found.";
    } else {
      camStatusEl.textContent = "Camera error — check Chrome camera permissions.";
    }
  }
}

// ── Session timer ─────────────────────────────────────────────────────────────
setInterval(() => {
  const secs = Math.floor((Date.now() - sessionStart) / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  sessionTimeEl.textContent = `${m}:${s.toString().padStart(2, "0")}`;
}, 1000);


// ── AI + speech assistance ─────────────────────────────────────────────────────
window.getASLText = () => accText.join("").replace(/\s+/g, " ").trim();

function speakASLText() {
  const text = window.getASLText();
  if (!text) {
    camStatusEl.textContent = "No detected text to speak";
    return;
  }
  
  // 1. Trigger speech through the call microphone
  try {
    window.parent.postMessage({ type: "SPEAK_INTO_CALL", text }, "*");
  } catch (_) {}

  // 2. Local speech playback
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    utterance.pitch = 1;
    utterance.onstart = () => { camStatusEl.textContent = "Speaking into call… 🔊"; };
    utterance.onend = () => { camStatusEl.textContent = "Camera ready ✓"; };
    window.speechSynthesis.speak(utterance);
  } else {
    camStatusEl.textContent = "Speaking into call… 🔊";
    setTimeout(() => { camStatusEl.textContent = "Camera ready ✓"; }, 1500);
  }
}

async function aiFixASLText() {
  const text = window.getASLText();
  if (!text) { camStatusEl.textContent = "No detected text for AI"; return; }
  const btn = document.getElementById("ai-fix-btn");
  btn.disabled = true;
  btn.textContent = "✨ AI…";
  try {
    if (typeof window.askASLAI !== "function") throw new Error("AI module not ready");
    const corrected = (await window.askASLAI(text)).trim();
    if (corrected) {
      accText = corrected.split(/\s+/).filter(Boolean);
      textEl.textContent = corrected;
      chrome.storage.local.set({ lastText: corrected });
    }
    camStatusEl.textContent = "AI correction complete ✓";
  } catch (err) {
    console.warn("[AI Fix] failed:", err?.name || "Error");
    camStatusEl.textContent = "AI unavailable — original text kept";
  } finally {
    btn.disabled = false;
    btn.textContent = "✨ AI Fix";
  }
}

document.getElementById("speak-btn").addEventListener("click", speakASLText);
document.getElementById("ai-fix-btn").addEventListener("click", aiFixASLText);

// ── Buttons ───────────────────────────────────────────────────────────────────
const sendChatBtn = document.getElementById("send-chat-btn");
if (sendChatBtn) {
  sendChatBtn.addEventListener("click", () => {
    const text = accText.join(" ").trim();
    if (!text) {
      camStatusEl.textContent = "No detected text to send to chat";
      return;
    }
    sendChatBtn.disabled = true;
    sendChatBtn.textContent = "⏳ Sending…";
    window.parent.postMessage({ type: "SEND_TO_MEET_CHAT", text }, "*");
  });
}

window.addEventListener("message", (event) => {
  if (event.data?.type === "MEET_CHAT_SENT") {
    if (sendChatBtn) {
      sendChatBtn.disabled = false;
      if (event.data.success) {
        sendChatBtn.textContent = "✓ Sent to Chat!";
        camStatusEl.textContent = "Sent message to Meet chat ✓";
        setTimeout(() => { sendChatBtn.textContent = "💬 Send to Meet Chat"; }, 2000);
      } else {
        sendChatBtn.textContent = "⚠️ Chat unavailable";
        setTimeout(() => { sendChatBtn.textContent = "💬 Send to Meet Chat"; }, 2000);
      }
    }
  }
});

document.getElementById("clear-btn").addEventListener("click", () => {
  accText = [];
  textEl.textContent = "Start signing...";
  chrome.storage.local.set({ lastText: "" });
  try {
    window.parent.postMessage({ type: "UPDATE_ASL_TEXT", text: "", liveLetter: "" }, "*");
  } catch (_) {}
});

document.getElementById("copy-btn").addEventListener("click", () => {
  const text = accText.join(" ");
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById("copy-btn");
    btn.textContent = "✓ Copied!";
    setTimeout(() => btn.textContent = "📋 Copy", 1500);
  });
});

document.getElementById("space-btn").addEventListener("click", () => {
  accText.push(" ");
  textEl.textContent = accText.join("").trim();
  try {
    window.parent.postMessage({ type: "UPDATE_ASL_TEXT", text: accText.slice(-15).join(" "), liveLetter: "" }, "*");
  } catch (_) {}
});
