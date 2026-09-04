// inject_camera_overlay.js
// Runs in the main page world on meet.google.com to intercept navigator.mediaDevices.getUserMedia
// and burn real-time ASL subtitles directly onto the user's outgoing camera stream.

(function() {
  if (window.__ASL_CAMERA_INTERCEPTED__) return;
  window.__ASL_CAMERA_INTERCEPTED__ = true;

  let currentSubtitles = "";
  let currentLiveLetter = "";
  let lastTextTime = 0;

  let audioCtx = null;
  let audioDestination = null;
  let microphoneSourceNode = null;

  async function speakIntoMicrophone(text) {
    if (!text || !text.trim()) return;
    const cleanText = text.trim();

    // 1. Try playing real decoded speech audio directly into the microphone stream
    let streamedAudioSuccess = false;
    if (audioCtx && audioDestination) {
      try {
        if (audioCtx.state === "suspended") {
          await audioCtx.resume();
        }
        // Fetch audio stream from Google TTS endpoint
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(cleanText)}&tl=en&client=tw-ob`;
        const response = await fetch(ttsUrl);
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
          
          const source = audioCtx.createBufferSource();
          source.buffer = audioBuffer;
          
          // Connect to the outgoing microphone destination (sent over WebRTC to other call participants)
          source.connect(audioDestination);
          // Also connect to local output so the user hears it too
          source.connect(audioCtx.destination);
          
          source.start();
          streamedAudioSuccess = true;
        }
      } catch (err) {
        console.warn("Direct stream TTS pipe fallback:", err);
      }
    }

    // 2. Fallback to standard SpeechSynthesis if Web Audio pipe was unavailable
    if (!streamedAudioSuccess && ('speechSynthesis' in window)) {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(cleanText);
      utter.rate = 1.0;
      utter.pitch = 1.0;
      window.speechSynthesis.speak(utter);
    }
  }

  window.addEventListener("message", (event) => {
    if (event.data?.type === "ASL_CAMERA_SUBTITLE_UPDATE") {
      currentSubtitles = (event.data.text || "").trim();
      currentLiveLetter = (event.data.liveLetter || "").trim();
      if (currentSubtitles || currentLiveLetter) {
        lastTextTime = Date.now();
      }
    } else if (event.data?.type === "SPEAK_INTO_CALL") {
      speakIntoMicrophone(event.data.text);
    }
  });

  const origGetUserMedia = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
  if (!origGetUserMedia) return;

  function createSubtitledStream(rawStream) {
    const videoTrack = rawStream.getVideoTracks()[0];
    const audioTrack = rawStream.getAudioTracks()[0];
    let outputAudioTrack = audioTrack;

    // Mix outgoing audio with Web Audio API so synthesis can play through the mic
    if (audioTrack && window.AudioContext) {
      try {
        if (!audioCtx || audioCtx.state === "closed") {
          audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        audioDestination = audioCtx.createMediaStreamDestination();
        microphoneSourceNode = audioCtx.createMediaStreamSource(new MediaStream([audioTrack]));
        microphoneSourceNode.connect(audioDestination);
        outputAudioTrack = audioDestination.stream.getAudioTracks()[0];
      } catch (e) {
        console.warn("Audio mixing fallback:", e);
        outputAudioTrack = audioTrack;
      }
    }

    if (!videoTrack) {
      return new MediaStream(outputAudioTrack ? [outputAudioTrack] : []);
    }

    const offscreenVideo = document.createElement("video");
    offscreenVideo.autoplay = true;
    offscreenVideo.playsInline = true;
    offscreenVideo.muted = true;
    offscreenVideo.srcObject = new MediaStream([videoTrack]);
    offscreenVideo.play().catch(() => {});

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    let streamWidth = videoTrack.getSettings?.()?.width || 1280;
    let streamHeight = videoTrack.getSettings?.()?.height || 720;
    canvas.width = streamWidth;
    canvas.height = streamHeight;

    offscreenVideo.onloadedmetadata = () => {
      streamWidth = offscreenVideo.videoWidth || streamWidth;
      streamHeight = offscreenVideo.videoHeight || streamHeight;
      canvas.width = streamWidth;
      canvas.height = streamHeight;
    };

    let animId = null;

    function renderLoop() {
      if (offscreenVideo.readyState >= 2 && offscreenVideo.videoWidth > 0) {
        if (canvas.width !== offscreenVideo.videoWidth) {
          canvas.width = offscreenVideo.videoWidth;
          canvas.height = offscreenVideo.videoHeight;
        }

        // Draw original camera frame
        ctx.drawImage(offscreenVideo, 0, 0, canvas.width, canvas.height);

        // Render subtitles if active (within last 8 seconds of signing)
        const hasRecentText = Date.now() - lastTextTime < 8000;
        if ((currentSubtitles || currentLiveLetter) && hasRecentText) {
          const w = canvas.width;
          const h = canvas.height;
          const displayText = currentSubtitles + (currentLiveLetter ? (currentSubtitles ? " " : "") + currentLiveLetter : "");

          const fontSize = Math.max(24, Math.round(h * 0.048));
          ctx.font = `bold ${fontSize}px system-ui, -apple-system, sans-serif`;

          const tagText = "🤟 ASL ";
          const tagWidth = ctx.measureText(tagText).width;
          const textWidth = ctx.measureText(displayText).width;
          const totalWidth = tagWidth + textWidth + 40;

          const bannerWidth = Math.min(w * 0.85, totalWidth);
          const bannerHeight = fontSize * 1.8;
          const bannerX = (w - bannerWidth) / 2;
          const bannerY = h - bannerHeight - Math.round(h * 0.06);
          const radius = bannerHeight / 2;

          // Draw pill background with border
          ctx.save();
          ctx.beginPath();
          ctx.roundRect(bannerX, bannerY, bannerWidth, bannerHeight, radius);
          ctx.fillStyle = "rgba(10, 10, 10, 0.85)";
          ctx.fill();
          ctx.lineWidth = 3;
          ctx.strokeStyle = "rgba(61, 220, 132, 0.9)";
          ctx.stroke();

          // Draw ASL badge
          ctx.textBaseline = "middle";
          ctx.fillStyle = "#3ddc84";
          ctx.fillText(tagText, bannerX + 20, bannerY + bannerHeight / 2);

          // Draw text
          ctx.fillStyle = "#ffffff";
          ctx.fillText(displayText, bannerX + 20 + tagWidth, bannerY + bannerHeight / 2, bannerWidth - tagWidth - 35);
          ctx.restore();
        }
      }
      animId = requestAnimationFrame(renderLoop);
    }

    renderLoop();

    const canvasStream = canvas.captureStream(30);
    const modifiedVideoTrack = canvasStream.getVideoTracks()[0];

    // Clean up when original track stops
    videoTrack.addEventListener("ended", () => {
      if (animId) cancelAnimationFrame(animId);
      offscreenVideo.srcObject = null;
      modifiedVideoTrack.stop();
    });

    const combinedTracks = [modifiedVideoTrack];
    if (outputAudioTrack) combinedTracks.push(outputAudioTrack);
    return new MediaStream(combinedTracks);
  }

  navigator.mediaDevices.getUserMedia = async function(constraints) {
    const stream = await origGetUserMedia(constraints);
    if (constraints && (constraints.video || constraints.audio)) {
      try {
        return createSubtitledStream(stream);
      } catch (e) {
        console.warn("Failed to attach ASL stream wrappers:", e);
        return stream;
      }
    }
    return stream;
  };

  console.log("ASL Live Camera Subtitles: stream interceptor active.");
})();
