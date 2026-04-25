import mediapipe as mp
# Force Python to explicitly load the solutions modules
import mediapipe.python.solutions.hands as mp_hands
import mediapipe.python.solutions.drawing_utils as mp_drawing
import cv2 as cv
import math
import csv

class Hand_Detector:
    def __init__(self, mode = False, max_num_hands = 2, min_detection_confidence = 0.7):
        self.mp_hands = mp_hands
        self.hands = self.mp_hands.Hands(static_image_mode=mode, max_num_hands=max_num_hands, min_detection_confidence=min_detection_confidence)
        self.mp_draw = mp_drawing

    def find_hands(self, frame, draw=True, draw_target=None):
        rgb_frame = cv.cvtColor(frame, cv.COLOR_BGR2RGB)
        self.results = self.hands.process(rgb_frame)

        if draw and self.results.multi_hand_landmarks:
            target = draw_target if draw_target is not None else frame
            for handLms in self.results.multi_hand_landmarks:
                self.mp_draw.draw_landmarks(target, handLms, self.mp_hands.HAND_CONNECTIONS)
        return frame
    

    def getNormalizedLandmarks(self):
        
        all_info = []

        if self.results.multi_hand_landmarks:
            for handLms in self.results.multi_hand_landmarks:
                wrist = handLms.landmark[0]
                middleFinger = handLms.landmark[9]
                dist = math.sqrt((middleFinger.x - wrist.x)**2 + (middleFinger.y - wrist.y)**2 + (middleFinger.z - wrist.z)**2) # scale

                thumb = handLms.landmark[4]
                pointer = handLms.landmark[8]

                thumb_to_pointer_dist = math.sqrt((thumb.x - pointer.x)**2 + (thumb.y - pointer.y)**2 + (thumb.z - pointer.z)**2)

                normalized = [thumb_to_pointer_dist]

                for lm in handLms.landmark:
                    new_x = lm.x - wrist.x
                    new_y = lm.y - wrist.y
                    new_z = lm.z - wrist.z
                    normalized.append(new_x/dist)
                    normalized.append(new_y/dist)
                    normalized.append(new_z/dist)

                   

                all_info.append(normalized)

        return all_info
    
    def save_to_csv(self, data, label = "none"):
        with open('training.csv', 'a') as file:
            writer = csv.writer(file)
            row = [label] + data
            writer.writerow(row)

def main():
    cap = cv.VideoCapture(0)

    detector = Hand_Detector()

    is_recording = False

    labels = ["Pinch", "Cursor", "Scroll_Up", "Scroll_Down"]
    label_index = 0
    label = labels[label_index]


    while True: 
        sucess, frame = cap.read()

        if not sucess:
            continue

        
        hand_frame = detector.find_hands(frame)
        hand_data = detector.getNormalizedLandmarks()

        final_frame = cv.flip(frame, 1)    
        

        pressed = cv.waitKey(1) & 0xFF

        if pressed == ord('q'): # press q to quit out of camera
            break

        if pressed == ord('s'):
            is_recording = not is_recording
            annotate(final_frame, f"{'Recording Started' if is_recording else 'Stopped Recording'}")
        
        if pressed == ord('a'):
            label_index = (label_index - 1) % len(labels)
            label = labels[label_index]
        if pressed == ord('d'):
            label_index = (label_index + 1) % len(labels)
            label = labels[label_index]

        
        annotate(final_frame, f"Label: {label}", org=(50, 125), fontScale=1.5, color=(0,0,0))

        if is_recording:
            annotate(final_frame, "recording...", color=(0, 0, 255), fontScale=2)
            if hand_data:
                detector.save_to_csv(hand_data[0], label)
        else:
            annotate(final_frame, "waiting...", color=(0, 255, 0), fontScale=2)

        cv.imshow("Hand Tracking", final_frame)

    cap.release()
    cv.destroyAllWindows()

def annotate(frame, text, org=(50,50), fontFace=cv.FONT_HERSHEY_DUPLEX, fontScale=1, color=(0, 255, 0), thickness=2, lineType=cv.LINE_AA):
    cv.putText(frame, text, org, fontFace, fontScale, color, thickness, lineType)


if __name__ == "__main__": 
    main()
