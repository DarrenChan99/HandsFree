import pickle
import cv2 as cv
import numpy as np
from main import Hand_Detector, annotate
import pyautogui
from collections import deque

model_dict = pickle.load(open('model.p', 'rb'))
model = model_dict['model']

def clamp(v, lo, hi):
    return max(lo, min(hi, v))

def main():
    cap = cv.VideoCapture(0)
    detector = Hand_Detector()
    screen_width, screen_height = pyautogui.size()
    
    edge_margin_px = 5
    alpha = 0.35
    smoothed_x, smoothed_y = None, None

    lastGestures = deque(maxlen=7)  

    while True:
        success, frame = cap.read()
        if not success:
            break

        detector.find_hands(frame)
        hand_data = detector.getNormalizedLandmarks()

        frame = cv.flip(frame, 1)

        if hand_data:
            prediction = model.predict([hand_data[0]])
            raw_gesture = prediction[0]

            probabilities = model.predict_proba([hand_data[0]])[0]
            confidence = max(probabilities) * 100  

            lastGestures.append(raw_gesture)


            gesture_count = {}
            for gesture in lastGestures:
                gesture_count[gesture] = gesture_count.get(gesture, 0) + 1
            gesture = max(gesture_count, key=gesture_count.get)

            confidence_color = (0, 255, 0) if confidence > 80 else (0, 165, 255) if confidence > 60 else (0, 0, 255)
            annotate(frame, f"Gesture: {gesture} ({confidence:.1f}%)", org=(50, 100), fontScale=2, color=confidence_color)

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
            
            if gesture == "Pinch":
                pyautogui.leftClick()

        cv.imshow("Hand Recognizer", frame)
        if cv.waitKey(1) & 0xFF == ord('q'):
            break
        
    cap.release()
    cv.destroyAllWindows()

if __name__ == "__main__":
    main()