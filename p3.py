"""
Step 3: Live ASL letter recognition
--------------------------------------
Uses MediaPipe to extract hand landmarks, then the trained RandomForest
classifier to predict the letter. No YOLO, no image cropping - just
keypoints in, letter out. Q to quit, C to clear text.
"""

import cv2
import mediapipe as mp
import pickle
from collections import deque

with open("asl_letter_model.pkl", "rb") as f:
    clf = pickle.load(f)

mp_hands = mp.solutions.hands
mp_draw = mp.solutions.drawing_utils
hands = mp_hands.Hands(static_image_mode=False, max_num_hands=1,
                        min_detection_confidence=0.7)


def normalize_landmarks(hand_landmarks):
    coords = [(lm.x, lm.y, lm.z) for lm in hand_landmarks.landmark]
    wrist = coords[0]
    rel = [(x - wrist[0], y - wrist[1], z - wrist[2]) for x, y, z in coords]
    max_val = max(max(abs(x), abs(y), abs(z)) for x, y, z in rel) or 1e-6
    norm = [v / max_val for point in rel for v in point]
    return norm


prediction_buffer = deque(maxlen=10)
detected_text = []
last_detected = None
stable_count = 0
STABLE_THRESHOLD = 15

cap = cv2.VideoCapture(0)
print("Starting... Press Q to quit, C to clear text")

while True:
    ret, frame = cap.read()
    if not ret:
        break
    frame = cv2.flip(frame, 1)
    h, w, _ = frame.shape
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    result = hands.process(rgb)

    current_detection = None

    if result.multi_hand_landmarks:
        for hand_landmarks in result.multi_hand_landmarks:
            mp_draw.draw_landmarks(frame, hand_landmarks, mp_hands.HAND_CONNECTIONS)
            features = normalize_landmarks(hand_landmarks)
            pred = clf.predict([features])[0]
            proba = clf.predict_proba([features])[0].max()

            prediction_buffer.append(pred)
            smoothed = max(set(prediction_buffer), key=prediction_buffer.count)
            current_detection = smoothed

            x_coords = [lm.x * w for lm in hand_landmarks.landmark]
            y_coords = [lm.y * h for lm in hand_landmarks.landmark]
            x1, y1 = int(min(x_coords)) - 20, int(min(y_coords)) - 20
            label = f"{smoothed} {proba:.0%}"
            cv2.putText(frame, label, (max(0, x1), max(30, y1)),
                        cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 255, 0), 2)

    if current_detection:
        if current_detection == last_detected:
            stable_count += 1
            if stable_count == STABLE_THRESHOLD:
                detected_text.append(current_detection)
        else:
            last_detected = current_detection
            stable_count = 0
    else:
        stable_count = 0

    text_display = " ".join(detected_text[-10:])
    cv2.rectangle(frame, (0, h - 60), (w, h), (0, 0, 0), -1)
    cv2.putText(frame, text_display, (10, h - 20),
                cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
    cv2.putText(frame, "Q: Quit | C: Clear text", (10, 30),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)

    cv2.imshow("ASL Letters (landmark model)", frame)

    key = cv2.waitKey(1) & 0xFF
    if key == ord('q'):
        break
    elif key == ord('c'):
        detected_text.clear()

cap.release()
cv2.destroyAllWindows()