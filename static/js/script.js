const socket = io();
const video = document.getElementById('webcam');
const canvas = document.getElementById('gameCanvas')
const ctx = canvas.getContext('2d')
const guideBox = document.getElementById('guide-box')

let targetX = 0.5; let targetY = 0.5;
let currX = 0.5; let currY = 0.5;
const alpha = 0.15
const confidenceThreshold = 65


let currentStage = 0;
let stageCompleted = false;
let transitioning = false;
const tutorialStages = [
    {
        id: "intro_cursor",
        prompt: "Welcome! Extend your pointer finger to move the cursor",
        check: (data) => data.gesture === "Cursor",
        nextText: "Cursor Learned!"
    },
    {
        id: "intro_pinch",
        prompt: "Now, Pinch your index and thumb together to left click",
        check: (data) => data.gesture === "Pinch",
        nextText: "Pinch Learned"
    },
    {
        id: "intro_scroll_up",
        prompt: "Now hold you hand flat parallel to the camera",
        check: (data) => data.gesture === "Scroll_Up",
        nextText: "Success!"
    },
    {
        id: "intro_scroll_down",
        prompt: "Now move your hand to be bent down",
        check: (data) => data.gesture === "Scroll_Down",
        nextText: "Success!"
    },
    {
        id: "shape_game",
        prompt: "Precision Test: Move to the circle and Pinch to grab.",
        targetPos: { x: 0.8, y: 0.2, radius: 50 },
        check: (data, screenPos) => {
            const dist = Math.hypot(screenPos.x - (0.8 * canvas.width), screenPos.y - (0.2 * canvas.height));
            return data.gesture === "Pinch" && dist < 50;
        }
    },
    {
        id: "maze",
        prompt: "MAZE PROTOCOL: Reach the green goal. Don't touch the white walls!",
        isMaze: true,
        check: (data, screenPos) => {
            const pixel = ctx.getImageData(screenPos.x, screenPos.y, 1, 1).data;
            if (pixel[0] > 200 && pixel[1] > 200 && pixel[2] > 200) {
                resetToMazeStart();
                return false;
            }
            return (pixel[1] > 200 && pixel[0] < 100); 
        }
    },
]


async function startWebcam() {
    const stream = await navigator.mediaDevices.getUserMedia({video : true}) // use await to not block main thread
    video.srcObject = stream;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

startWebcam().then(() => {
    update(true)
})

function update(shouldDrawGame = false) {
    currX = currX + (targetX - currX) * alpha
    currY = currY + (targetY - currY) * alpha

    const screenX = currX * window.innerWidth;
    const screenY = currY * window.innerHeight;

    guideBox.style.left = `${screenX}px`;
    guideBox.style.top = `${screenY}px`;

    if (shouldDrawGame) {
        drawGame(screenX, screenY)
    }

    requestAnimationFrame(update)
}

socket.on('predicted_results', (data) => {
    targetX = data.x
    targetY = data.y

    if (data.confidence > confidenceThreshold && !transitioning) {
        const stage = tutorialStages[currentStage]
        const screenPos = {
            x: currX * canvas.width,
            y: currY * canvas.height            
        };

        if (stage.check(data, screenPos)) {
            updateStageCompleted(stage)
        }
    }

    



});

function updateStageCompleted(stage) {
    transitioning = true;
    stageCompleted = true;

    const guideText = document.getElementById('guide-text');
    guideText.innerText = stage.nextText;
    guideBox.classList.add('success-flash')

    setTimeout(() => {
        if (currentStage < tutorialStages.length - 1) {
            currentStage++;
            stageCompleted = false; 
            isTransitioning = false; 
            guideBox.classList.remove('success-flash');
        }
    }, 2000);
}

setInterval(() => {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = 320; // same as inference_w from app.py
    tempCanvas.height = 240;

    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(video, 0,0,320,240)
    const base64Frame = tempCanvas.toDataURL('image/jpeg', 0.5)
    socket.emit('video_frame', base64Frame)
}, 100)

function drawGame(x, y) {
    ctx.clearRect(0,0, canvas.width, canvas.height);
    const stage = tutorialStages[currentStage];

    const guideText = document.getElementById('guide-text');

    if (transitioning) {
        guideText.innerText = stage.nextText;
    } else {
        guideText.innerText = stage.prompt;
    }

    switch (stage.id) {
        case "shape_game":
            const circle = stage.targetPos
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
            drawMaze()
          break;
    
          
    }

    drawDisplayHand(x,y);
}

function drawDisplayHand(x,y) {
    ctx.beginPath();
    ctx.arc(x, y, 10, 0, Math.PI * 2);
    ctx.fillStyle = "#00FF64";
    ctx.fill();
    ctx.shadowBlur = 15;
    ctx.shadowColor = "#00FF64";
}

