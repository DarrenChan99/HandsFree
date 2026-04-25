const socket = io();
const video = document.getElementById("webcam");
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const guideBox = document.getElementById("guide-box");
const guideText = document.getElementById("guide-text");

let targetX = 0.5;
let targetY = 0.5;
let currX = 0.5;
let currY = 0.5;
const alpha = 0.15;
const confidenceThreshold = 65;

let currentStage = 0;
let stageCompleted = false;
let transitioning = false;

// --- Typing animation ---
let typingTimer = null;
let lastDisplayedText = null;

function setGuideText(text) {
  if (text === lastDisplayedText) return;
  lastDisplayedText = text;
  if (typingTimer) {
    clearTimeout(typingTimer);
    typingTimer = null;
  }
  guideText.innerText = "";
  let i = 0;
  function typeChar() {
    if (i < text.length) {
      guideText.innerText += text[i];
      i++;
      typingTimer = setTimeout(typeChar, 35);
    }
  }
  typeChar();
}

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
    id: "shape_circle",
    prompt: "SHAPE TEST: Pinch the circle below to grab it.",
    targetPos: { x: 0.5, y: 0.8, radius: 55 },
    check: (data, screenPos) => {
      const dist = Math.hypot(screenPos.x - 0.5 * canvas.width, screenPos.y - 0.8 * canvas.height);
      return data.gesture === "Pinch" && dist < 55;
    },
    nextText: "Nice hit! More shapes incoming...",
  },
  {
    id: "shape_rect",
    prompt: "SHAPE TEST: Pinch the orange rectangle!",
    targetPos: { x: 0.2, y: 0.35, w: 110, h: 65 },
    check: (data, screenPos) => {
      const dist = Math.hypot(screenPos.x - 0.2 * canvas.width, screenPos.y - 0.35 * canvas.height);
      return data.gesture === "Pinch" && dist < 75;
    },
    nextText: "Rectangle Cleared!",
  },
  {
    id: "shape_triangle",
    prompt: "SHAPE TEST: Pinch the blue triangle!",
    targetPos: { x: 0.78, y: 0.6 },
    check: (data, screenPos) => {
      const dist = Math.hypot(screenPos.x - 0.78 * canvas.width, screenPos.y - 0.6 * canvas.height);
      return data.gesture === "Pinch" && dist < 70;
    },
    nextText: "All Shapes Cleared!",
  },
  {
    id: "maze",
    prompt: "MAZE PROTOCOL: Reach the green goal. Avoid the white walls!",
    isMaze: true,
    check: (data, screenPos) => {
      const pixel = ctx.getImageData(screenPos.x, screenPos.y, 1, 1).data;
      if (pixel[0] > 200 && pixel[1] > 200 && pixel[2] > 200) {
        resetToMazeStart();
        return false;
      }
      return pixel[1] > 200 && pixel[0] < 100; // green goal
    },
    nextText: "Maze Escaped!",
  },
  {
    id: "final_star",
    prompt: "FINAL TASK: Pinch the Star to complete the demo!",
    targetPos: { x: 0.5, y: 0.45 },
    check: (data, screenPos) => {
      const dist = Math.hypot(screenPos.x - 0.5 * canvas.width, screenPos.y - 0.45 * canvas.height);
      return data.gesture === "Pinch" && dist < 65;
    },
    nextText: "CONGRATULATIONS! You completed the HandsFree demo! 🎉",
  },
];

// --- Confetti particles ---
let confettiParticles = [];

function triggerConfetti() {
  if (confettiParticles.length > 0) return; // skip if particles still active
  for (let i = 0; i < 180; i++) {
    confettiParticles.push({
      x: Math.random() * canvas.width,
      y: -Math.random() * canvas.height * 0.6,
      vx: (Math.random() - 0.5) * 5,
      vy: Math.random() * 3 + 2,
      color: `hsl(${Math.random() * 360}, 100%, 55%)`,
      w: Math.random() * 12 + 5,
      h: Math.random() * 6 + 3,
      rot: Math.random() * Math.PI * 2,
      rotV: (Math.random() - 0.5) * 0.2,
    });
  }
}

function drawConfetti() {
  for (const p of confettiParticles) {
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.rotV;
    p.vy += 0.07; // gravity
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    ctx.restore();
  }
  confettiParticles = confettiParticles.filter((p) => p.y < canvas.height + 30);
}

async function startWebcam() {
  const stream = await navigator.mediaDevices.getUserMedia({ video: true });
  video.srcObject = stream;

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
    triggerConfetti();
    return;
  }

  guideBox.classList.add("success-flash");

  setTimeout(() => {
    currentStage++;
    stageCompleted = false;
    transitioning = false;
    lastDisplayedText = null; // allow new stage prompt to type
    guideBox.classList.remove("success-flash");

    // Auto-move cursor to maze start when entering the maze stage
    const newStage = tutorialStages[currentStage];
    if (newStage && newStage.isMaze) {
      currX = 0.1;
      currY = 0.8;
      targetX = 0.1;
      targetY = 0.8;
    }
  }, 2000);
}

function resetToMazeStart() {
  currX = 0.1;
  currY = 0.8;
  targetX = 0.1;
  targetY = 0.8;
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

  // Update guide text with typing animation
  const text = transitioning ? stage.nextText : stage.prompt;
  setGuideText(text);

  switch (stage.id) {
    case "shape_circle": {
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
    }
    case "shape_rect": {
      const pos = stage.targetPos;
      const rx = pos.x * canvas.width;
      const ry = pos.y * canvas.height;
      ctx.beginPath();
      ctx.rect(rx - pos.w / 2, ry - pos.h / 2, pos.w, pos.h);
      ctx.fillStyle = stageCompleted ? "rgba(0,255,100,0.25)" : "rgba(255,120,0,0.25)";
      ctx.fill();
      ctx.strokeStyle = stageCompleted ? "#00FF64" : "#FF7800";
      ctx.lineWidth = 5;
      ctx.stroke();
      break;
    }
    case "shape_triangle": {
      const pos = stage.targetPos;
      const tx = pos.x * canvas.width;
      const ty = pos.y * canvas.height;
      const size = 62;
      ctx.beginPath();
      // sin(60°) ≈ 0.866, cos(60°) ≈ 0.5 for equilateral triangle vertices
      ctx.moveTo(tx, ty - size);
      ctx.lineTo(tx + size * 0.866, ty + size * 0.5);
      ctx.lineTo(tx - size * 0.866, ty + size * 0.5);
      ctx.closePath();
      ctx.fillStyle = stageCompleted ? "rgba(0,255,100,0.25)" : "rgba(0,150,255,0.25)";
      ctx.fill();
      ctx.strokeStyle = stageCompleted ? "#00FF64" : "#0096FF";
      ctx.lineWidth = 5;
      ctx.stroke();
      break;
    }
    case "maze":
      drawMaze();
      break;
    case "final_star":
      drawFinalStar();
      break;
  }

  drawDisplayHand(x, y);

  // Draw confetti on top of everything
  if (confettiParticles.length > 0) {
    drawConfetti();
  }
}

function drawDisplayHand(x, y) {
  ctx.beginPath();
  ctx.arc(x, y, 10, 0, Math.PI * 2);
  ctx.fillStyle = "#00FF64";
  ctx.fill();
  ctx.shadowBlur = 15;
  ctx.shadowColor = "#00FF64";
}

function drawStarShape(cx, cy, outerR, innerR, points) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    // -Math.PI / 2 rotates start angle so the first point faces upward
    const angle = (i * Math.PI) / points - Math.PI / 2;
    const px = cx + r * Math.cos(angle);
    const py = cy + r * Math.sin(angle);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = "#FFD700";
  ctx.fill();
  ctx.strokeStyle = "#FFA500";
  ctx.lineWidth = 3;
  ctx.stroke();
}

function drawFinalStar() {
  const cx = canvas.width * 0.5;
  const cy = canvas.height * 0.45;
  drawStarShape(cx, cy, 65, 28, 5);
}

