import pickle
import os
from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit
import math
import time

PROCESS_INTERVAL = 0.05  # 100ms = 10 FPS
last_processed_time = {}

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*")

model_dict = pickle.load(open('model.p', 'rb'))
model = model_dict['model']

@app.route('/')
def index():
    return render_template('index.html')

@socketio.on('process_landmarks')
def handle_landmarks(data):
    sid = request.sid
    now = time.time()

    if sid not in last_processed_time:
        last_processed_time[sid] = 0

    if now - last_processed_time[sid] < PROCESS_INTERVAL:
        return

    last_processed_time[sid] = now

    landmarks = data.get('landmarks')
    
    if not landmarks:
        return

    try:
        wrist = landmarks[0]
        middleFinger = landmarks[9]
        
        dist = math.sqrt((middleFinger['x'] - wrist['x'])**2 + 
                         (middleFinger['y'] - wrist['y'])**2 + 
                         (middleFinger['z'] - wrist['z'])**2)
        
        if dist < 1e-7:
            dist = 0.0001
            
        thumb = landmarks[4]
        pointer = landmarks[8]
        thumb_to_pointer_dist = math.sqrt((thumb['x'] - pointer['x'])**2 + 
                                          (thumb['y'] - pointer['y'])**2 + 
                                          (thumb['z'] - pointer['z'])**2)
        
        normalized = [thumb_to_pointer_dist]
        
        for lm in landmarks:
            new_x = lm['x'] - wrist['x']
            new_y = lm['y'] - wrist['y']
            new_z = lm['z'] - wrist['z']
            
            normalized.append(new_x / dist)
            normalized.append(new_y / dist)
            normalized.append(new_z / dist)
            
        # ------------------------------------------------
            
        probabilities = model.predict_proba([normalized])[0]
        confidence = max(probabilities) * 100
        raw_gesture = model.predict([normalized])[0].strip()

 
        all_landmarks = [
            {"x": round(1.0 - lm['x'], 4), "y": round(lm['y'], 4)}
            for lm in landmarks
        ]
        
        index_finger = landmarks[8]

        packet = {
            "gesture": raw_gesture,
            "confidence": round(confidence, 1),
            "x": 1.0 - index_finger['x'], # mirror x over
            "y": index_finger['y'],
            "is_detected": True,
            "landmarks": all_landmarks
        }
        
        emit('predicted_results', packet)
        
    except Exception as e:
        print(f"Prediction Error: {e}")
    
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    socketio.run(app, host='0.0.0.0', port=port, allow_unsafe_werkzeug=True)