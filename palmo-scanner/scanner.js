import { HandLandmarker, FilesetResolver }
  from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs";

const MQTT_URL = "ws://localhost:9001";
const MQTT_TOPIC = "palmo/scanner";
const DEVICE_ID = "palm_scanner_web";
const TOPIC_POS_TX = "palmo/pos/tx";
const TOPIC_POS_RESPONSE = `palmo/pos/${DEVICE_ID}/response`;
const TOPIC_REGISTER = "palmo/register";
const TOPIC_REGISTER_RESP = "palmo/register/status";
const STABLE_PALM_SECONDS = 5;
const TOPIC_TOPUP = "palmo/topup";
const TOPIC_TOPUP_RESPONSE = `palmo/topup/${DEVICE_ID}/status`;

let mqttClient = null;
let handLandmarker = null;
let video = null;
let canvas = null;
let ctx = null;
let running = false;
let lastVideoTime = -1;
let palmStableFrames = 0;
const REQUIRED_STABLE_FRAMES = 30;
let lastPublishedHash = null;
let publishCooldown = false;
let currentMode = "none";
let currentName = "name";
let currentBalance = 0;
let currentAmount = 0;
let currentTopupAmount  = 0;
let stablePalmStartTime = null;
let scanTriggered = false;
let awaitingResponse = false;

class PalmHasher {
  constructor() {
    this.featureBuffer = [];
    this.previousLevels = null;
  }

  pushLandmarks(landmarks) {
    const features = extractFeatures(landmarks);
    if (!features) return;

    this.featureBuffer.push(features);
    if (this.featureBuffer.length > SMOOTHING_WINDOW) {
      this.featureBuffer.shift();
    }
  }

  clear() {
    this.featureBuffer = [];
  }

  reset() {
    this.featureBuffer = [];
    this.previousLevels = null;
  }

  get progress() {
    return Math.min(this.featureBuffer.length / SMOOTHING_WINDOW, 1);
  }

  get ready() {
    return this.featureBuffer.length >= SMOOTHING_WINDOW;
  }

  getStableFeatures() {
    if (!this.ready) return null;

    const n = this.featureBuffer.length;
    const numFeatures = this.featureBuffer[0].length;

    const avg = new Array(numFeatures).fill(0);
    for (const f of this.featureBuffer) {
      for (let i = 0; i < numFeatures; i++) avg[i] += f[i] / n;
    }

    const variance = new Array(numFeatures).fill(0);
    for (const f of this.featureBuffer) {
      for (let i = 0; i < numFeatures; i++) {
        variance[i] += (f[i] - avg[i]) ** 2 / n;
      }
    }

    const stableAvg = [];
    const stableVar = [];
    const stableIdx = [];
    for (let i = 0; i < numFeatures; i++) {
      if (variance[i] < VARIANCE_THRESHOLD) {
        stableAvg.push(avg[i]);
        stableVar.push(variance[i]);
        stableIdx.push(i);
      }
    }

    return {
      avg: stableAvg,
      variance: stableVar,
      indices: stableIdx,
      count: stableAvg.length
    };
  }

  quantize(values, indices) {
    const bits = [];
    const newLevels = [];

    for (let k = 0; k < values.length; k++) {
      const idx = indices[k];
      const value = values[k];
      const [min, max] = FEATURE_RANGES[idx] || [0, 1];

      const range = max - min;
      const norm = Math.max(0, Math.min(1, (value - min) / range));

      let level = Math.min(NUM_LEVELS - 1, Math.floor(norm * NUM_LEVELS));

      if (this.previousLevels && this.previousLevels[k] !== undefined) {
        const prev = this.previousLevels[k];
        if (level !== prev) {
          const interval = 1 / NUM_LEVELS;
          const boundary = level > prev
            ? prev * interval + interval
            : prev * interval;
          if (Math.abs(norm - boundary) < HYSTERESIS_MARGIN * interval) {
            level = prev;
          }
        }
      }

      newLevels.push(level);

      for (let b = Math.log2(NUM_LEVELS) - 1; b >= 0; b--) {
        bits.push((level >> b) & 1);
      }
    }

    this.previousLevels = newLevels;
    return bits;
  }

  /**
   *  { ok: true, hash, bitString, featureCount, avgVariance }
   * or { ok: false, reason, ... }
   */
  async generateHash() {
    const stable = this.getStableFeatures();

    if (!stable) {
      return { ok: false, reason: "not_ready", progress: this.progress };
    }
    if (stable.count < MIN_STABLE_FEATURES) {
      return {
        ok: false,
        reason: "not_enough_stable_features",
        count: stable.count,
        required: MIN_STABLE_FEATURES
      };
    }

    const bits = this.quantize(stable.avg, stable.indices);
    const bitString = bits.join("");
    const hash = await sha256(bitString);

    return {
      ok: true,
      hash,
      bitString,
      featureCount: stable.count,
      avgVariance: stable.variance.reduce((a, b) => a + b, 0) / stable.count
    };
  }
}
const palmHasher = new PalmHasher();

async function main() {
  bindUI();
  connectMQTT();

  await initHandLandmarker();
  await startCamera();

  running = true;
  requestAnimationFrame(detectLoop);
  console.log("Scanner ready");
}

document.addEventListener("DOMContentLoaded", () => {
  main().catch(err => console.error("Init error:", err));
});

function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

function showScannerOverlay() {
  document.getElementById("scanner-overlay").classList.remove("hidden");
}

function hideScannerOverlay() {
  document.getElementById("scanner-overlay").classList.add("hidden");
  document.getElementById("scan-line").classList.remove("active");
}

function bindUI() {
  document.getElementById("btn-go-payment").addEventListener("click", () => {
    showScreen("screen-payment");
  });
    document.getElementById("btn-go-topup").addEventListener("click", () => {
    showScreen("screen-topup");
  });
  document.getElementById("btn-go-register").addEventListener("click", () => {
    showScreen("screen-register");
  });

  document.getElementById("btn-payment-back").addEventListener("click", () => {
    showScreen("screen-mode");
  });
  document.getElementById("btn-payment-start").addEventListener("click", () => {
    const amount = parseFloat(document.getElementById("payment-amount").value);
    if (!amount || amount <= 0) {
      alert("Enter correct amount");
      return;
    }
    startPaymentFlow(amount);
  });

  document.getElementById("btn-topup-back").addEventListener("click", () => {
    showScreen("screen-mode");
  });
  document.getElementById("btn-topup-start").addEventListener("click", () => {
    const amount = parseFloat(document.getElementById("topup-amount").value);
    if (!amount || amount <= 0) { alert("Enter correct amount"); return; }
    startTopupFlow(amount);
  });

  document.getElementById("btn-register-back").addEventListener("click", () => {
    showScreen("screen-mode");
  });
  document.getElementById("btn-register-start").addEventListener("click", () => {
    const name = document.getElementById("register-name").value.trim();
    const balance = parseFloat(document.getElementById("register-balance").value) || 0;
    if (!name) {
      alert("Enter username");
      return;
    }
    startRegistrationFlow(name, balance);
  });

  document.getElementById("btn-result-back").addEventListener("click", () => {
    resetScanSession();
    showScreen("screen-mode");
  });

  document.getElementById("btn-cancel-scan").addEventListener("click", () => {
    resetScanSession();
    hideScannerOverlay();
    showScreen("screen-mode");
  });
}

// ─── MQTT ───────────────────────────────────────────────────
function connectMQTT() {
  console.log("Connecting to MQTT...", MQTT_URL);

  mqttClient = mqtt.connect(MQTT_URL, {
    clientId: `palmo_scanner_${Math.random().toString(16).slice(2, 8)}`,
    clean: true,
    reconnectPeriod: 2000,
    connectTimeout: 5000
  });

  mqttClient.on("connect", () => {
    console.log("MQTT connected");
    updateMqttStatus("Connected");
    mqttClient.subscribe(TOPIC_POS_RESPONSE,  { qos: 1 });
    mqttClient.subscribe(TOPIC_TOPUP_RESPONSE, { qos: 1 });
    mqttClient.subscribe(TOPIC_REGISTER_RESP, { qos: 1 });
  });

  mqttClient.on("reconnect", () => updateMqttStatus("Reconnecting..."));
  mqttClient.on("error", (err) => {
    console.error("MQTT error:", err.message);
    updateMqttStatus("Error: " + err.message);
  });
  mqttClient.on("close", () => updateMqttStatus("Disconnected"));

  mqttClient.on("message", handleMqttMessage);
}

function handleMqttMessage(topic, message) {
  let response;
  try {
    response = JSON.parse(message.toString());
  } catch (e) {
    console.warn("Bad MQTT message:", message.toString());
    return;
  }

  if (topic === TOPIC_POS_RESPONSE && currentMode === "payment" && awaitingResponse) {
    awaitingResponse = false;
    showPaymentResult(response);
    return;
  }

  if (topic === TOPIC_TOPUP_RESPONSE && currentMode === "topup" && awaitingResponse) {
    awaitingResponse = false;
    showTopupResult(response);
    return;
  }

  if (topic === TOPIC_REGISTER_RESP && currentMode === "registration" && awaitingResponse) {
    awaitingResponse = false;
    showRegistrationResult(response);
    return;
  }
}

function startPaymentFlow(amount) {
  currentMode = "payment";
  currentAmount = amount;
  currentName = "";
  currentBalance = 0;

  resetScanSession();
  showScannerOverlay();
  updateStatus(`PAYMENT ${amount} EUR - Show palm`);
}
function startTopupFlow(amount) {
  currentMode = "topup";
  currentTopupAmount = amount;
  currentAmount = 0;
  currentName = "";
  currentBalance = 0;

  resetScanSession();
  showScannerOverlay();
  updateStatus(`Top-up for ${amount} EUR - show palm`);
}
function startRegistrationFlow(name, balance) {
  currentMode = "registration";
  currentName = name;
  currentBalance = balance;
  currentAmount = 0;

  resetScanSession();
  showScannerOverlay();
  updateStatus(`Registration ${name} - show palm`);
}

// MediaPipe -------------------------------------------------------------------------------------------------------------------------------------------------------
async function initHandLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
  );
  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: "hand_landmarker.task", delegate: "GPU" },
    runningMode: "VIDEO",
    numHands: 1,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5
  });
  console.log("HandLandmarker initialized");
}
function resetScanSession() {
  palmHasher.reset();
  stablePalmStartTime = null;
  scanTriggered       = false;
  awaitingResponse    = false;
  updateScanProgress(0);
  updateStatus("Waiting...");
}

async function startCamera() {
  video  = document.getElementById("webcam");
  canvas = document.getElementById("overlay");
  ctx    = canvas.getContext("2d");

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480, facingMode: "user" }
  });
  video.srcObject = stream;
  await video.play();

  await new Promise(resolve => {
    if (video.videoWidth > 0) return resolve();
    video.onloadedmetadata = () => resolve();
  });

  canvas.width  = video.videoWidth;
  canvas.height = video.videoHeight;
  console.log("Camera started", canvas.width, "x", canvas.height);
}

function detectLoop() {
  if (!running) return;

  const overlayVisible =
    !document.getElementById("scanner-overlay").classList.contains("hidden");

  if (overlayVisible && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;

    const results = handLandmarker.detectForVideo(video, performance.now());
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (results.landmarks && results.landmarks.length > 0) {
      const landmarks = results.landmarks[0];
      drawLandmarks(landmarks);

      if (isOpenPalm(landmarks)) {
        palmHasher.pushLandmarks(landmarks);
        handleStablePalm();
      } else {
        palmHasher.clear();
        handlePalmLost();
      }
    } else {
      palmHasher.clear();
      handlePalmLost();
    }
  }

  requestAnimationFrame(detectLoop);
}
const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],
  [0,17]
];
function handleStablePalm() {
  if (scanTriggered || awaitingResponse) return;

  if (stablePalmStartTime === null) {
    stablePalmStartTime = performance.now();
  }
  const elapsed  = (performance.now() - stablePalmStartTime) / 1000;
  const progress = Math.min(elapsed / STABLE_PALM_SECONDS, 1);

  updateScanProgress(progress);
  updateStatus(`Scanning... ${elapsed.toFixed(1)} / ${STABLE_PALM_SECONDS} с`);

  if (elapsed >= STABLE_PALM_SECONDS && palmHasher.ready) {
    scanTriggered = true;
    triggerScan();
  }
}

function handlePalmLost() {
  if (scanTriggered) return;
  stablePalmStartTime = null;
  updateScanProgress(0);
  updateStatus("Show open palm");
}

function drawLandmarks(landmarks) {
  const w = canvas.width;
  const h = canvas.height;

  ctx.strokeStyle = "#00e5ff";
  ctx.lineWidth = 2;
  for (const [i, j] of HAND_CONNECTIONS) {
    ctx.beginPath();
    ctx.moveTo(landmarks[i].x * w, landmarks[i].y * h);
    ctx.lineTo(landmarks[j].x * w, landmarks[j].y * h);
    ctx.stroke();
  }

  for (const lm of landmarks) {
    ctx.beginPath();
    ctx.arc(lm.x * w, lm.y * h, 4, 0, 2 * Math.PI);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = "#00e5ff";
    ctx.stroke();
  }
}

function isOpenPalm(landmarks) {
  const tips = [4, 8, 12, 16, 20];
  const pips = [3, 6, 10, 14, 18];
  let extendedCount = 0;

  for (let i = 0; i < 5; i++) {
    const tip = landmarks[tips[i]];
    const pip = landmarks[pips[i]];

    if (i === 0) {
      const refX = landmarks[5].x;
      if (Math.abs(tip.x - refX) > Math.abs(pip.x - refX)) {
        extendedCount++;
      }
    } else {
      if (tip.y < pip.y) {
        extendedCount++;
      }
    }
  }

  return extendedCount >= 4;
}

async function triggerScan() {
  if (awaitingResponse) return;

  document.getElementById("scan-line").classList.add("active");
  updateStatus("Hash generation");

  let result;
  try {
    result = await palmHasher.generateHash();
  } catch (e) {
    console.error("Hash generation error:", e);
    updateStatus("Hash generation error");
    resetScanAttempt();
    return;
  }

  if (!result.ok) {
    console.warn("Hash failed:", result);
    updateStatus(`Not enough stable features (${result.count ?? 0}/${result.required ?? 10})`);
    resetScanAttempt();
    return;
  }

  console.log(
    `Features: ${result.featureCount}, ` +
    `hash: ${result.hash.slice(0, 16)}...`
  );

  if (!mqttClient || !mqttClient.connected) {
    updateStatus("MQTT not connected");
    resetScanAttempt();
    return;
  }

  awaitingResponse = true;

  if (currentMode === "topup") {
    const payload = {
      hash:      result.hash,
      amount:    currentTopupAmount,
      timestamp: Date.now(),
      deviceId:  DEVICE_ID
    };
    mqttClient.publish(TOPIC_TOPUP, JSON.stringify(payload), { qos: 1 });
    console.log("TOPUP:", payload);
    updateStatus("Waiting for response");
    return;
  }

  if (currentMode === "payment") {
    const payload = {
      deviceId: DEVICE_ID,
      hash:     result.hash,
      amount:   currentAmount,
      timestamp: Date.now()
    };
    mqttClient.publish(TOPIC_POS_TX, JSON.stringify(payload), { qos: 1 });
    console.log("POS TX:", payload);
    updateStatus("Waiting for response");
  } else if (currentMode === "registration") {
    const payload = {
      hash:     result.hash,
      name:     currentName,
      balance:  currentBalance,
      timestamp: Date.now()
    };
    mqttClient.publish(TOPIC_REGISTER, JSON.stringify(payload), { qos: 1 });
    console.log("REGISTER:", payload);
    updateStatus("Waiting for response...");
  }
}

async function onScanClick() {
  if (publishCooldown) {
    console.log("Cooldown active, skip");
    return;
  }
  if (palmStableFrames < REQUIRED_STABLE_FRAMES) {
    updateStatus("Keep plam in frame");
    return;
  }

  const userId = document.getElementById("userId").value.trim() || "user_001";

  const results = handLandmarker.detectForVideo(video, performance.now());
  if (!results.landmarks || results.landmarks.length === 0) {
    updateStatus("Lost palm try again");
    return;
  }

  const landmarks = results.landmarks[0];

  // const scanLine = document.getElementById("scan-line");
  // scanLine.classList.add("active");
  // updateStatus("Scanning");
  publishCooldown = true;

  await new Promise(r => setTimeout(r, 1500));

  try {
    const result = await palmHasher.generateHash();

    if (!result.ok) {
      console.warn("Hash generation failed:", result);
      updateStatus(
        result.reason === "not_ready"
          ? "wait still for more frames"
          : `Not enough stable features (${result.count}/${result.required})`
      );
      return;
    }

    console.log(
      `Features: ${result.featureCount}, ` +
      `avg variance: ${result.avgVariance.toFixed(6)}, ` +
      `bits: ${result.bitString.length}`
    );
    lastPublishedHash = result.hash;

    const payload = JSON.stringify({
      deviceId: "palm_scanner_sim",
      palmHash: result.hash,
      gesture: "Open_Palm",
      timestamp: new Date().toISOString(),
      source: "mediapipe_web"
    });

    if (!mqttClient || !mqttClient.connected) {
      updateStatus("MQTT not connected");
      updateMqttStatus("Not connected");
      return;
    }

    mqttClient.publish(MQTT_TOPIC, payload, { qos: 1 }, (err) => {
      if (err) {
        console.error("Publish error:", err);
        updateMqttStatus("Publish error");
      } else {
        console.log("Published:", payload);
        updateMqttStatus("Hash sent");
        document.getElementById("hash-output").textContent = result.hash;
        document.getElementById("result-panel").classList.remove("hidden");
        updateStatus("Scan ended");
      }
    });
  } catch (err) {
    console.error("Scan error:", err);
    updateStatus("scan error");
  } finally {
    setTimeout(() => { publishCooldown = false; }, 1000);
  }
}

function updateStatus(text) {
  const el = document.getElementById("scan-status");
  if (el) el.textContent = text;
}

function updateMqttStatus(text) {
  const el = document.getElementById("mqtt-status");
  if (el) el.textContent = text;
}

function updateScanProgress(progress) {
  const el = document.getElementById("scan-progress");
  if (el) el.style.width = `${progress * 100}%`;
}

function showPaymentResult(response) {
  hideScannerOverlay();

  const title = document.getElementById("result-title");
  const body  = document.getElementById("result-body");

  if (response.status === "APPROVED") {
    title.textContent = "Payment approved";
    body.innerHTML = `
      <p>Amount: <b>${currentAmount} EUR</b></p>
      <p>Remaining: <b>${response.remainingBalance ?? "—"} EUR</b></p>
    `;
  } else {
    title.textContent = "Payment declined";
    body.innerHTML = `
      <p>Amount: <b>${currentAmount} EUR</b></p>
      <p>reason: <b>${response.reason ?? "unknown"}</b></p>
    `;
  }
  showScreen("screen-result");
}

function showTopupResult(response) {
  hideScannerOverlay();

  const title = document.getElementById("result-title");
  const body  = document.getElementById("result-body");

  if (response.status === "SUCCESS") {
    title.textContent = "Succesfull topup";
    body.innerHTML = `
      <p>Topup amount: <b>${currentTopupAmount} EUR</b></p>
      <p>Result: <b>${response.message ?? "balance updated"}</b></p>
    `;
  } else {
    title.textContent = "Topup declined";
    body.innerHTML = `
      <p>Topup amount: <b>${currentTopupAmount} EUR</b></p>
      <p>Reason: <b>${response.reason ?? response.message ?? "unknown"}</b></p>
    `;
  }
  showScreen("screen-result");
}

function showRegistrationResult(response) {
  hideScannerOverlay();

  const title = document.getElementById("result-title");
  const body  = document.getElementById("result-body");

  if (response.status === "SUCCESS") {
    title.textContent = "SUCCESFUL REGISTRATION";
    body.innerHTML = `
      <p>User: <b>${currentName}</b></p>
      <p>Initial balance: <b>${currentBalance} EUR</b></p>
      <p>Result: <b>${response.message ?? "registered"}</b></p>
    `;
  } else {
    title.textContent = "Registration error";
    body.innerHTML = `
      <p>User: <b>${currentName}</b></p>
      <p>Reason: <b>${response.reason ?? response.message ?? "unknown"}</b></p>
    `;
  }
  showScreen("screen-result");
}


//////////////////////////////////////////////////////////////////////////////////////////////

const FINGER_CHAINS = [
  [2, 3, 4],         // thumb: MCP → IP → TIP
  [5, 6, 7, 8],      // index: MCP → PIP → DIP → TIP
  [9, 10, 11, 12],   // middle
  [13, 14, 15, 16],  // ring
  [17, 18, 19, 20]   // pinky
];
const FINGER_TIPS = [4, 8, 12, 16, 20];
const FINGER_MCPS = [5, 9, 13, 17];
const WRIST = 0;
const MIDDLE_MCP = 9;

const FEATURE_RANGES = [
  // Thumb (2)
  [0.10, 0.40], [0.10, 0.40],
  // Index (3)
  [0.15, 0.45], [0.10, 0.30], [0.08, 0.25],
  // Middle (3)
  [0.18, 0.48], [0.12, 0.32], [0.09, 0.25],
  // Ring (3)
  [0.16, 0.45], [0.11, 0.30], [0.08, 0.24],
  // Pinky (3)
  [0.12, 0.38], [0.08, 0.25], [0.06, 0.20],
  // tips of fingers etween themselves (4)
  [0.30, 0.75], [0.25, 0.65], [0.25, 0.65], [0.20, 0.60],
  // finger bases between themselves (3)
  [0.15, 0.45], [0.15, 0.42], [0.15, 0.45],
  // width/len of palm (1)
  [1.10, 2.00]
];

const NUM_LEVELS         = 4;       //
const SMOOTHING_WINDOW   = 15;      // 
const VARIANCE_THRESHOLD = 0.0005;  // 
const HYSTERESIS_MARGIN  = 0.15;    // 
const MIN_STABLE_FEATURES = 10;     //

function dist3(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

async function sha256(str) {
  const data = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}


function extractFeatures(landmarks) {
  const palmWidth = dist3(landmarks[5], landmarks[17]);
  if (palmWidth < 0.001) return null;

  const features = [];

  for (const chain of FINGER_CHAINS) {
    for (let i = 0; i < chain.length - 1; i++) {
      features.push(dist3(landmarks[chain[i]], landmarks[chain[i + 1]]) / palmWidth);
    }
  }

  for (let i = 0; i < FINGER_TIPS.length - 1; i++) {
    features.push(dist3(landmarks[FINGER_TIPS[i]], landmarks[FINGER_TIPS[i + 1]]) / palmWidth);
  }

  for (let i = 0; i < FINGER_MCPS.length - 1; i++) {
    features.push(dist3(landmarks[FINGER_MCPS[i]], landmarks[FINGER_MCPS[i + 1]]) / palmWidth);
  }

  features.push(dist3(landmarks[WRIST], landmarks[MIDDLE_MCP]) / palmWidth);

  return features;
}


//b9a8376bb60ac4345265571885de9ff448260752e4b6f4554651e3cf292d6f20
//24fd1f3d6120e46bacad0ddb1ec8725f7153ad36b68992c18687ac850e5c41ac
//6012529c1e3b7477d274191a70e3474f4b7e259bd0ad1b35f2b34dca2a2fb12e
//b4f79ba36eacdefe485bcf43f294c53f705def20d6c057212d9cdf57b1dd6700
//ccdf44a96799024c57bc80bab0b02c233dbe0af62e1473b2791471e2f24be505
//fa26f4bad683bbfcbc23463f56a2307985e6c593e27567db3514a35371be832b
//a4ee16e7741693b4d4e7587875ac219533b271c5a53368122d8e40d3db26ce6e
//a4ee16e7741693b4d4e7587875ac219533b271c5a53368122d8e40d3db26ce6e
//a4ee16e7741693b4d4e7587875ac219533b271c5a53368122d8e40d3db26ce6e
//a4ee16e7741693b4d4e7587875ac219533b271c5a53368122d8e40d3db26ce6e