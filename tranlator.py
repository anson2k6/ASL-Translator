import cv2
import mediapipe as mp
import numpy as np
import pickle
from collections import deque
from tensorflow.keras.models import load_model

SEQUENCE_LENGTH = 30
GESTURE_CONF_THRESHOLD = 0.5
LETTER_STABLE_THRESHOLD = 15
MOTION_THRESHOLD = 0.015 
COOLDOWN_FRAMES = 30

with open("asl_letter_model.pkl", "rb") as f:
    letter_clf = pickle.load(f)

gesture_model = load_model("gesture_model.h5")
with open("gesture_labels.txt") as f:
    gestures = [line.strip() for line in f if line.strip()]

mp_hands = mp.solutions.hands
mp_draw = mp.solutions.drawing_utils
hands = mp_hands.Hands(static_image_mode=False, max_num_hands=1,
                        min_detection_confidence=0.7)


def extract_landmarks(hand_landmarks):
    coords = [(lm.x, lm.y, lm.z) for lm in hand_landmarks.landmark]
    wrist = coords[0]
    rel = [(x - wrist[0], y - wrist[1], z - wrist[2]) for x, y, z in coords]
    max_val = max(max(abs(x), abs(y), abs(z)) for x, y, z in rel) or 1e-6
    return [v / max_val for point in rel for v in point]


def motion_amount(prev_landmarks, curr_landmarks):
    if prev_landmarks is None:
        return 0.0
    diffs = [abs(a - b) for a, b in zip(prev_landmarks, curr_landmarks)]
    return sum(diffs) / len(diffs)


gesture_buffer = deque(maxlen=SEQUENCE_LENGTH)
letter_pred_buffer = deque(maxlen=10)
prev_landmarks = None

detected_text = []
last_letter = None
letter_stable_count = 0
gesture_cooldown = 0

current_mode = "LETTER"
still_streak = 0
moving_streak = 0
SWITCH_FRAMES = 5  # consecutive moving frames needed to ENTER gesture mode
EXIT_STILL_FRAMES = 25  # consecutive still frames needed to LEAVE gesture mode (longer, so a 30-frame gesture has room to complete)

cap = cv2.VideoCapture(0)
print("Starting combined recognition... Q to quit, C to clear text")

while True:
    ret, frame = cap.read()
    if not ret:
        break
    frame = cv2.flip(frame, 1)
    h, w, _ = frame.shape
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    result = hands.process(rgb)

    mode_label = ""
    display_pred = None

    if result.multi_hand_landmarks:
        for hand_landmarks in result.multi_hand_landmarks:
            mp_draw.draw_landmarks(frame, hand_landmarks, mp_hands.HAND_CONNECTIONS)
            curr_landmarks = extract_landmarks(hand_landmarks)

            moving = motion_amount(prev_landmarks, curr_landmarks) > MOTION_THRESHOLD
            print(f"motion={motion_amount(prev_landmarks, curr_landmarks):.4f} moving={moving} mode={current_mode}")
            prev_landmarks = curr_landmarks
            gesture_buffer.append(curr_landmarks)

            if moving:
                moving_streak += 1
                still_streak = 0
            else:
                still_streak += 1
                moving_streak = 0

            if current_mode == "LETTER" and moving_streak >= SWITCH_FRAMES:
                current_mode = "GESTURE"
                gesture_buffer.clear()
                gesture_buffer.append(curr_landmarks)
            elif current_mode == "GESTURE" and still_streak >= EXIT_STILL_FRAMES and gesture_cooldown == 0:
                current_mode = "LETTER"
                letter_pred_buffer.clear()
                letter_stable_count = 0

            if current_mode == "GESTURE" or gesture_cooldown > 0:
                # --- GESTURE MODE ---
                mode_label = "GESTURE"

                if len(gesture_buffer) == SEQUENCE_LENGTH and gesture_cooldown == 0:
                    input_seq = np.expand_dims(np.array(gesture_buffer), axis=0)
                    probs = gesture_model.predict(input_seq, verbose=0)[0]
                    best_idx = int(np.argmax(probs))
                    conf = float(probs[best_idx])
                    if conf >= GESTURE_CONF_THRESHOLD:
                        display_pred = f"{gestures[best_idx]} ({conf:.0%})"
                        detected_text.append(gestures[best_idx])
                        gesture_cooldown = COOLDOWN_FRAMES

                if gesture_cooldown > 0:
                    gesture_cooldown -= 1
                    if gesture_cooldown == 0:
                        current_mode = "LETTER"
                        gesture_buffer.clear()

            else:
                # --- LETTER MODE ---
                mode_label = "LETTER"

                pred = letter_clf.predict([curr_landmarks])[0]
                proba = letter_clf.predict_proba([curr_landmarks])[0].max()
                letter_pred_buffer.append(pred)
                smoothed = max(set(letter_pred_buffer), key=letter_pred_buffer.count)
                display_pred = f"{smoothed} ({proba:.0%})"

                if smoothed == last_letter:
                    letter_stable_count += 1
                    if letter_stable_count == LETTER_STABLE_THRESHOLD:
                        detected_text.append(smoothed)
                else:
                    last_letter = smoothed
                    letter_stable_count = 0
    else:
        prev_landmarks = None
        gesture_buffer.clear()
        letter_pred_buffer.clear()
        letter_stable_count = 0

    if display_pred:
        cv2.putText(frame, f"[{mode_label}] {display_pred}", (10, 90),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 255, 0), 2)

    text_display = " ".join(detected_text[-10:])
    cv2.rectangle(frame, (0, h - 60), (w, h), (0, 0, 0), -1)
    cv2.putText(frame, text_display, (10, h - 20),
                cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
    cv2.putText(frame, "Q: Quit | C: Clear text", (10, 30),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)

    cv2.imshow("ASL Letters + Gestures", frame)

    key = cv2.waitKey(1) & 0xFF
    if key == ord('q'):
        break
    elif key == ord('c'):
        detected_text.clear()

cap.release()
cv2.destroyAllWindows()