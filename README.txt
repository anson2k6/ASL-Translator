ASL MEET ASSISTANT - FIXED AI SETUP

IMPORTANT FIX:
The previous package was missing MediaPipe's local hand landmark TFLite asset.
That caused Chrome's MediaPipe hands.js to show:
    Uncaught (in promise) TypeError: Failed to fetch
at mediapipe/hands.js line 78.

This package uses MediaPipe Hands locally for landmark extraction and the
supplied asl_letter_model.pkl for ASL letter classification.

FIRST RUN:
1. Extract this ZIP to a normal folder.
2. Double-click setup_ai_detector.bat.
3. Allow the one-time MediaPipe hand model download.
4. When setup says complete, double-click start_ai_detector.bat.
5. Keep the black server window open.
6. In Chrome, reload the unpacked extension at chrome://extensions.
7. Open Google Meet and open ASL Meet Assistant.

MODEL SERVER:
http://127.0.0.1:8765/health

Expected health response contains:
"ok": true
and the ASL classes A through Y.

PRIVACY:
The classifier server binds only to 127.0.0.1. No cloud AI API key is used
for ASL detection. Camera frames are processed locally by MediaPipe and are
sent only to the local Python process on the same computer.

SPEED:
The browser uses MediaPipe Hands lite model (modelComplexity 0) to reduce
latency. The supplied trained RandomForest classifier remains the classifier.
