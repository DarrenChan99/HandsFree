import pickle
import cv2 as cv
from main import Hand_Detector
import base64
from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit
import numpy as np
import os

model_dict = pickle.load(open('model.p', 'rb'))
model = model_dict['model']

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*")

user_detectors = {}

INFERENCE_W, INFERENCE_H = 320, 240

@socketio.on('connect')
def handle_connect():
    user_detectors[request.sid] = Hand_Detector(max_num_hands=1)

@socketio.on('disconnect')
def handle_disconnect():
    if request.sid in user_detectors:
        del user_detectors[request.sid]

@app.route('/')
def index():
    return render_template('index.html')

@socketio.on('video_frame')
def handle_frame(data):
    try:
        header, encoded = data.split(",", 1)
        numpyArr = np.frombuffer(base64.b64decode(encoded), np.uint8)
        frame = cv.imdecode(numpyArr, cv.IMREAD_COLOR)

        if frame is None:
            return
        
    except Exception:
        return

    detector = user_detectors.get(request.sid)
    if not detector:
        return

    lower_res = cv.resize(frame, (INFERENCE_W, INFERENCE_H))
    detector.find_hands(lower_res)
    hand_data = detector.getNormalizedLandmarks()

    packet = {"gestore" : "None", "confidence" : 0, "x" : 0, "y" : 0}

    if hand_data:
        probabilities = model.predict_proba([hand_data[0]])[0]
        confidence = max(probabilities) * 100
        raw_gesture = model.predict([hand_data[0]])[0].strip()


        if detector.results and detector.results.multi_hand_landmarks:
            landmarks = detector.results.multi_hand_landmarks[0]
            index = landmarks.landmark[8]

            # Extract all 21 landmarks and mirror the X coordinate
            lm_list = [{"x": 1.0 - lm.x, "y": lm.y} for lm in landmarks.landmark]

            packet.update({
                "gesture" : raw_gesture,
                "confidence" : round(confidence, 1),
                "x" : 1.0 - index.x,
                "y" : index.y,
                "landmarks" : lm_list, # Pass the full skeleton array
                "is_detected": True
            })

    emit('predicted_results', packet)
    
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    socketio.run(app, host='0.0.0.0', port=port, allow_unsafe_werkzeug=True)