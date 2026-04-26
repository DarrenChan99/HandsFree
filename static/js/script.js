import { predict } from './model_logic.js';

const video = document.getElementById("webcam");
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const guideBox = document.getElementById("guide-box");
const guideText = document.getElementById("guide-text");

let targetX = 0.5;
let targetY = 0.5;
let currX = 0.5;
let currY = 0.5;
const alpha = 0.3;
const confidenceThreshold = 80;

let currentStage = 0;
let stageCompleted = false;
let transitioning = false;
let playgroundMode = false;

// hand data
let latestHandData = null;


// typing animation
let typingTimer = null;
let lastDisplayedText = null;

const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],           // thumb
  [0,5],[5,6],[6,7],[7,8],           // index
  [0,9],[9,10],[10,11],[11,12],      // middle
  [0,13],[13,14],[14,15],[15,16],    // ring
  [0,17],[17,18],[18,19],[19,20],    // pinky
  [5,9],[9,13],[13,17],             // palm arch
];

function pointToSegmentDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function setGuideText(text) {
  if (text === lastDisplayedText) return;
  lastDisplayedText = text;
  if (typingTimer) {
    clearTimeout(typingTimer);
    typingTimer = null;
  }
  guideText.textContent = "";
  let i = 0;
  function typeChar() {
    if (i < text.length) {
      guideText.textContent += text[i];
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
    targetPos: { x: 0.5, y: 0.45, radius: 55 },
    check: (data, screenPos) => {
      const dist = Math.hypot(screenPos.x - 0.5 * canvas.width, screenPos.y - 0.45 * canvas.height);
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

let confettiParticles = [];

function triggerConfetti() {
  if (confettiParticles.length > 0) return; // skip if particles still active
  for (let i = 0; i < 400; i++) {
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

const hands = new Hands({locateFile: (file) => {
  return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
}});

hands.setOptions({
  maxNumHands: 1,
  modelComplexity: 0, 
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5
});



hands.onResults((results) => {
  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    const now = performance.now();

    if (now - lastSent > SEND_INTERVAL) {
      lastSent = now;

      const landmarks = results.multiHandLandmarks[0];
    }
  } else {
    latestHandData = null;
  }
});

const camera = new Camera(video, {
  onFrame: async () => {
    await hands.send({image: video});
  },
  width: 640,
  height: 480
});

camera.start().then(() => {
  canvas.width = 800;
  canvas.height = 600;
  update(); 
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

hands.onResults((results) => {
  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    const landmarks = results.multiHandLandmarks[0];
    
    const wrist = landmarks[0];
    const middleFinger = landmarks[9];
    const thumb = landmarks[4];
    const pointer = landmarks[8];

    let dist = Math.sqrt(
      Math.pow(middleFinger.x - wrist.x, 2) +
      Math.pow(middleFinger.y - wrist.y, 2) +
      Math.pow(middleFinger.z - wrist.z, 2)
    );
    if (dist < 1e-7) dist = 0.0001;

    const thumbToPointerDist = Math.sqrt(
      Math.pow(thumb.x - pointer.x, 2) +
      Math.pow(thumb.y - pointer.y, 2)
    );

    let gesture;
    let confidence;

    if (thumbToPointerDist < 0.045) { 
      gesture = "Pinch";
      confidence = 100;
    } else {
      let normalized = [thumbToPointerDist];
      landmarks.forEach(lm => {
        normalized.push((lm.x - wrist.x) / dist);
        normalized.push((lm.y - wrist.y) / dist);
        normalized.push((lm.z - wrist.z) / dist);
      });

      const scores = predict(normalized); 
      const gestureClasses = ["Cursor", "Pinch", "Scroll_Down", "Scroll_Up"]; 
      const maxScore = Math.max(...scores);
      const classIndex = scores.indexOf(maxScore);
      
      gesture = gestureClasses[classIndex];
      confidence = maxScore * 100;
    }

    latestHandData = {
      gesture: gesture,
      confidence: confidence,
      x: 1.0 - landmarks[8].x,
      y: landmarks[8].y,
      landmarks: landmarks.map(lm => ({ x: 1.0 - lm.x, y: lm.y }))
    };

    targetX = latestHandData.x;
    targetY = latestHandData.y;

    if (!transitioning) {
      const stage = tutorialStages[currentStage];
      const screenPos = { x: currX * canvas.width, y: currY * canvas.height };
      if (stage.check(latestHandData, screenPos)) {
        updateStageCompleted(stage);
      }
    }
  } else {
    latestHandData = null;
  }
});

function updateStageCompleted(stage) {
    if (transitioning) return;

    transitioning = true;
    stageCompleted = true;

    if (stage.id === "final_star") {
      triggerConfetti();
      setTimeout(() => {
        enterPlaygroundMode();

        setTimeout(() => {
          requestAnimationFrame(() => {
            window.scrollTo({
              top: document.documentElement.scrollHeight,
              behavior: "smooth"
            });
          });
        }, 300); 
      
      }, 4000);
      return;
    }

  guideBox.classList.add("success-flash");

  setTimeout(() => {
    currentStage++;
    stageCompleted = false;
    transitioning = false;
    lastDisplayedText = null; 
    guideBox.classList.remove("success-flash");
  }, 2000);
}

function enterPlaygroundMode() {
  playgroundMode = true;
  guideBox.classList.add("sliding-out");

  setTimeout(() => {
    const gameViewport = document.querySelector(".game-viewport");
    gameViewport.parentNode.insertBefore(guideBox, gameViewport.nextSibling);

    document.body.classList.add("playground-mode");
    document.documentElement.classList.add("playground-mode");

    guideBox.classList.remove("sliding-out");
    guideBox.classList.add("playground-guide");

    lastDisplayedText = null;
    setGuideText(
      `🎉 Demo complete! HandsFree is now in playground mode. Wave your hand and play with all gestures. 
      \n
      While this demo is just for fun, it's just a proof of concept for a much bigger idea. The true goal of HandsFree is to give disabled or temporarily injured individuals full range of control over their device.
      Imagine losing the ability to use a standard mouse and keyboard but still being able to interact with your computer just through moving your hand.
      If you believe in this vision and enjoyed the demo please consider leaving a vote.
      Thank You so much for playing! I hope you enjoyed the experince 👍
      `
    );
  }, 500);
}

function drawGame(x, y) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (playgroundMode) {
    drawPlaygroundStats();
    drawDisplayHand(x, y);
    if (confettiParticles.length > 0) drawConfetti();
    return;
  }

  const stage = tutorialStages[currentStage];
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
    case "final_star":
      drawFinalStar();
      break;
  }

  drawDisplayHand(x, y);
  
  if (confettiParticles.length > 0) {
    drawConfetti();
  }
}

function drawPlaygroundStats() {
  const gesture    = latestHandData ? (latestHandData.gesture    || "None") : "None";
  const confidence = latestHandData ? (latestHandData.confidence || 0) : 0;
  const bx = 14, by = 14, bw = 240, bh = 94;

  ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
  ctx.lineWidth = 1;
  ctx.strokeRect(bx, by, bw, bh);

  ctx.textBaseline = "top";
  ctx.font = "bold 16px monospace";
  ctx.fillStyle = "#d97706";
  ctx.fillText("PLAYGROUND STATS", bx + 12, by + 12);

  ctx.font = "14px monospace";
  ctx.fillStyle = "#e8e8e8";
  ctx.fillText(`Gesture: ${gesture}`, bx + 12, by + 32);

  const confColor = confidence > 80 ? "#00FF64" : confidence > 60 ? "#FFA500" : "#FF5555";
  ctx.fillStyle = confColor;
  ctx.fillText(`Confidence: ${confidence.toFixed(1)}%`, bx + 12, by + 52);
  ctx.fillStyle = "#e8e8e8";
}

function drawDisplayHand(x, y) {
  ctx.save();
  ctx.shadowBlur = 0;
  const landmarks = latestHandData && latestHandData.landmarks;
  if (landmarks && landmarks.length === 21) {
    // bone segements
    ctx.strokeStyle = "rgba(0, 200, 255, 0.75)";
    ctx.lineWidth = 2;
    for (const [a, b] of HAND_CONNECTIONS) {
      const lax = landmarks[a].x * canvas.width;
      const lay = landmarks[a].y * canvas.height;
      const lbx = landmarks[b].x * canvas.width;
      const lby = landmarks[b].y * canvas.height;
      ctx.beginPath();
      ctx.moveTo(lax, lay);
      ctx.lineTo(lbx, lby);
      ctx.stroke();
    }

    // landmark dots
    for (let i = 0; i < landmarks.length; i++) {
      const lx = landmarks[i].x * canvas.width;
      const ly = landmarks[i].y * canvas.height;
      ctx.beginPath();
      ctx.arc(lx, ly, i === 8 ? 7 : 3, 0, Math.PI * 2);
      ctx.fillStyle = i === 8 ? "#00FF64" : "rgba(0, 200, 255, 0.9)";
      ctx.fill();
    }
  }

  ctx.restore();
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