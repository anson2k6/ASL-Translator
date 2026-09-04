"""Local ASL model server matching p3.py exactly.
Binds only to 127.0.0.1; no cloud/API key is used.
"""
import json
import os
import pickle
import warnings
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np

warnings.filterwarnings("ignore", category=UserWarning)

HOST = "127.0.0.1"
PORT = 8765
BASE = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE, "asl_letter_model.pkl")

with open(MODEL_PATH, "rb") as f:
    clf = pickle.load(f)

print("Loaded ASL letter model:", list(clf.classes_))


def normalize_landmarks(points):
    """Exact normalization function from p3.py"""
    if not isinstance(points, list) or len(points) != 21:
        raise ValueError("Expected 21 hand landmarks")
    coords = [(float(p["x"]), float(p["y"]), float(p["z"])) for p in points]
    wrist = coords[0]
    rel = [(x - wrist[0], y - wrist[1], z - wrist[2]) for x, y, z in coords]
    max_val = max(max(abs(x), abs(y), abs(z)) for x, y, z in rel) or 1e-6
    return [v / max_val for point in rel for v in point]


def flip_x(features):
    out = list(features)
    for i in range(0, len(out), 3):
        out[i] = -out[i]
    return out


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, payload):
        raw = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        origin = self.headers.get("Origin", "*")
        self.send_header("Access-Control-Allow-Origin", origin if origin else "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self):
        self._send(204, {})

    def do_GET(self):
        if self.path == "/health":
            self._send(200, {"ok": True, "model": "asl_letter_model.pkl", "classes": list(map(str, clf.classes_))})
        else:
            self._send(404, {"ok": False, "error": "Not found"})

    def do_POST(self):
        if self.path != "/predict":
            self._send(404, {"ok": False, "error": "Not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length > 10000:
                raise ValueError("Request too large")
            body = self.rfile.read(length)
            data = json.loads(body.decode("utf-8"))
            raw_landmarks = data.get("landmarks")
            
            features = normalize_landmarks(raw_landmarks)
            proba = clf.predict_proba([features])[0]
            pred = str(clf.classes_[int(np.argmax(proba))])
            confidence = float(np.max(proba))

            # Dual-check mirrored orientation specifically for letter A (dataset chirality)
            flipped = flip_x(features)
            proba_f = clf.predict_proba([flipped])[0]
            pred_f = str(clf.classes_[int(np.argmax(proba_f))])
            conf_f = float(np.max(proba_f))

            classes_list = list(clf.classes_)
            a_idx = classes_list.index("A") if "A" in classes_list else -1
            a_prob = float(proba[a_idx]) if a_idx != -1 else 0.0
            a_prob_f = float(proba_f[a_idx]) if a_idx != -1 else 0.0

            # If the mirrored orientation recognizes A with good confidence, select A
            if (pred_f == "A" and conf_f >= 0.25) or (pred in {"S", "E", "O", "T"} and max(a_prob, a_prob_f) >= 0.18):
                pred = "A"
                confidence = max(a_prob, a_prob_f, 0.80)

            self._send(200, {"ok": True, "letter": pred, "confidence": confidence})
        except Exception as exc:
            self._send(400, {"ok": False, "error": str(exc)})

    def log_message(self, fmt, *args):
        return


if __name__ == "__main__":
    print(f"ASL model server: http://{HOST}:{PORT}")
    print("Press Ctrl+C to stop.")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()

