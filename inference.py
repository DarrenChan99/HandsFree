import pickle
import cv2 as cv
import numpy as np
from main import Hand_Detector, annotate
import pyautogui
from collections import deque
import threading
import queue
import time

model_dict = pickle.load(open('model.p', 'rb'))
model = model_dict['model']

def clamp(v, lo, hi):
    return max(lo, min(hi, v))

def capture_thread(cap, frame_queue, stop_event):
    while not stop_event.is_set():
        success, frame = cap.read()
        if not success:
            continue
        if not frame_queue.full():
            frame_queue.put(frame)

def main():
    cap = cv.VideoCapture(0)
    detector = Hand_Detector()
    screen_width, screen_height = pyautogui.size()

    edge_margin_px = 5
    alpha = 0.35
    smoothed_x, smoothed_y = None, None
    scroll_interval = 3
    gesture_cooldown = 0
    gesture_cooldown_threshold = 10
    INFERENCE_W, INFERENCE_H = 320, 240

    lastGestures = deque(maxlen=7)

    frame_queue = queue.Queue(maxsize=1)
    stop_event = threading.Event()

    cap_thread = threading.Thread(target=capture_thread, args=(cap, frame_queue, stop_event), daemon=True)
    cap_thread.start()

    prev_time = 0
    fps = 0
    frame_counter = 0
    skip_frame_interval = 1 # unused currently
    gesture = None
    confidence = 0

    while True:
        try:
            frame = frame_queue.get(timeout=1.0)
        except queue.Empty:
            continue

        curr_time = time.time()
        fps = 1 / (curr_time - prev_time)
        prev_time = curr_time

        lower_res = cv.resize(frame, (INFERENCE_W, INFERENCE_H))
        detector.find_hands(lower_res)
        hand_data = detector.getNormalizedLandmarks()

        if detector.results and detector.results.multi_hand_landmarks:
            for handLms in detector.results.multi_hand_landmarks:
                detector.mp_draw.draw_landmarks(frame, handLms, detector.mp_hands.HAND_CONNECTIONS)

        frame = cv.flip(frame, 1)

        if gesture_cooldown > 0:
            gesture_cooldown -= 1

        frame_counter += 1
        if frame_counter % skip_frame_interval == 0:
            if hand_data:
                prediction = model.predict([hand_data[0]])
                raw_gesture = prediction[0].strip()

                probabilities = model.predict_proba([hand_data[0]])[0]
                confidence = max(probabilities) * 100

                lastGestures.append(raw_gesture)

                gesture_count = {}
                for g in lastGestures:
                    gesture_count[g] = gesture_count.get(g, 0) + 1
                gesture = max(gesture_count, key=gesture_count.get)

                if detector.results and detector.results.multi_hand_landmarks:
                    for handLms in detector.results.multi_hand_landmarks:
                        indexFinger = handLms.landmark[8]

                        x = clamp(1.0 - indexFinger.x, 0.0, 1.0)
                        y = clamp(indexFinger.y, 0.0, 1.0)

                        target_x = int(x * (screen_width - 1))
                        target_y = int(y * (screen_height - 1))

                        target_x = clamp(target_x, edge_margin_px, screen_width - 1 - edge_margin_px)
                        target_y = clamp(target_y, edge_margin_px, screen_height - 1 - edge_margin_px)

                        if smoothed_x is None:
                            smoothed_x, smoothed_y = target_x, target_y
                        else:
                            smoothed_x = int(alpha * target_x + (1 - alpha) * smoothed_x)
                            smoothed_y = int(alpha * target_y + (1 - alpha) * smoothed_y)

                        if gesture == "Cursor":
                            pyautogui.moveTo(smoothed_x, smoothed_y, _pause=False)

                # ACTIONS -----------------
                if gesture_cooldown == 0:
                    if gesture == "Pinch":
                        pyautogui.leftClick()
                        gesture_cooldown = gesture_cooldown_threshold

                    elif gesture == "Scroll_Up":
                        pyautogui.scroll(scroll_interval)
                        gesture_cooldown = gesture_cooldown_threshold

                    elif gesture == "Scroll_Down":
                        pyautogui.scroll(-scroll_interval)
                        gesture_cooldown = gesture_cooldown_threshold
                #  -----------------

        if gesture:
            confidence_color = (0, 255, 0) if confidence > 80 else (0, 165, 255) if confidence > 60 else (0, 0, 255)
            annotate(frame, f"Gesture: {gesture} ({confidence:.1f}%)", org=(50, 75), fontScale=2, color=confidence_color)

        text = f"FPS: {int(fps)}"
        (text_w, text_h), _ = cv.getTextSize(text, cv.FONT_HERSHEY_DUPLEX, 1.5, 2)
        annotate(frame, text, org=(frame.shape[1] - text_w - 10, 40), fontScale=1.5, color=(255, 255, 255))

        cv.imshow("Hand Recognizer", frame)
        if cv.waitKey(1) & 0xFF == ord('q'):
            stop_event.set()
            cap_thread.join()
            cap.release()
            break

    cv.destroyAllWindows()

if __name__ == "__main__":
    main()