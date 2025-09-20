// Main demo script: MediaPipe Hands + Three.js steering wheel + Chart.js graphs

const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const overlayCtx = overlay.getContext('2d');

const threeContainer = document.getElementById('three-container');

let scene, camera, renderer, wheel;
let hands;
let mpCanvas, mpCtx; // offscreen canvas used to feed mirrored frames to MediaPipe
let chartR, chartTheta;
// mirrorVideo: when true the video is mirrored (like many webcam previews).
// When false the video shows natural camera orientation. We'll keep overlays
// and landmark conversions consistent with this toggle.
let mirrorVideo = true;
let autoMirrorChecked = false;

const maxHistory = 200;
const rData = [];
const thetaData = [];

function setupThree() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  camera.position.set(0, 0, 1.5);

  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  // keep the renderer transparent so the camera canvas shows through
  renderer.setClearColor(0x000000, 0);
  // attach renderer as a full-screen overlay so 3D objects can be positioned
  // using the same coordinate space as the overlay canvas
  const app = document.getElementById('app') || document.body;
  renderer.domElement.style.position = 'absolute';
  renderer.domElement.style.left = '0';
  renderer.domElement.style.top = '0';
  renderer.domElement.style.zIndex = '2';
  renderer.domElement.style.pointerEvents = 'none';
  app.appendChild(renderer.domElement);

  const hemisphere = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
  scene.add(hemisphere);
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(0, 1, 1);
  scene.add(dir);

  // ground / helper
  const grid = new THREE.AxesHelper(0.5);
  scene.add(grid);

  // load GLB (fallback to a simple torus if load fails)
  // Single canonical in-repo path (inside handsOff). Place the model at:
  // C:\Users\willi\Desktop\handsOff\ai-steering-wheel-racing-nrg\source\SteeringWheel_NRG.glb
  const modelPath = './ai-steering-wheel-racing-nrg/source/SteeringWheel_NRG.glb';

  let LoaderCtor = null;
  // Try common locations for GLTFLoader when using non-module script tags
  if (THREE && THREE.GLTFLoader) LoaderCtor = THREE.GLTFLoader;
  else if (typeof GLTFLoader !== 'undefined') LoaderCtor = GLTFLoader;

  if (LoaderCtor) {
    try {
      const loader = new LoaderCtor();
      loader.load(modelPath, gltf => {
        wheel = gltf.scene;
        // tweak model so it is visible in our camera/scene
        wheel.scale.setScalar(0.02);
        wheel.userData = wheel.userData || {};
        wheel.userData.baseScale = 0.02;
        // ensure wheel faces camera initially
        wheel.quaternion.copy(camera.quaternion);
        wheel.rotation.x = Math.PI / 2; // orient wheel face-on if needed (model-specific)
        wheel.position.set(0, 0, 0);
        scene.add(wheel);
        drawStatus('GLB loaded');
      }, undefined, e => {
        console.warn('Failed to load GLB model, creating fallback wheel (torus).', e);
        createSteeringWheelMesh();
      });
    } catch (err) {
      console.warn('Error constructing GLTFLoader:', err);
      createSteeringWheelMesh();
    }
  } else {
    console.warn('GLTFLoader not found on this page - using fallback wheel');
    createSteeringWheelMesh();
  }

  onResize();
  window.addEventListener('resize', onResize);
  animate();
}

function createSteeringWheelMesh() {
  // Torus outer rim
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.6, roughness: 0.3 });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.07, 24, 160), rimMat);

  // inner ring (slightly smaller to give thickness)
  const innerMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.4, roughness: 0.5 });
  const inner = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.035, 16, 120), innerMat);

  // spokes - create 3 spokes evenly spaced
  const spokes = new THREE.Group();
  const spokeGeom = new THREE.CylinderGeometry(0.02, 0.02, 0.38, 12);
  const spokeMat = new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.5, roughness: 0.4 });
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Mesh(spokeGeom, spokeMat);
    s.position.set(0, 0, 0);
    s.rotation.z = (i * Math.PI * 2 / 3);
    s.rotation.x = Math.PI / 2;
    s.translateY(0.16);
    spokes.add(s);
  }

  wheel = new THREE.Group();
  wheel.add(rim);
  wheel.add(inner);
  wheel.add(spokes);
  wheel.scale.setScalar(1.1);
  wheel.userData = wheel.userData || {};
  wheel.userData.baseScale = 1.1;
  // orient wheel to face camera center (local Z forward)
  wheel.quaternion.copy(camera.quaternion);
  wheel.position.set(0, 0, 0);
  scene.add(wheel);
  drawStatus('Fallback steering wheel created');
}

function onResize() {
  const w = overlay.clientWidth || window.innerWidth;
  const h = overlay.clientHeight || window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}

function setupCharts() {
  const ctxR = document.getElementById('chart-r').getContext('2d');
  const ctxT = document.getElementById('chart-theta').getContext('2d');

  chartR = new Chart(ctxR, {
    type: 'line',
    data: { labels: [], datasets: [{ label: 'r (px)', data: [], borderColor: 'orange', tension: 0.2 }] },
    options: { animation: false, normalized: true, plugins: { legend: { display: true } }, scales: { x: { display: false } } }
  });

  chartTheta = new Chart(ctxT, {
    type: 'line',
    data: { labels: [], datasets: [{ label: 'theta (deg)', data: [], borderColor: 'cyan', tension: 0.2 }] },
    options: { animation: false, normalized: true, plugins: { legend: { display: true } }, scales: { x: { display: false } } }
  });
}

function pushPoint(r, thetaDeg) {
  if (rData.length >= maxHistory) { rData.shift(); thetaData.shift(); }
  rData.push(r); thetaData.push(thetaDeg);

  chartR.data.labels = rData.map((_, i) => i);
  chartR.data.datasets[0].data = rData;
  chartR.update('none');

  chartTheta.data.labels = thetaData.map((_, i) => i);
  chartTheta.data.datasets[0].data = thetaData;
  chartTheta.update('none');
}

function computePalmCenter(landmarks) {
  // Use wrist (0) and middle_finger_mcp (9) as rough palm center average
  const x = (landmarks[0].x + landmarks[9].x) / 2;
  const y = (landmarks[0].y + landmarks[9].y) / 2;
  return { x, y };
}

function onResults(results) {
  // draw camera frame to overlay canvas
  overlay.width = video.videoWidth || 640;
  overlay.height = video.videoHeight || 480;
  overlayCtx.save();
  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
  // We no longer draw the camera image into the overlay canvas because
  // the Three.js renderer (full-screen) renders the wheel. Clear overlay.
  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);

  // Use MediaPipe's handedness labels (if present) to determine which
  // landmark set corresponds to the left and right hands. This avoids
  // relying on a heuristic based on landmark positions.
  // We'll map labels (case-insensitive) to choose the left/right palm centers.
  let leftLandmarks = null;
  let rightLandmarks = null;
  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    for (let i = 0; i < results.multiHandLandmarks.length; i++) {
      const lm = results.multiHandLandmarks[i];
      const label = results.multiHandedness?.[i]?.label || results.multiHandedness?.[i]?.classification?.[0]?.label || null;
      if (label) {
        const l = label.toLowerCase();
        if (l.startsWith('left')) leftLandmarks = lm;
        if (l.startsWith('right')) rightLandmarks = lm;
      }
    }
  }

  if (!results.multiHandLandmarks || results.multiHandLandmarks.length < 2) {
    overlayCtx.restore();
    return;
  }

  // compute palm centers for first two hands; prefer MediaPipe's left/right labels
  let pLeft, pRight;
  if (leftLandmarks && rightLandmarks) {
    pLeft = computePalmCenter(leftLandmarks);
    pRight = computePalmCenter(rightLandmarks);
  } else {
    // fallback: use the first two detected hands in order
    pLeft = computePalmCenter(results.multiHandLandmarks[0]);
    pRight = computePalmCenter(results.multiHandLandmarks[1]);
  }

  // convert normalized to pixels. If we draw the video unflipped we must mirror
  // the normalized X coordinate so overlays align with the displayed image.
  function normToPx(pt) {
    // We feed MediaPipe the mirrored frame when `mirrorVideo===true`, so
    // landmarks already correspond to the displayed (mirrored) image.
    // Therefore no additional x-flip is needed here; just map normalized
    // coordinates to pixel space directly.
    return { x: pt.x * overlay.width, y: pt.y * overlay.height };
  }
  // We'll render left hand as 'a' (red) and right as 'b' (blue)
  const a = normToPx(pLeft);
  const b = normToPx(pRight);

  // draw markers
  overlayCtx.fillStyle = 'red';
  overlayCtx.beginPath(); overlayCtx.arc(a.x, a.y, 8, 0, Math.PI * 2); overlayCtx.fill();
  overlayCtx.fillStyle = 'blue';
  overlayCtx.beginPath(); overlayCtx.arc(b.x, b.y, 8, 0, Math.PI * 2); overlayCtx.fill();

  // vector from left to right
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const r = Math.hypot(vx, vy);
  // compute angle relative to horizontal; when hands level (same y), wheel should be unrotated
  const theta = Math.atan2(vy, vx); // radians
  const thetaDeg = theta * 180 / Math.PI;

  // draw vector
  overlayCtx.strokeStyle = 'lime'; overlayCtx.lineWidth = 4;
  overlayCtx.beginPath(); overlayCtx.moveTo(a.x, a.y); overlayCtx.lineTo(b.x, b.y); overlayCtx.stroke();

  // update 3D model: position at midpoint, rotation to match angle, scale with r
  if (wheel) {
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;

    // map pixel coordinates to Three.js NDC-ish coordinates roughly
    const w = renderer.domElement.clientWidth;
    const h = renderer.domElement.clientHeight;

    const ndcX = (midX / overlay.width) * 2 - 1;
    const ndcY = -((midY / overlay.height) * 2 - 1);

    // project NDC to camera plane at z=0
    const vec = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(camera);
    wheel.position.lerp(vec, 0.4);
    // Orient the wheel to face the camera (so the wheel center faces the user)
    // and then rotate it around the camera forward axis by -theta for steering.
    try {
      const camQuat = camera.quaternion.clone();
      const camForward = new THREE.Vector3();
      camera.getWorldDirection(camForward);
  // If the video is mirrored we need to invert rotation direction so the
  // wheel turns the expected way relative to the mirrored markers.
  const rotAngle = mirrorVideo ? theta : -theta;
  const qRot = new THREE.Quaternion().setFromAxisAngle(camForward.normalize(), rotAngle);
      const targetQuat = camQuat.clone().multiply(qRot);
      wheel.quaternion.slerp(targetQuat, 0.4);
    } catch (e) {}

    // Scale the wheel so it fits within the circle through the palm centers.
    try {
  // Desired diameter should be 3/4 of the on-screen line length => radius = (r * 3/4)/2 = r * 3/8
  const desiredPixelRadius = Math.max(5, (r * 3 / 8)); // at least 5px

      // compute world-space center and an edge point in the wheel's right direction
        // We'll compute a scale that makes the wheel occupy 'desiredPixelRadius' on screen
        // but ignore depth (z). To do this we estimate pixels-per-world-unit at a unit
        // depth using the camera FOV and renderer height, then compute the scale that
        // results in the desired pixel radius for the model's intrinsic radius.
    // Use bounding sphere to get a stable object-space radius
    const bbox = new THREE.Box3().setFromObject(wheel);
    const sphere = bbox.getBoundingSphere(new THREE.Sphere());
    const modelRadiusCurrent = sphere.radius || 0.5;
    const currentScale = (wheel.scale && wheel.scale.x) ? wheel.scale.x : 1;
    // model radius at scale = 1 (object-space radius)
    const modelRadiusAtScale1 = modelRadiusCurrent / currentScale || 1e-6;

        // pixels per world unit assuming a canonical depth of 1. This deliberately
        // ignores the actual object depth so the resulting scale is driven only by
        // the 2D pixel target (desiredPixelRadius).
        const fovRad = (camera.fov || 50) * Math.PI / 180.0;
        const pxPerWorldUnitAtZ1 = (renderer.domElement.clientHeight || window.innerHeight) / (2 * Math.tan(fovRad / 2));

        let targetScale = 1;
        if (modelRadiusAtScale1 > 1e-8 && pxPerWorldUnitAtZ1 > 1e-8) {
          // scale that maps the model's radius (at scale=1) to desiredPixelRadius
          targetScale = (desiredPixelRadius) / (modelRadiusAtScale1 * pxPerWorldUnitAtZ1);
        }
    // clamp only the minimum to prevent degenerate tiny scales; allow large sizes
    targetScale = Math.max(targetScale, 0.05);
        // smooth towards target more responsively so changes are visible
        const desiredScaleVec = new THREE.Vector3(targetScale, targetScale, targetScale);
        wheel.scale.lerp(desiredScaleVec, 0.75);
    } catch (e) { console.warn('scale adjust error', e); }
  }

  pushPoint(r, thetaDeg);

  overlayCtx.restore();
}

function drawStatus(text) {
  overlayCtx.save();
  overlayCtx.fillStyle = 'rgba(0,0,0,0.45)';
  overlayCtx.fillRect(10, 10, 240, 36);
  overlayCtx.fillStyle = 'white';
  overlayCtx.font = '16px system-ui, Arial';
  overlayCtx.fillText(text, 16, 34);
  overlayCtx.restore();
  // also update debug DIV for environments where canvas may not render
  try {
    const dbg = document.getElementById('debug');
    if (dbg) dbg.textContent = String(text);
  } catch (e) {}
}

async function init() {
  setupThree();
  setupCharts();
  drawStatus('Initializing...');
  // wire flip button
  try {
    const on = document.getElementById('mirrorOn');
    const off = document.getElementById('mirrorOff');
    const applyVideoMirror = () => { if (video) video.style.transform = mirrorVideo ? 'scaleX(-1)' : 'none'; };
    // apply initial mirror state to the visible video
    applyVideoMirror();
    if (on) on.addEventListener('click', () => { mirrorVideo = true; autoMirrorChecked = true; applyVideoMirror(); drawStatus('mirrorVideo=true'); });
    if (off) off.addEventListener('click', () => { mirrorVideo = false; autoMirrorChecked = true; applyVideoMirror(); drawStatus('mirrorVideo=false'); });
  } catch (e) {}
  // initialize MediaPipe Hands
  hands = new Hands({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
  hands.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.7, minTrackingConfidence: 0.7 });
  hands.onResults(onResults);

  // Try to use MediaPipe Camera helper first; if it fails, fallback to getUserMedia
  try {
    if (typeof Camera !== 'undefined') {
      const cam = new Camera(video, {
        onFrame: async () => {
          try {
            // ensure offscreen canvas exists and matches video size
            if (!mpCanvas) {
              mpCanvas = document.createElement('canvas'); mpCtx = mpCanvas.getContext('2d');
            }
            if (video.videoWidth && video.videoHeight) {
              if (mpCanvas.width !== video.videoWidth || mpCanvas.height !== video.videoHeight) {
                mpCanvas.width = video.videoWidth; mpCanvas.height = video.videoHeight;
              }
            }
            if (mirrorVideo && mpCtx) {
              // draw flipped frame into mpCanvas and send that to MediaPipe
              mpCtx.save();
              mpCtx.scale(-1, 1);
              mpCtx.drawImage(video, -mpCanvas.width, 0, mpCanvas.width, mpCanvas.height);
              mpCtx.restore();
              await hands.send({ image: mpCanvas });
            } else {
              await hands.send({ image: video });
            }
          } catch (e) { /* ignore per-frame errors */ }
        },
        width: 1280, height: 720
      });
      await cam.start();
      // occasionally the camera helper may not expose frames until permissions approved
      console.log('MediaPipe Camera started');
      drawStatus('Camera started (MediaPipe Camera)');
      // start a small debug loop to draw the video into overlay for visibility
      (function debugDraw() {
        if (video && video.readyState >= 2) {
          try {
              // ensure overlay and renderer sizes match the video frame for correct projection
              overlay.width = video.videoWidth;
              overlay.height = video.videoHeight;
              onResize();
          } catch (e) {}
        } else {
          drawStatus('Waiting for camera frames...');
        }
        setTimeout(debugDraw, 1000/15);
      })();
      return;
    } else {
      throw new Error('MediaPipe Camera helper not available');
    }
    } catch (e) {
    console.warn('MediaPipe Camera could not be started, falling back to getUserMedia:', e);
    await fallbackGetUserMedia();
  }
}

async function fallbackGetUserMedia() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    drawStatus('No camera available');
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false });
    video.srcObject = stream;
    await video.play();
    drawStatus('Camera stream started (fallback)');
    // start a frame loop that draws the video and sends frames to MediaPipe
    const loop = async () => {
      if (video.readyState >= 2) {
        try {
          overlay.width = video.videoWidth;
          overlay.height = video.videoHeight;
          onResize();
        } catch (e) {
          // drawing may fail if video not ready
        }
        try {
          // prepare mpCanvas if needed
          if (!mpCanvas) { mpCanvas = document.createElement('canvas'); mpCtx = mpCanvas.getContext('2d'); }
          if (video.videoWidth && video.videoHeight) {
            if (mpCanvas.width !== video.videoWidth || mpCanvas.height !== video.videoHeight) {
              mpCanvas.width = video.videoWidth; mpCanvas.height = video.videoHeight;
            }
          }
          if (mirrorVideo && mpCtx) {
            mpCtx.save();
            mpCtx.scale(-1, 1);
            mpCtx.drawImage(video, -mpCanvas.width, 0, mpCanvas.width, mpCanvas.height);
            mpCtx.restore();
            await hands.send({ image: mpCanvas });
          } else {
            await hands.send({ image: video });
          }
        } catch (e) {
          // continue even if hands.send fails
        }
      } else {
        drawStatus('Waiting for camera...');
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  } catch (err) {
    console.error('getUserMedia error', err);
    drawStatus('Camera access denied or unavailable');
  }
}

// Surface unexpected errors on the overlay so the user can see them
window.addEventListener('error', (ev) => {
  console.error('Unhandled Error', ev.error || ev.message);
  try { drawStatus('Error: ' + (ev.error?.message || ev.message)); } catch (e) {}
});
window.addEventListener('unhandledrejection', (ev) => {
  console.error('Unhandled Rejection', ev.reason);
  try { drawStatus('Promise Rejection: ' + (ev.reason?.message || ev.reason)); } catch (e) {}
});

init();
