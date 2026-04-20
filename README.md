# HandsFree ✋
A project where I set out to create a way to freely interact with technology. I was inspired to learn more about computer vision and machine learning so I decided to find a project that encapsulated both of these ideas, while still serving a real world purpose. Using real time hand tracking and the MediaPipe library I was able to obtain accurate hand positions and train my own machine learning model to detect gestures and control my computer using those gestures. 

Whether you were born with a condition that makes traditional input difficult, are recovering from an injury, or simply have your hands full (ps. it's great for cooking 👨‍🍳). 

## Optmization
  - Lowered the resolution of camera to reduce load each frame
  - Moved camera readings to seperate thread to unblock main thread and improve fps
