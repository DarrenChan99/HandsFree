const socket = io();
const video = document.getElementById("webcam");
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const guideBox = document.getElementById("guide-box");

let targetX = 0.5;
let targetY = 0.5;
let currX = 0.5;
let currY = 0.5;
const alpha = 0.15;
const confidenceThreshold = 65;

let currentStage = 0;
let stageCompleted = false;
let transitioning = false;
const tutorialStages = [
  {
    id: "welcome",
    prompt: "Welcome to HandsFree! Move your hand to position the guide.",
    check: (data) => true,
    nextText: "Systems Initialized.",
  },
  {
    id: "intro_cursor",
    prompt: "STEP 1: Extend your pointer finger to move the cursor.",
    check: (data) => data.gesture === "Cursor",
    nextText: "Cursor Learned!",
  },
  {
    id: "intro_pinch",
    prompt: "STEP 2: Pinch your index and thumb to 'Click'.",
    check: (data) => data.gesture === "Pinch",
    nextText: "Clicking Active.",
  },
  {
    id: "intro_scroll_up",
    prompt: "STEP 3: Hold your hand flat to 'Scroll Up'.",
    check: (data) => data.gesture === "Scroll_Up",
    nextText: "Scroll Captured.",
  },
  {
    id: "intro_scroll_down",
    prompt: "STEP 4: Bend your hand down to 'Scroll Down'.",
    check: (data) => data.gesture === "Scroll_Down",
    nextText: "All Gestures Learned!",
  },
  {
    id: "shape_game",
    prompt: "SHAPE TEST: Pinch the circle to grab it.",
    targetPos: { x: 0.8, y: 0.2, radius: 60 },
    check: (data, screenPos) => {
      const dist = Math.hypot(screenPos.x - 0.8 * canvas.width, screenPos.y - 0.2 * canvas.height);
      return data.gesture === "Pinch" && dist < 60;
    },
    nextText: "Precision Confirmed.",
  },
  {
    id: "maze",
    prompt: "MAZE PROTOCOL: Reach the green goal. Avoid white walls!",
    isMaze: true,
    check: (data, screenPos) => {
      const pixel = ctx.getImageData(screenPos.x, screenPos.y, 1, 1).data;
      if (pixel[0] > 200 && pixel[1] > 200 && pixel[2] > 200) {
        // white walls
        resetToMazeStart();
        return false;
      }
      return pixel[1] > 200 && pixel[0] < 100; // green goal
    },
    nextText: "Maze Escaped!",
  },
  {
    id: "final_star",
    prompt: "FINAL TASK: Click the Star to finish the demo!",
    targetPos: { x: 0.5, y: 0.5, size: 80 },
    check: (data, screenPos) => {
      const dist = Math.hypot(screenPos.x - 0.5 * canvas.width, screenPos.y - 0.5 * canvas.height);
      return data.gesture === "Pinch" && dist < 50;
    },
    nextText: "CONGRATULATIONS!",
  },
];

async function startWebcam() {
  const stream = await navigator.mediaDevices.getUserMedia({ video: true }); // use await to not block main thread
  video.srcObject = stream;

  const viewport = document.querySelector('.game-viewport');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

startWebcam().then(() => {
  update(true);
});

function update(shouldDrawGame = false) {
  currX = currX + (targetX - currX) * alpha;
  currY = currY + (targetY - currY) * alpha;

  const screenX = currX * window.innerWidth;
  const screenY = currY * window.innerHeight;

  // guideBox.style.left = `${screenX}px`;
  // guideBox.style.top = `${screenY}px`;

  //   guideBox.style.left = `50%`;
  //   guideBox.style.top = `100px`;

//   guideBox.style.display = "block";

  if (shouldDrawGame) {
    drawGame(screenX, screenY);
  }

  requestAnimationFrame(update);
}

socket.on("predicted_results", (data) => {
  targetX = data.x;
  targetY = data.y;

  if (data.confidence > confidenceThreshold && !transitioning) {
    const stage = tutorialStages[currentStage];
    const screenPos = {
      x: currX * canvas.width,
      y: currY * canvas.height,
    };

    if (stage.check(data, screenPos)) {
      updateStageCompleted(stage);
    }
  }
});

function updateStageCompleted(stage) {
  if (transitioning) return;

  transitioning = true;
  stageCompleted = true;

  if (stage.id === "final_star") {
    document.getElementById("guide-text").innerText = "You've Reached the End of the Demo, Hope you Enjoyed!";
    triggerConfetti(); 
    return;
  }

  const guideText = document.getElementById("guide-text");
  guideText.innerText = stage.nextText;
  guideBox.classList.add("success-flash");

  setTimeout(() => {
    currentStage++;
    stageCompleted = false;
    transitioning = false;
    guideBox.classList.remove("success-flash");
  }, 2000);
}

function resetToMazeStart() {
  currX = 0.1;
  currY = 0.5;
}

function drawMaze() {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.beginPath();
  ctx.strokeStyle = "white";
  ctx.lineWidth = 60;
  ctx.moveTo(canvas.width * 0.1, canvas.height * 0.8);
  ctx.lineTo(canvas.width * 0.4, canvas.height * 0.8);
  ctx.lineTo(canvas.width * 0.4, canvas.height * 0.2);
  ctx.lineTo(canvas.width * 0.9, canvas.height * 0.2);
  ctx.stroke();

  ctx.beginPath();
  ctx.strokeStyle = "black";
  ctx.lineWidth = 50;
  ctx.moveTo(canvas.width * 0.1, canvas.height * 0.8);
  ctx.lineTo(canvas.width * 0.4, canvas.height * 0.8);
  ctx.lineTo(canvas.width * 0.4, canvas.height * 0.2);
  ctx.lineTo(canvas.width * 0.9, canvas.height * 0.2);
  ctx.stroke();

  ctx.fillStyle = "#00FF64";
  ctx.fillRect(canvas.width * 0.85, canvas.height * 0.15, 60, 60);
}

setInterval(() => {
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = 320; // same as inference_w from app.py
  tempCanvas.height = 240;

  const tempCtx = tempCanvas.getContext("2d");
  tempCtx.drawImage(video, 0, 0, 320, 240);
  const base64Frame = tempCanvas.toDataURL("image/jpeg", 0.5);
  socket.emit("video_frame", base64Frame);
}, 100);

function drawGame(x, y) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const stage = tutorialStages[currentStage];

  const guideText = document.getElementById("guide-text");

  if (transitioning) {
    guideText.innerText = stage.nextText;
  } else {
    guideText.innerText = stage.prompt;
  }

  switch (stage.id) {
    case "shape_game":
      const circle = stage.targetPos;
      const cx = circle.x * canvas.width;
      const cy = circle.y * canvas.height;

      ctx.beginPath();
      ctx.arc(cx, cy, circle.radius, 0, Math.PI * 2);
      ctx.lineWidth = 5;
      ctx.strokeStyle = stageCompleted ? "#00FF64" : "white";
      ctx.stroke();

      ctx.fillStyle = "rgba(0, 255, 100, 0.1)";
      ctx.fill();
      break;
    case "maze":
      drawMaze();
      break;
    case "final_star":
      drawFinalStar();
      break;
  }

  drawDisplayHand(x, y);
}

function drawDisplayHand(x, y) {
  ctx.beginPath();
  ctx.arc(x, y, 10, 0, Math.PI * 2);
  ctx.fillStyle = "#00FF64";
  ctx.fill();
  ctx.shadowBlur = 15;
  ctx.shadowColor = "#00FF64";
}

function drawFinalStar() {
  const stage = tutorialStages[currentStage];
  const cx = canvas.width * 0.5;
  const cy = canvas.height * 0.5;

  ctx.fillStyle = "#FFD700";
  ctx.font = "80px Arial";
  ctx.textAlign = "center";
  ctx.fillText("⭐", cx, cy + 30);

  if (stageCompleted) {
    triggerConfetti();
  }
}

function triggerConfetti() {
  for (let i = 0; i < 50; i++) {
    ctx.fillStyle = `hsl(${Math.random() * 360}, 100%, 50%)`;
    ctx.fillRect(canvas.width / 2 + (Math.random() - 0.5) * 500, canvas.height / 2 + (Math.random() - 0.5) * 500, 10, 10);
  }
}
