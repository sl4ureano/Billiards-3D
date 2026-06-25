import * as THREE from "https://unpkg.com/three@0.165.0/build/three.module.js";
import { GLTFLoader } from "https://unpkg.com/three@0.165.0/examples/jsm/loaders/GLTFLoader.js";
import { RGBELoader } from "https://unpkg.com/three@0.165.0/examples/jsm/loaders/RGBELoader.js";
import * as CANNON from "/libs/cannon-es.js";

const TABLE_WIDTH = 8.4;
const TABLE_HEIGHT = 4.2;
const BALL_RADIUS = 0.11;
const POCKET_RADIUS = 0.38;
// A caçapa visual continua grande, mas a física não usa mais raio circular de captura.
// A bola só é removida quando o centro passa para a garganta interna da caçapa.
const CORNER_POCKET_MOUTH = BALL_RADIUS * 5.65;
const SIDE_POCKET_MOUTH = BALL_RADIUS * 5.8;
const CORNER_POCKET_THROAT_RADIUS = BALL_RADIUS * 2.85;
const SIDE_POCKET_THROAT_RADIUS = BALL_RADIUS * 2.25;
const JAW_LENGTH = BALL_RADIUS * 3.25;
const JAW_THICKNESS = BALL_RADIUS * 1.38;
const POCKET_VISUAL_RADIUS = POCKET_RADIUS * 0.78;
const POCKET_RAIL_GAP = POCKET_VISUAL_RADIUS * 2.35;
const RAIL_THICKNESS = 0.46;
const RAIL_HEIGHT = 0.42;
const TABLE_APRON = 0.42;
const CUE_PITCH = -0.13;
const FRICTION = 0.986;
const STOP_SPEED = 0.035;
const MAX_POWER = 32.0;
const RAIL_RESTITUTION = 0.82;
const BALL_MASS = 0.17;
const PHYSICS_STEP = 1 / 120;
const NET_SEND_INTERVAL = 33; // ~30 snapshots/s: estado leve, sem streaming de imagem
const NET_MAX_PREDICTION = 0.09;
const AI_PLAYER_ID = 2;
const AI_DIFFICULTIES = {
  easy: { label: "Fácil", error: 0.34, power: [0.32, 0.58], think: [900, 1450], safety: 0.50 },
  normal: { label: "Normal", error: 0.18, power: [0.45, 0.74], think: [650, 1100], safety: 0.32 },
  hard: { label: "Difícil", error: 0.08, power: [0.55, 0.88], think: [420, 780], safety: 0.18 },
  extreme: { label: "Extremamente difícil", error: 0.028, power: [0.62, 1.0], think: [260, 520], safety: 0.08 }
};
const TABLE_MODEL_SCALE = 3.05;
const BALL_CENTER_Y = BALL_RADIUS + 0.006;
const BALL_TEXTURE_PATH = "/assets/pool-table/";
const TABLE_OUT_MARGIN = BALL_RADIUS * 2.2; // margem maior para evitar falso positivo por jitter/impacto na tabela
const OUTSIDE_FRAMES_TO_FOUL = 8; // só marca falta se a bola ficar fora por vários frames
const BALL_IN_HAND_STEP = 0.13;
const SHOT_CLOCK_SECONDS = 60;
const HEAD_STRING_X = -2.1;
const CUE_BALL_START = new THREE.Vector2(-2.5, 0);
const CUE_BALL_MIN_PLACE_DISTANCE = BALL_RADIUS * 2.28;

const canvas = document.querySelector("#scene");
const statusEl = document.querySelector("#status");
const codeEl = document.querySelector("#code");
const qrEl = document.querySelector("#qr");
const linkEl = document.querySelector("#controlLink");
const spectatorLinkEl = document.querySelector("#spectatorLink");
const playLinkEl = document.querySelector("#playLink");
const turnEl = document.querySelector("#turn");
const playersEl = document.querySelector("#players");
const powerMeter = document.querySelector("#powerMeter");
const resetBtn = document.querySelector("#resetBtn");
const assignmentsEl = document.querySelector("#assignments");
const audioBtn = document.querySelector("#audioBtn");
const aiModeEl = document.querySelector("#aiMode");
const shotTimerEl = document.querySelector("#shotTimer");
const winnerOverlayEl = document.querySelector("#winnerOverlay");
const winnerTitleEl = document.querySelector("#winnerTitle");
const winnerReasonEl = document.querySelector("#winnerReason");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x080b0d);
// Salão mais escuro, com a mesa como foco principal. Mantém fundo não-preto em zoom aberto.
scene.fog = new THREE.Fog(0x080b0d, 34, 105);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setClearColor(0x12181b, 1);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;

const world = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, 0) });
world.allowSleep = true;
world.broadphase = new CANNON.SAPBroadphase(world);
world.defaultContactMaterial.friction = 0.08;
world.defaultContactMaterial.restitution = 0.92;

const ballMaterial = new CANNON.Material("ball");
const railMaterial = new CANNON.Material("rail");
world.addContactMaterial(new CANNON.ContactMaterial(ballMaterial, ballMaterial, {
  friction: 0.02,
  restitution: 0.96
}));
world.addContactMaterial(new CANNON.ContactMaterial(ballMaterial, railMaterial, {
  friction: 0.01,
  restitution: RAIL_RESTITUTION
}));

const textureLoader = new THREE.TextureLoader();

const camera = new THREE.PerspectiveCamera(42, 1, 0.03, 520);
const cameraTarget = new THREE.Vector3();
const cameraOrbit = {
  radius: 8.55,
  theta: 0,
  phi: 0.8
};
let cameraDrag = null;
camera.position.set(0, 5.9, 6.1);
camera.lookAt(0, 0, 0);

// Iluminação estilo salão de sinuca: ambiente baixo + pendente focado na mesa.
const ambient = new THREE.HemisphereLight(0xffefe0, 0x040608, 1.10);
scene.add(ambient);

const keyLight = new THREE.DirectionalLight(0xffead0, 0.30);
keyLight.position.set(-6.5, 8.5, 4.5);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.camera.near = 1;
keyLight.shadow.camera.far = 28;
scene.add(keyLight);

const editorTransformsKey = "billiards-editor-transforms";
const editableObjects = [];
let savedEditorTransforms = {};

function loadSavedTransforms() {
  const raw = localStorage.getItem(editorTransformsKey);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveEditorTransforms() {
  const transforms = {};
  for (const object of editableObjects) {
    if (!object.name || object.name === "professional-pool-table") continue;
    transforms[object.name] = {
      position: { x: object.position.x, y: object.position.y, z: object.position.z },
      rotation: { x: object.rotation.x, y: object.rotation.y, z: object.rotation.z }
    };
  }
  localStorage.setItem(editorTransformsKey, JSON.stringify(transforms));
  if (editorMode) statusEl && (statusEl.textContent = "Editor salvo");
}

function registerEditableObject(object, label) {
  if (!object || !object.isObject3D) return;
  const name = object.name || label || `editable-${editableObjects.length + 1}`;
  object.name = name;
  object.userData.isEditable = true;
  object.userData.editLabel = label || name;
  editableObjects.push(object);
  if (savedEditorTransforms[name]) {
    const saved = savedEditorTransforms[name];
    object.position.set(saved.position.x, saved.position.y, saved.position.z);
    object.rotation.set(saved.rotation.x, saved.rotation.y, saved.rotation.z);
  }
  if (editorMode) populateEditorObjectList();
}

function createEditorPanel() {
  const editorPanel = document.createElement("aside");
  editorPanel.className = "editor-panel";
  editorPanel.innerHTML = `
    <div class="editor-panel__header">
      <h2>Editor</h2>
      <button id="editorSaveBtn" type="button">Salvar</button>
    </div>
    <label class="editor-label">Objeto
      <select id="editorObjectSelect"></select>
    </label>
    <div class="editor-fields">
      <div class="editor-field-group">
        <label>X<input id="editorPosX" type="number" step="0.05"></label>
        <label>Y<input id="editorPosY" type="number" step="0.05"></label>
        <label>Z<input id="editorPosZ" type="number" step="0.05"></label>
      </div>
      <div class="editor-field-group">
        <label>Pitch (X)<input id="editorRotX" type="number" step="1"></label>
        <label>Yaw (Y)<input id="editorRotY" type="number" step="1"></label>
        <label>Roll (Z)<input id="editorRotZ" type="number" step="1"></label>
      </div>
      <div class="editor-rotation-buttons">
        <button class="editor-rotate-btn" type="button" data-axis="x" data-delta="-15">Pitch -15°</button>
        <button class="editor-rotate-btn" type="button" data-axis="x" data-delta="15">Pitch +15°</button>
        <button class="editor-rotate-btn" type="button" data-axis="y" data-delta="-15">Yaw -15°</button>
        <button class="editor-rotate-btn" type="button" data-axis="y" data-delta="15">Yaw +15°</button>
        <button class="editor-rotate-btn" type="button" data-axis="z" data-delta="-15">Roll -15°</button>
        <button class="editor-rotate-btn" type="button" data-axis="z" data-delta="15">Roll +15°</button>
      </div>
      <button id="editorApplyBtn" type="button">Aplicar</button>
    </div>
  `;
  document.body.appendChild(editorPanel);
  return editorPanel;
}

function populateEditorObjectList() {
  const select = document.querySelector("#editorObjectSelect");
  if (!select) return;
  const active = select.value;
  select.innerHTML = editableObjects
    .filter((object) => object.userData.isEditable && object.name !== "professional-pool-table")
    .map((object) => `<option value="${object.name}">${object.userData.editLabel || object.name}</option>`)
    .join("");
  if (active && [...select.options].some((option) => option.value === active)) {
    select.value = active;
  }
  if (!select.value && select.options.length > 0) {
    select.value = select.options[0].value;
  }
  updateEditorFields();
}

function updateEditorFields() {
  const select = document.querySelector("#editorObjectSelect");
  if (!select) return;
  const object = editableObjects.find((item) => item.name === select.value);
  const posX = document.querySelector("#editorPosX");
  const posY = document.querySelector("#editorPosY");
  const posZ = document.querySelector("#editorPosZ");
  const rotX = document.querySelector("#editorRotX");
  const rotY = document.querySelector("#editorRotY");
  const rotZ = document.querySelector("#editorRotZ");
  if (!object || !posX || !posY || !posZ || !rotX || !rotY || !rotZ) return;
  posX.value = object.position.x.toFixed(2);
  posY.value = object.position.y.toFixed(2);
  posZ.value = object.position.z.toFixed(2);
  rotX.value = (object.rotation.x * 180 / Math.PI).toFixed(0);
  rotY.value = (object.rotation.y * 180 / Math.PI).toFixed(0);
  rotZ.value = (object.rotation.z * 180 / Math.PI).toFixed(0);
}

function applyEditorValues() {
  const select = document.querySelector("#editorObjectSelect");
  if (!select) return;
  const object = editableObjects.find((item) => item.name === select.value);
  if (!object) return;
  const posX = Number(document.querySelector("#editorPosX")?.value || 0);
  const posY = Number(document.querySelector("#editorPosY")?.value || 0);
  const posZ = Number(document.querySelector("#editorPosZ")?.value || 0);
  const rotX = Number(document.querySelector("#editorRotX")?.value || 0);
  const rotY = Number(document.querySelector("#editorRotY")?.value || 0);
  const rotZ = Number(document.querySelector("#editorRotZ")?.value || 0);
  object.position.set(posX, posY, posZ);
  object.rotation.set(rotX * Math.PI / 180, rotY * Math.PI / 180, rotZ * Math.PI / 180);
}

function rotateEditorObject(axis, degrees) {
  const select = document.querySelector("#editorObjectSelect");
  if (!select) return;
  const object = editableObjects.find((item) => item.name === select.value);
  if (!object) return;
  const radians = degrees * Math.PI / 180;
  object.rotation[axis] += radians;
  updateEditorFields();
}

function initEditorMode() {
  savedEditorTransforms = loadSavedTransforms();
  createEditorPanel();
  populateEditorObjectList();
  document.querySelector("#editorObjectSelect")?.addEventListener("change", updateEditorFields);
  document.querySelectorAll(".editor-rotate-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const axis = button.dataset.axis;
      const delta = Number(button.dataset.delta) || 0;
      rotateEditorObject(axis, delta);
      saveEditorTransforms();
    });
  });
  document.querySelector("#editorApplyBtn")?.addEventListener("click", () => {
    applyEditorValues();
    saveEditorTransforms();
  });
  document.querySelector("#editorSaveBtn")?.addEventListener("click", saveEditorTransforms);
}

function isEditorMode() {
  const urlParams = new URLSearchParams(window.location.search);
  return /\/editor\b/.test(window.location.pathname) || urlParams.get("mode") === "editor";
}

const editorMode = isEditorMode();
if (editorMode) {
  savedEditorTransforms = loadSavedTransforms();
}

function addPoolTablePendantLighting() {
  const fixture = new THREE.Group();
  fixture.name = "pool-table-light-fixture";
  scene.add(fixture);

  const loader = new GLTFLoader();
  loader.load("/assets/pool-table/pool-table-light/source/model.glb", (gltf) => {
    const model = gltf.scene;
    model.name = "pool-table-light-model";
    model.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
      if (child.material) {
        child.material.envMapIntensity = 0.75;
        child.material.needsUpdate = true;
      }
    });
    registerEditableObject(model, "Luminária da mesa");

    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const longestHorizontal = Math.max(size.x, size.z, 0.001);
    const scale = (TABLE_WIDTH * 0.64) / longestHorizontal;
    model.scale.setScalar(scale);

    const scaledCenter = center.multiplyScalar(scale);
    const scaledSize = size.multiplyScalar(scale);
    model.position.set(-scaledCenter.x, 3.18 - scaledCenter.y + scaledSize.y * 0.5, -scaledCenter.z);
    fixture.add(model);
  });

  addPoolTablePendantLightSpots();
}

function addPoolTablePendantLightSpots() {
  const shadePositions = [-3.05, -1.02, 1.02, 3.05];
  for (const x of shadePositions) {
    const spot = new THREE.SpotLight(0xffefc9, 6.9, 7.4, 0.54, 0.62, 2.15);
    spot.position.set(x, 3.04, 0);
    spot.target.position.set(x * 0.72, 0.03, 0);
    spot.castShadow = true;
    spot.shadow.mapSize.set(2048, 2048);
    spot.shadow.camera.near = 0.18;
    spot.shadow.camera.far = 8.8;
    spot.shadow.bias = -0.00008;
    scene.add(spot);
    scene.add(spot.target);
  }

  const centerBoost = new THREE.SpotLight(0xfff7df, 2.05, 6.2, 0.38, 0.82, 2.3);
  centerBoost.position.set(0, 3.35, 0.15);
  centerBoost.target.position.set(0, 0.02, 0);
  centerBoost.castShadow = false;
  scene.add(centerBoost);
  scene.add(centerBoost.target);
}

function loadPoolRack() {
  const loader = new GLTFLoader();
  loader.load("/assets/pool-table/pool-rack/pool-rack.glb", (gltf) => {
    const rack = gltf.scene;
    rack.name = "pool-rack";
    rack.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.material) {
          child.material.envMapIntensity = 0.95;
          child.material.needsUpdate = true;
        }
      }
    });

    const box = new THREE.Box3().setFromObject(rack);
    const size = box.getSize(new THREE.Vector3());
    const longestHorizontal = Math.max(size.x, size.z, 0.001);
    const scale = (TABLE_WIDTH * 0.5) / longestHorizontal;
    rack.scale.setScalar(scale);

    // Orientação em pé para o rack, apoiado no chão.
    rack.rotation.set(-Math.PI * 0.5, Math.PI * 0.5, 0);

    const orientedBox = new THREE.Box3().setFromObject(rack);
    const rackCenter = orientedBox.getCenter(new THREE.Vector3());

    // Posição padrão do rack conforme solicitado no editor:
    rack.rotation.set(-Math.PI * 0.5, 0, 0);
    rack.position.set(
      -4.0 - rackCenter.x,
      -1.5 - orientedBox.min.y,
      -5.8 - rackCenter.z
    );
    registerEditableObject(rack, "Rack de tacos");
    tableGroup.add(rack);
  });
}

addPoolTablePendantLighting();

const warmBarLight = new THREE.PointLight(0xff9c54, 0.38, 11);
warmBarLight.position.set(5, 2.15, 3.5);
scene.add(warmBarLight);

const tableGroup = new THREE.Group();
scene.add(tableGroup);
buildTable();
loadPoolRack();
buildRailColliders();
buildRoom();
loadLightingEnvironment();

if (editorMode) initEditorMode();

const balls = [];
const ballMeshes = new Map();
const aim = {
  angle: 0,
  power: 0.45,
  spin: { x: 0, y: 0 },
  visible: true
};

const cueShot = {
  active: false,
  start: 0,
  duration: 360,
  impactAt: 0.58,
  impulseAt: 0.66,
  contactStarted: false,
  impactDone: false,
  power: 0,
  angle: 0,
  spin: { x: 0, y: 0 },
  origin: new THREE.Vector2(),
  hideAfterImpact: true
};

const gameState = {
  assignments: { 1: null, 2: null },
  pocketed: { solids: [], stripes: [], eight: [] },
  ballInHand: false,
  foul: null,
  winner: null,
  message: "",
  shot: null,
  breakShot: true,
  ai: { enabled: false, difficulty: "normal", thinking: false, timer: null },
  pendingRemoveChoice: null,
  shotClockEnabled: true,
  turnStartedAt: performance.now(),
  lastValidCueBallSpot: null,
  remoteShotClockRemaining: SHOT_CLOCK_SECONDS * 1000
};

const urlParams = new URLSearchParams(window.location.search);
const remoteTableMode = /\/(spectator|viewer|play)\b/.test(window.location.pathname) || ["spectator", "viewer", "play"].includes(urlParams.get("mode"));
const spectatorMode = remoteTableMode;
const playMode = /\/play\b/.test(window.location.pathname) || urlParams.get("mode") === "play";
let code = urlParams.get("code") || "";
let ws;
let players = [];
let currentTurn = 1;
let lastTime = performance.now();
let lastStateSent = 0;
let redirectingToController = false;
const remoteTargets = new Map();
let remoteCueState = null;
let ballInHandGraceUntil = 0;
let lastBallInHandFoul = null;
const keyboardState = {
  keys: new Set(),
  lastCameraSent: 0
};


const cueLine = makeCueLine();
scene.add(cueLine);
const trajectoryLine = makeTrajectoryLine();
scene.add(trajectoryLine);

const sound = createSoundManager();
installAudioUnlock();

resetGame();
if (spectatorMode) {
  if (resetBtn) {
    resetBtn.disabled = true;
    resetBtn.textContent = playMode ? "Mesa remota" : "Espectador";
  }
  document.body.classList.add(playMode ? "play-mode" : "spectator-mode");
}
resize();
window.addEventListener("resize", resize);
window.addEventListener("keydown", handleKeyboardDown);
window.addEventListener("keyup", handleKeyboardUp);
window.addEventListener("blur", () => keyboardState.keys.clear());
resetBtn?.addEventListener("click", () => { if (spectatorMode) return; sound.unlock(); resetGame(); });
canvas.addEventListener("pointerdown", (event) => {
  if (!editorMode) return;
  cameraDrag = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove", (event) => {
  if (cameraDrag && cameraDrag.pointerId === event.pointerId) {
    const dx = (event.clientX - cameraDrag.x) / canvas.clientWidth;
    const dy = (event.clientY - cameraDrag.y) / canvas.clientHeight;
    cameraOrbit.theta -= dx * 2.5;
    cameraOrbit.phi = clamp(cameraOrbit.phi + dy * 2.5, 0.38, 1.26);
    cameraDrag.x = event.clientX;
    cameraDrag.y = event.clientY;
    return;
  }
  if (!spectatorMode && !editorMode && !isAiControlledTurn()) updateAimFromPointer(event);
});
canvas.addEventListener("pointerup", (event) => {
  if (!editorMode || !cameraDrag) return;
  if (cameraDrag.pointerId === event.pointerId) {
    cameraDrag = null;
  }
});
canvas.addEventListener("pointercancel", () => {
  cameraDrag = null;
});
canvas.addEventListener("wheel", (event) => {
  // No editor, o scroll continua controlando o zoom da câmera.
  if (editorMode) {
    event.preventDefault();
    cameraOrbit.radius = clamp(cameraOrbit.radius + (event.deltaY > 0 ? 0.36 : -0.36), 5.3, 18.5);
    return;
  }

  // Durante a partida, o scroll controla a força da tacada para quem joga
  // sem controle conectado. Não mexe na física nem dispara tacada sozinho.
  if (spectatorMode || isAiControlledTurn() || gameState.winner || gameState.ballInHand || isMoving()) return;

  event.preventDefault();
  sound.unlock();

  const direction = event.deltaY < 0 ? 1 : -1;
  const step = event.shiftKey ? 0.025 : 0.055;
  aim.power = clamp(aim.power + direction * step, 0.12, 1);
  updateHud();
  sendState();
});
canvas.addEventListener("click", () => {
  if (spectatorMode || editorMode || isAiControlledTurn()) return;
  sound.unlock();
  shoot(aim.power);
});

if (!editorMode) connect();
requestAnimationFrame(loop);

async function connect() {
  if (!code && spectatorMode) {
    statusEl.textContent = "Codigo da sala ausente";
    return;
  }

  if (!code) {
    const response = await fetch("/new-session");
    const session = await response.json();
    code = session.code;
    history.replaceState(null, "", `/table?code=${code}`);
    showRoom(session);
  }

  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`);

  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({ type: spectatorMode ? "join-viewer" : "join-host", code }));
    statusEl.textContent = spectatorMode ? (playMode ? "Mesa remota online" : "Modo espectador online") : "Mesa online";
  });

  ws.addEventListener("message", (event) => {
    const msg = parseMessage(event.data);
    if (!msg) return;

    if (msg.type === "host-ready") {
      players = msg.players || [];
      code = msg.code;
      updateHud();
      hydrateRoomDetails();
    }

    if (msg.type === "viewer-ready") {
      players = msg.players || [];
      code = msg.code;
      statusEl.textContent = playMode ? `Mesa remota da sala ${code}` : `Espectando sala ${code}`;
      if (msg.snapshot) applyRemoteSnapshot(msg.snapshot);
      updateHud();
      hydrateRoomDetails();
    }

    if (msg.type === "state" && msg.snapshot && spectatorMode) {
      applyRemoteSnapshot(msg.snapshot);
    }

    if (msg.type === "host-occupied") {
      if (spectatorMode) return;
      redirectingToController = true;
      const target = msg.controllerUrl || `/controller?code=${encodeURIComponent(msg.code || code)}`;
      window.location.replace(target);
    }

    if (msg.type === "player-joined" || msg.type === "player-left") {
      players = msg.players || [];
      updateHud();
    }

    if (msg.type === "input") {
      handleInput(msg.playerId, msg.action, msg.value);
    }
  });

  ws.addEventListener("close", () => {
    if (redirectingToController) return;
    statusEl.textContent = "Reconectando...";
    setTimeout(connect, 900);
  });
}

async function hydrateRoomDetails() {
  try {
    const response = await fetch(`/session/${encodeURIComponent(code)}`);
    if (!response.ok) {
      showFallbackRoom();
      return;
    }
    const session = await response.json();
    showRoom(session);
  } catch {
    showFallbackRoom();
  }
}

function showFallbackRoom() {
  const url = new URL("/controller", window.location.origin);
  url.searchParams.set("code", code);
  const playUrl = new URL("/play", window.location.origin);
  playUrl.searchParams.set("code", code);
  const spectatorUrl = new URL("/spectator", window.location.origin);
  spectatorUrl.searchParams.set("code", code);
  showRoom({ code, controllerUrl: url.href, playUrl: playUrl.href, spectatorUrl: spectatorUrl.href });
}

function showRoom(session) {
  codeEl.textContent = session.code;

  const controllerUrl = session.controllerUrl || `/controller?code=${encodeURIComponent(session.code)}`;
  const playUrl = session.playUrl || `/play?code=${encodeURIComponent(session.code)}`;
  const spectatorUrl = session.spectatorUrl || `/spectator?code=${encodeURIComponent(session.code)}`;

  configureRoomAction(linkEl, controllerUrl, "🎮", "Controle", "Jogar");
  configureRoomAction(playLinkEl, playUrl, "🖥️", "Mesa remota", "Entrar na partida");
  configureRoomAction(spectatorLinkEl, spectatorUrl, "👁️", "Espectador", "Assistir");

  if (qrEl) {
    const qrUrl = session.qr || `/qr/${encodeURIComponent(session.code)}`;
    qrEl.innerHTML = "";
    const image = document.createElement("img");
    image.alt = `QR code do controle da sala ${session.code}`;
    image.src = qrUrl;
    image.addEventListener("error", () => {
      if (image.dataset.fallback === "1") {
        qrEl.textContent = "QR indisponivel";
        return;
      }
      image.dataset.fallback = "1";
      image.src = `/qr/${encodeURIComponent(session.code)}`;
    });
    qrEl.append(image);
  }
}

function configureRoomAction(anchor, url, icon, title, subtitle) {
  if (!anchor) return;
  anchor.href = url;
  anchor.title = `${title}: ${url}`;
  anchor.setAttribute("aria-label", `${title} - ${subtitle}`);
  anchor.innerHTML = `
    <span class="room-action-icon">${icon}</span>
    <span class="room-action-title">${title}</span>
    <small>${subtitle}</small>
    <span class="mini-qr" aria-hidden="true"><img alt="" src="/qr-link?url=${encodeURIComponent(url)}"></span>
  `;
}


function isEditableKeyboardTarget(target) {
  if (!target) return false;
  const tagName = String(target.tagName || "").toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select" || target.isContentEditable;
}

function handleKeyboardDown(event) {
  if (isEditableKeyboardTarget(event.target)) return;
  const code = event.code || event.key;

  if (["KeyW", "KeyA", "KeyS", "KeyD", "Enter", "NumpadEnter"].includes(code)) {
    event.preventDefault();
    sound.unlock();
  }

  if (code === "Enter" || code === "NumpadEnter") {
    if (!event.repeat) handleKeyboardAction();
    return;
  }

  if (["KeyW", "KeyA", "KeyS", "KeyD"].includes(code)) {
    keyboardState.keys.add(code);
  }
}

function handleKeyboardUp(event) {
  const code = event.code || event.key;
  if (["KeyW", "KeyA", "KeyS", "KeyD"].includes(code)) keyboardState.keys.delete(code);
}

function handleKeyboardAction() {
  if (spectatorMode || editorMode || isAiControlledTurn() || gameState.winner) return;

  // Enter vira o botão de ação do controle: confirma a branca na mão quando
  // ela está sendo posicionada; caso contrário executa a tacada do turno atual.
  if (gameState.ballInHand) {
    if (currentTurn === 1 || currentTurn === 2) {
      confirmCueBallInHand();
      updateHud();
      sendState();
    }
    return;
  }

  if (isMoving()) return;
  shoot(aim.power);
  updateHud();
  sendState();
}

function updateKeyboardInput(now) {
  if (!keyboardState.keys.size || editorMode) return;

  // WASD move a câmera continuamente, mesmo sem controle conectado.
  // Faz throttle para manter a sensação do controle sem girar rápido demais por frame.
  if (now - keyboardState.lastCameraSent < 16) return;
  keyboardState.lastCameraSent = now;

  if (keyboardState.keys.has("KeyA")) applyCameraInput("camera-left");
  if (keyboardState.keys.has("KeyD")) applyCameraInput("camera-right");
  if (keyboardState.keys.has("KeyW")) applyCameraInput("camera-up");
  if (keyboardState.keys.has("KeyS")) applyCameraInput("camera-down");
}

function isAiControlledTurn() {
  return !!gameState.ai.enabled && currentTurn === AI_PLAYER_ID && !spectatorMode && !gameState.winner;
}

function handleInput(playerId, action, value) {
  action = String(action || "");
  if (action === "audio-toggle" || action === "audio-set") {
    const desired = action === "audio-set" ? !!value : !sound.isEnabled();
    sound.setEnabled(desired);
    updateHud();
    sendState();
    return;
  }
  if (action === "reset-game") {
    if (!spectatorMode) {
      resetGame();
      updateHud();
      sendState();
    }
    return;
  }
  if (action === "set-ai-mode") {
    if (!spectatorMode) {
      setAiMode(value);
      updateHud();
      sendState();
    }
    return;
  }
  if (action === "set-shot-clock") {
    if (!spectatorMode) {
      gameState.shotClockEnabled = !!value;
      resetTurnClock();
      updateHud();
      sendState();
    }
    return;
  }
  sound.unlock();

  // No turno da IA, qualquer input humano de mira/câmera/tacada é ignorado.
  // Isso impede que o controle do jogador altere a mira global antes da IA aplicar a tacada.
  if (isAiControlledTurn()) {
    updateHud();
    return;
  }

  if (action === "camera-orbit") {
    applyCameraOrbit(value);
    return;
  }
  if (action.startsWith("camera-")) {
    applyCameraInput(action);
    return;
  }

  if (playerId !== currentTurn || isMoving()) return;

  if (gameState.ballInHand) {
    if (action === "place-cue" || action === "aim-vector") {
      moveCueBallInHand(value);
      updateHud();
      sendState();
      return;
    }
    if (action === "shoot") {
      confirmCueBallInHand();
      updateHud();
      sendState();
      return;
    }
    return;
  }

  if (action === "aim-left") aim.angle += 0.12;
  if (action === "aim-right") aim.angle -= 0.12;
  if (action === "fine-left") aim.angle += 0.035;
  if (action === "fine-right") aim.angle -= 0.035;
  if (action === "aim-angle") aim.angle = Number(value);
  if (action === "aim-vector") aim.angle = cameraRelativeAimAngle(value);
  if (action === "power") aim.power = clamp(Number(value), 0.12, 1);
  if (action === "spin") aim.spin = normalizeSpin(value);
  if (action === "shoot") {
    aim.power = clamp(Number(value), 0.12, 1);
    shoot(aim.power);
  }
  updateHud();
}

function resetGame() {
  for (const ball of balls) {
    if (ball.body) world.removeBody(ball.body);
  }
  balls.length = 0;
  gameState.assignments = { 1: null, 2: null };
  gameState.pocketed = { solids: [], stripes: [], eight: [] };
  gameState.ballInHand = false;
  gameState.foul = null;
  gameState.winner = null;
  gameState.message = "Mesa aberta";
  gameState.shot = null;
  gameState.breakShot = true;
  gameState.pendingRemoveChoice = null;
  gameState.turnStartedAt = performance.now();
  gameState.lastValidCueBallSpot = null;
  ballInHandGraceUntil = 0;
  lastBallInHandFoul = null;
  addBall("cue", null, 0xffffff, CUE_BALL_START.x, CUE_BALL_START.y);
  gameState.lastValidCueBallSpot = CUE_BALL_START.clone();

  const rackX = 1.45;
  const spacing = BALL_RADIUS * 2.08;
  const rack = [1, 9, 2, 10, 8, 3, 11, 4, 12, 5, 13, 6, 14, 7, 15];
  let index = 0;
  for (let row = 0; row < 5; row++) {
    for (let i = 0; i <= row; i++) {
      const x = rackX + row * spacing;
      const y = (i - row / 2) * spacing;
      const number = rack[index];
      addBall(`ball-${number}`, number, ballColor(number), x, y);
      index += 1;
    }
  }

  currentTurn = 1;
  aim.angle = 0;
  aim.power = 0.45;
  aim.spin = { x: 0, y: 0 };
  cueShot.active = false;
  updateHud();
}

function addBall(id, number, color, x, y) {
  const ball = {
    id,
    number,
    suit: ballSuit(number),
    color,
    position: new THREE.Vector2(x, y),
    velocity: new THREE.Vector2(),
    spin: new THREE.Vector2(),
    sunk: false,
    body: null,
    outsideFrames: 0
  };
  balls.push(ball);

  let mesh = ballMeshes.get(id);
  if (!mesh) {
    const geometry = new THREE.SphereGeometry(BALL_RADIUS, 48, 32);
    const material = makeBallMaterial(number, color);
    mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    ballMeshes.set(id, mesh);
    scene.add(mesh);
  } else {
    mesh.material = makeBallMaterial(number, color);
  }

  const body = new CANNON.Body({
    mass: BALL_MASS,
    position: new CANNON.Vec3(x, BALL_CENTER_Y, y),
    shape: new CANNON.Sphere(BALL_RADIUS),
    material: ballMaterial,
    linearDamping: 0.58,
    angularDamping: 0.62,
    allowSleep: true,
    sleepSpeedLimit: STOP_SPEED,
    sleepTimeLimit: 0.22
  });
  body.userData = { ball };
  body.addEventListener("collide", (event) => recordBallContact(ball, event));
  world.addBody(body);
  ball.body = body;

  mesh.userData.prevPosition = new THREE.Vector3(x, BALL_CENTER_Y, y);
  mesh.quaternion.identity();
  mesh.visible = true;
}

function loop(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.033);
  lastTime = now;

  if (!spectatorMode) {
    updateKeyboardInput(now);
    updateCueShot(now);
    stepPhysics(dt);
    updateShotClock(now);
    updateShotClockDisplay();
    maybeRunAiTurn();
  } else {
    applyRemoteInterpolation(dt);
    updateShotClockDisplay();
  }
  syncMeshes();
  updateCueLine(now);
  updateTrajectoryLine();
  updateCamera();
  renderer.render(scene, camera);

  if (!spectatorMode && now - lastStateSent > NET_SEND_INTERVAL) {
    lastStateSent = now;
    sendState();
  }

  requestAnimationFrame(loop);
}

function stepPhysics(dt) {
  const movingBefore = isMoving();
  const now = performance.now();

  world.step(PHYSICS_STEP, dt, 6);

  for (const ball of balls) {
    if (ball.sunk || !ball.body) continue;

    keepBallOnTablePlane(ball);
    applyBallSpin(ball, dt);
    ball.body.velocity.scale(Math.pow(FRICTION, dt * 60), ball.body.velocity);
    ball.body.angularVelocity.scale(Math.pow(0.984, dt * 60), ball.body.angularVelocity);

    const speed = horizontalSpeed(ball.body);
    if (speed < STOP_SPEED) {
      ball.body.velocity.x = 0;
      ball.body.velocity.z = 0;
      ball.body.angularVelocity.set(0, 0, 0);
      ball.body.sleep();
    }

    ball.position.set(ball.body.position.x, ball.body.position.z);
    ball.velocity.set(ball.body.velocity.x, ball.body.velocity.z);

    // Primeiro verifica caçapas. Depois verifica saída da mesa com tolerância.
    // Isso evita que uma bola perto da tabela/caçapa gere falso positivo de falta por 1 frame.
    if (!gameState.ballInHand) handlePockets(ball);

    if (
      !gameState.ballInHand &&
      !ball.sunk &&
      now >= ballInHandGraceUntil &&
      isBallOutsideTable(ball)
    ) {
      ball.outsideFrames = (ball.outsideFrames || 0) + 1;

      if (ball.outsideFrames >= OUTSIDE_FRAMES_TO_FOUL) {
        handleBallOffTable(ball);
        continue;
      }
    } else {
      ball.outsideFrames = 0;
    }
  }

  checkCueBallContacts();

  if (movingBefore && !isMoving()) {
    finishShot();
    updateHud();
  }
}

function keepBallOnTablePlane(ball) {
  ball.body.position.y = BALL_CENTER_Y;
  ball.body.velocity.y = 0;
}

function horizontalSpeed(body) {
  return Math.hypot(body.velocity.x, body.velocity.z);
}

function handleRails(ball) {
  const maxX = TABLE_WIDTH / 2 - BALL_RADIUS;
  const maxY = TABLE_HEIGHT / 2 - BALL_RADIUS;

  if (ball.position.x < -maxX || ball.position.x > maxX) {
    ball.position.x = clamp(ball.position.x, -maxX, maxX);
    ball.velocity.x *= -RAIL_RESTITUTION;
  }

  if (ball.position.y < -maxY || ball.position.y > maxY) {
    ball.position.y = clamp(ball.position.y, -maxY, maxY);
    ball.velocity.y *= -RAIL_RESTITUTION;
  }
}

function handlePockets(ball) {
  if (!ball.body || ball.sunk) return;

  // Não existe mais “raio de sucção” na boca da caçapa.
  // Os bicos/borrachas são colisores estáticos do Cannon; aqui só detectamos
  // a bola depois que o centro dela já passou pela boca e entrou na garganta.
  for (const pocket of pocketDefs()) {
    if (!isBallInsidePocketThroat(ball.body.position, pocket)) continue;

    ball.sunk = true;
    ball.outsideFrames = 0;
    ball.velocity.set(0, 0);
    ball.spin.set(0, 0);

    if (ball.body) {
      ball.body.velocity.set(0, 0, 0);
      ball.body.angularVelocity.set(0, 0, 0);
      if (world.bodies.includes(ball.body)) world.removeBody(ball.body);
    }

    sound.play("pocket", 1.0);

    if (ball.id === "cue") {
      registerFoul("Branca encaçapada");
      setCueBallInHand();
    } else {
      handlePottedBall(ball);
    }
    return;
  }
}

function isBallInsidePocketThroat(position, pocket) {
  const x = TABLE_WIDTH / 2;
  const z = TABLE_HEIGHT / 2;

  if (pocket.type === "side") {
    // Caçapa do meio é uma abertura reta na tabela longa.
    // A versão anterior exigia também estar dentro de um círculo pequeno
    // centrado no fundo visual da caçapa; em tacadas retas a bola batia/era
    // freada pelos jaws antes de satisfazer esse círculo e nunca encaçapava.
    // A física dos bicos continua sendo feita pelos corpos estáticos; aqui
    // apenas detectamos que o centro cruzou a boca aberta entre os jaws.
    const localZ = pocket.sz * position.z;
    const crossedMouth = localZ > z - BALL_RADIUS * 0.72;
    const withinMouth = Math.abs(position.x - pocket.x) < SIDE_POCKET_MOUTH * 0.5 - BALL_RADIUS * 0.18;
    const notPastPocketBack = localZ < z + BALL_RADIUS * 2.75;
    return crossedMouth && withinMouth && notPastPocketBack;
  }

  // Caçapas de canto: detecção por GARGANTA DIAGONAL, não por círculo.
  //
  // gapX/gapZ são as distâncias do centro da bola até as duas bordas internas
  // do canto, medidas no espaço local da caçapa. Em uma bola fazendo tabela na
  // quina, um desses gaps fica pequeno, mas o outro continua grande; por isso
  // ela não pode ser removida. Em uma bola que realmente entrou no canto, os
  // dois gaps ficam pequenos e equilibrados, atrás da linha diagonal formada
  // entre os dois jaws.
  const localX = pocket.sx * position.x;
  const localZ = pocket.sz * position.z;
  const gapX = x - localX;
  const gapZ = z - localZ;

  // Valores calibrados para os cantos:
  // 1) não detecta na quina/bico: se a bola está raspando uma borracha e ainda
  //    longe da outra, isso é jogada de tabela, não encaçapada;
  // 2) só detecta depois da linha diagonal entre os jaws;
  // 3) aceita a bola quando ela já está no copo visual interno, mesmo que venha
  //    com pequeno corte.
  const throatWidth = CORNER_POCKET_MOUTH * 0.70;
  const throatLine = CORNER_POCKET_MOUTH * 0.58;
  const maxImbalance = CORNER_POCKET_MOUTH * 0.36;
  const jawBankGuard = BALL_RADIUS * 0.82;
  const oppositeJawStillFar = BALL_RADIUS * 1.72;
  const pocketWellRadius = BALL_RADIUS * 1.55;

  const minGap = Math.min(gapX, gapZ);
  const maxGap = Math.max(gapX, gapZ);

  // Zona morta da tabela no bico da caçapa: a bola pode encostar no jaw e
  // voltar naturalmente pelo Cannon sem a lógica removê-la.
  const isBankingOnOneJaw = minGap > -BALL_RADIUS * 0.55 && minGap < jawBankGuard && maxGap > oppositeJawStillFar;
  if (isBankingOnOneJaw) return false;

  const insideCornerThroat =
    gapX > -BALL_RADIUS * 1.45 &&
    gapZ > -BALL_RADIUS * 1.45 &&
    gapX < throatWidth &&
    gapZ < throatWidth;

  const crossedDiagonalThroat = gapX + gapZ < throatLine;
  const enteredBetweenJaws = Math.abs(gapX - gapZ) < maxImbalance;
  const insidePocketWell = gapX * gapX + gapZ * gapZ < pocketWellRadius * pocketWellRadius;

  return insideCornerThroat && ((crossedDiagonalThroat && enteredBetweenJaws) || insidePocketWell);
}

function handlePottedBall(ball) {
  if (gameState.shot && !gameState.shot.pocketed.includes(ball.number)) {
    gameState.shot.pocketed.push(ball.number);
  }

  if (ball.suit === "eight") {
    // No 8-ball a bola 8 só é resolvida no fim da tacada.
    // Isso permite considerar falta na mesma tacada, branca encaçapada,
    // primeiro contato errado ou bola 8 antes da hora.
    if (!gameState.pocketed.eight.includes(ball.number)) gameState.pocketed.eight.push(ball.number);
    updateHud();
    return;
  }

  if (!gameState.pocketed[ball.suit].includes(ball.number)) {
    gameState.pocketed[ball.suit].push(ball.number);
  }
  updateHud();
}

function hasClearedOwnGroup(playerId) {
  const ownSuit = gameState.assignments[playerId];
  if (!ownSuit || ownSuit === "eight") return false;
  return targetNumbers(ownSuit).every((number) => gameState.pocketed[ownSuit].includes(number));
}

function endGame(winner, reason = "") {
  gameState.winner = winner;
  gameState.ballInHand = false;
  gameState.pendingRemoveChoice = null;
  gameState.foul = null;
  gameState.message = `Jogador ${winner} venceu${reason ? ` · ${reason}` : ""}`;
  cueShot.active = false;
  cueShot.contactStarted = false;
  cueShot.impactDone = false;
  updateHud();
  sendState();
}

function startShot() {
  gameState.foul = null;
  lastBallInHandFoul = null;
  ballInHandGraceUntil = 0;
  gameState.shot = {
    player: currentTurn,
    firstHit: null,
    pocketed: [],
    outOfTable: [],
    foul: null
  };
  gameState.message = "Tacada em andamento";
}

function finishShot() {
  if (!gameState.shot) return;

  const shot = gameState.shot;
  const player = shot.player;
  const opponent = player === 1 ? 2 : 1;
  const ownSuit = gameState.assignments[player];
  let keepTurn = false;

  if (gameState.winner) {
    gameState.shot = null;
    return;
  }

  if (!shot.firstHit && !shot.foul) registerFoul("Nenhuma bola foi atingida");

  if (shot.firstHit) {
    const firstSuit = ballSuit(shot.firstHit);
    if (ownSuit) {
      const ownCleared = hasClearedOwnGroup(player);
      const validEightHit = ownCleared && firstSuit === "eight";
      if (firstSuit !== ownSuit && !validEightHit) registerFoul("Primeiro contato na bola errada");
    } else if (firstSuit === "eight") {
      registerFoul("Primeiro contato na bola 8 com mesa aberta");
    }
  }

  const eightPocketed = shot.pocketed.includes(8);
  const foul = shot.foul || gameState.foul;

  if (eightPocketed) {
    gameState.shot = null;
    gameState.breakShot = false;

    if (foul) {
      endGame(opponent, `Jogador ${player} encaçapou a bola 8 cometendo falta`);
      return;
    }

    if (!ownSuit || !hasClearedOwnGroup(player)) {
      endGame(opponent, `Jogador ${player} encaçapou a bola 8 antes de limpar o grupo`);
      return;
    }

    endGame(player, `Jogador ${player} encaçapou todas as bolas e a bola 8`);
    return;
  }

  if (foul) {
    currentTurn = opponent;
    resetTurnClock();
    if (!gameState.ballInHand || lastBallInHandFoul !== foul) {
      gameState.ballInHand = true;
      lastBallInHandFoul = foul;
      gameState.message = `Falta: ${foul}. Jogador ${currentTurn} com bola na mão`;
      reviveCueForBallInHand();
    }
  } else {
    let activeSuit = ownSuit;

    if (!activeSuit && !gameState.assignments[1] && !gameState.assignments[2]) {
      const assignedSuit = shot.pocketed.map(ballSuit).find((suit) => suit === "solids" || suit === "stripes");
      if (assignedSuit) {
        gameState.assignments[player] = assignedSuit;
        gameState.assignments[opponent] = assignedSuit === "solids" ? "stripes" : "solids";
        activeSuit = assignedSuit;
        gameState.message = `Jogador ${player}: ${suitLabel(assignedSuit)}`;
      }
    }

    // 8-ball: acertar primeiro a bola correta NÃO mantém a vez por si só.
    // O jogador só continua se encaçapar legalmente pelo menos uma bola do próprio grupo
    // na tacada atual. Se acertou certo, mas nada caiu, passa a vez.
    const ownBallsPocketedThisShot = activeSuit
      ? shot.pocketed.filter((number) => ballSuit(number) === activeSuit)
      : [];
    keepTurn = ownBallsPocketedThisShot.length > 0;

    if (!keepTurn) currentTurn = opponent;
    resetTurnClock();

    if (keepTurn) {
      gameState.message = `Jogador ${currentTurn} continua`;
    } else if (shot.pocketed.length === 0) {
      gameState.message = `Nenhuma bola encaçapada. Vez do jogador ${currentTurn}`;
    } else {
      gameState.message = `Vez do jogador ${currentTurn}`;
    }
  }

  // Não força mais a vez para o jogador 1 quando há só um controle conectado.
  // Isso mascarava a regra real: se o jogador não encaçapar uma bola legal, a vez deve passar.
  gameState.breakShot = false;
  gameState.shot = null;
}

function registerFoul(reason) {
  // Evita o bug de "bola na mão" reativando em loop.
  // Falta só deve nascer durante uma tacada real. Enquanto a branca está
  // sendo reposicionada/recém-confirmada, colisores e checks de limite podem
  // gerar falsos positivos; esses eventos são ignorados.
  if (gameState.ballInHand) return;
  if (!gameState.shot) return;
  if (performance.now() < ballInHandGraceUntil) return;
  if (gameState.shot.foul) return;
  gameState.foul = reason;
  gameState.shot.foul = reason;
}

function recordBallContact(ball, event) {
  const otherBody = event?.body;
  const otherBall = otherBody?.userData?.ball;
  const impact = event?.contact?.getImpactVelocityAlongNormal?.() ?? horizontalSpeed(ball.body || { velocity: { x: 0, z: 0 } });

  if (otherBall && !ball.sunk && !otherBall.sunk) {
    sound.play("ball", clamp(Math.abs(impact) / 4.8, 0.18, 1));
  } else if (otherBody?.userData?.type === "rail") {
    sound.play("rail", clamp(Math.abs(impact) / 5.2, 0.14, 0.8));
  }

  if (!gameState.shot) return;
  if (!otherBall) return;
  if (ball.id !== "cue" && otherBall.id !== "cue") return;
  const objectBall = ball.id === "cue" ? otherBall : ball;
  if (objectBall.id === "cue" || objectBall.sunk) return;
  if (!gameState.shot.firstHit) gameState.shot.firstHit = objectBall.number;
}

function checkCueBallContacts() {
  if (!gameState.shot || gameState.shot.firstHit) return;
  const cue = balls.find((ball) => ball.id === "cue" && !ball.sunk);
  if (!cue) return;
  for (const ball of balls) {
    if (ball.id === "cue" || ball.sunk) continue;
    if (cue.position.distanceTo(ball.position) <= BALL_RADIUS * 2.12) {
      gameState.shot.firstHit = ball.number;
      return;
    }
  }
}

function isBallOutsideTable(ball) {
  if (!ball.body || ball.sunk) return false;

  const limitX = TABLE_WIDTH / 2 + TABLE_OUT_MARGIN;
  const limitZ = TABLE_HEIGHT / 2 + TABLE_OUT_MARGIN;

  return (
    Math.abs(ball.body.position.x) > limitX ||
    Math.abs(ball.body.position.z) > limitZ
  );
}

function handleBallOffTable(ball) {
  if (gameState.ballInHand) return;
  if (performance.now() < ballInHandGraceUntil) return;
  if (!gameState.shot) return;
  if (!ball.body || ball.sunk) return;

  registerFoul(`${ball.id === "cue" ? "Branca" : `Bola ${ball.number}`} saiu da mesa`);
  ball.outsideFrames = 0;

  if (ball.id === "cue") {
    setCueBallInHand();
    return;
  }

  // Bola objetiva realmente fora da mesa: remove para não ficar presa fora da área jogável.
  ball.sunk = true;
  ball.velocity.set(0, 0);
  ball.spin.set(0, 0);

  if (ball.body) {
    ball.body.velocity.set(0, 0, 0);
    ball.body.angularVelocity.set(0, 0, 0);
    if (world.bodies.includes(ball.body)) world.removeBody(ball.body);
  }

  const mesh = ballMeshes.get(ball.id);
  if (mesh) mesh.visible = false;

  if (ball.number === 8) {
    gameState.winner = currentTurn === 1 ? 2 : 1;
    gameState.message = `Jogador ${gameState.winner} venceu - bola 8 saiu da mesa`;
    return;
  }

  if (gameState.shot && !gameState.shot.outOfTable.includes(ball.number)) {
    gameState.shot.outOfTable.push(ball.number);
  }
}

function setCueBallInHand() {
  const cue = balls.find((ball) => ball.id === "cue");
  if (!cue) return;
  if (cue.body && world.bodies.includes(cue.body)) world.removeBody(cue.body);
  cue.sunk = false;
  cue.velocity.set(0, 0);
  cue.spin.set(0, 0);
  const spot = findSafeCueBallStart(cue);
  placeCueBallGhost(cue, spot.x, spot.y);
}

function reviveCueForBallInHand() {
  const cue = balls.find((ball) => ball.id === "cue");
  if (!cue) return;
  if (cue.body && world.bodies.includes(cue.body)) world.removeBody(cue.body);
  const spot = findSafeCueBallStart(cue);
  placeCueBallGhost(cue, spot.x, spot.y);
}

function placeCueBallGhost(cue, x, z) {
  cue.sunk = false;
  cue.position.set(x, z);
  if (isSpotFree(new THREE.Vector2(x, z), cue, CUE_BALL_MIN_PLACE_DISTANCE)) gameState.lastValidCueBallSpot = new THREE.Vector2(x, z);
  cue.velocity.set(0, 0);
  cue.spin.set(0, 0);
  if (cue.body) {
    cue.body.position.set(x, BALL_CENTER_Y, z);
    cue.body.velocity.set(0, 0, 0);
    cue.body.angularVelocity.set(0, 0, 0);
    cue.body.sleep();
  }
  const mesh = ballMeshes.get(cue.id);
  if (mesh) {
    mesh.visible = true;
    mesh.position.set(x, BALL_CENTER_Y, z);
    mesh.userData.prevPosition = new THREE.Vector3(x, BALL_CENTER_Y, z);
  }
}

function confirmCueBallInHand() {
  const cue = balls.find((ball) => ball.id === "cue");
  if (!cue) return;
  const current = cue.position.clone();
  const safe = isSpotFree(current, cue, CUE_BALL_MIN_PLACE_DISTANCE) ? current : findSafeSpot(gameState.lastValidCueBallSpot || CUE_BALL_START, cue);
  placeBall(cue, safe.x, safe.y);
  if (cue.body && !world.bodies.includes(cue.body)) world.addBody(cue.body);
  if (cue.body) cue.body.sleep();
  gameState.ballInHand = false;
  gameState.foul = null;
  gameState.shot = null;
  lastBallInHandFoul = null;
  ballInHandGraceUntil = performance.now() + 650;
  resetTurnClock();
  gameState.message = `Jogador ${currentTurn} mirando`;
}

function moveCueBallInHand(value) {
  if (!gameState.ballInHand || gameState.winner) return;
  const cue = balls.find((ball) => ball.id === "cue");
  if (!cue) return;
  if (cue.body && world.bodies.includes(cue.body)) world.removeBody(cue.body);
  cue.sunk = false;

  const x = clamp(Number(value?.x || 0), -1, 1);
  const y = clamp(Number(value?.y || 0), -1, 1);
  const magnitude = Math.hypot(x, y);
  if (magnitude < 0.12) return;

  const current = cue.position.clone();
  const scale = Math.min(1, magnitude);
  const candidate = current.clone();
  candidate.x += (x / magnitude) * BALL_IN_HAND_STEP * scale;
  candidate.y += (y / magnitude) * BALL_IN_HAND_STEP * scale;
  candidate.x = clamp(candidate.x, -TABLE_WIDTH / 2 + BALL_RADIUS * 1.45, TABLE_WIDTH / 2 - BALL_RADIUS * 1.45);
  candidate.y = clamp(candidate.y, -TABLE_HEIGHT / 2 + BALL_RADIUS * 1.45, TABLE_HEIGHT / 2 - BALL_RADIUS * 1.45);

  // Não empurra automaticamente quando encosta em outra bola; isso causava tremedeira.
  // Se a posição é inválida, a branca simplesmente fica no último ponto válido.
  if (isSpotFree(candidate, cue, CUE_BALL_MIN_PLACE_DISTANCE)) {
    gameState.lastValidCueBallSpot = candidate.clone();
    placeCueBallGhost(cue, candidate.x, candidate.y);
  } else if (gameState.lastValidCueBallSpot && isSpotFree(gameState.lastValidCueBallSpot, cue, CUE_BALL_MIN_PLACE_DISTANCE)) {
    placeCueBallGhost(cue, gameState.lastValidCueBallSpot.x, gameState.lastValidCueBallSpot.y);
  }
}

function findSafeCueBallStart(ignoredBall = null) {
  const spot = findSafeSpot(CUE_BALL_START, ignoredBall);
  gameState.lastValidCueBallSpot = spot.clone();
  return spot;
}

function findSafeSpot(preferred, ignoredBall = null) {
  const minDistance = CUE_BALL_MIN_PLACE_DISTANCE;
  let best = preferred.clone();
  best.x = clamp(best.x, -TABLE_WIDTH / 2 + BALL_RADIUS * 1.5, TABLE_WIDTH / 2 - BALL_RADIUS * 1.5);
  best.y = clamp(best.y, -TABLE_HEIGHT / 2 + BALL_RADIUS * 1.5, TABLE_HEIGHT / 2 - BALL_RADIUS * 1.5);

  if (isSpotFree(best, ignoredBall, minDistance)) return best;

  for (let radius = minDistance; radius < 1.6; radius += BALL_RADIUS * 0.8) {
    for (let i = 0; i < 28; i++) {
      const angle = (i / 28) * Math.PI * 2;
      const candidate = new THREE.Vector2(
        clamp(best.x + Math.cos(angle) * radius, -TABLE_WIDTH / 2 + BALL_RADIUS * 1.5, TABLE_WIDTH / 2 - BALL_RADIUS * 1.5),
        clamp(best.y + Math.sin(angle) * radius, -TABLE_HEIGHT / 2 + BALL_RADIUS * 1.5, TABLE_HEIGHT / 2 - BALL_RADIUS * 1.5)
      );
      if (isSpotFree(candidate, ignoredBall, minDistance)) return candidate;
    }
  }

  return best;
}

function isSpotFree(point, ignoredBall, minDistance) {
  for (const ball of balls) {
    if (ball === ignoredBall || ball.sunk) continue;
    if (ball.position.distanceTo(point) < minDistance) return false;
  }
  return true;
}

function placeBall(ball, x, z) {
  ball.sunk = false;
  ball.position.set(x, z);
  ball.velocity.set(0, 0);
  ball.spin.set(0, 0);
  if (ball.body) {
    ball.body.position.set(x, BALL_CENTER_Y, z);
    ball.body.velocity.set(0, 0, 0);
    ball.body.angularVelocity.set(0, 0, 0);
    ball.body.wakeUp();
  }
  const mesh = ballMeshes.get(ball.id);
  if (mesh) {
    mesh.visible = true;
    mesh.position.set(x, BALL_CENTER_Y, z);
    mesh.userData.prevPosition = new THREE.Vector3(x, BALL_CENTER_Y, z);
  }
}

function collideBalls(a, b) {
  if (a.sunk || b.sunk) return;

  const delta = b.position.clone().sub(a.position);
  const distance = delta.length();
  const minDistance = BALL_RADIUS * 2;
  if (distance <= 0 || distance >= minDistance) return;

  const normal = delta.divideScalar(distance);
  const overlap = minDistance - distance;
  a.position.addScaledVector(normal, -overlap / 2);
  b.position.addScaledVector(normal, overlap / 2);

  const relativeVelocity = a.velocity.clone().sub(b.velocity);
  const speed = relativeVelocity.dot(normal);
  if (speed <= 0) return;

  const impulse = normal.multiplyScalar(speed);
  a.velocity.sub(impulse);
  b.velocity.add(impulse);
}

function shoot(power) {
  const cue = balls.find((ball) => ball.id === "cue");
  if (gameState.winner || gameState.ballInHand) return;
  if (!cue || cue.sunk || isMoving() || cueShot.active) return;

  startShot();
  cueShot.active = true;
  cueShot.start = performance.now();
  cueShot.contactStarted = false;
  cueShot.impactDone = false;
  cueShot.power = clamp(power, 0.12, 1);
  cueShot.angle = aim.angle;
  cueShot.spin = { ...aim.spin };
  cueShot.origin.copy(cue.position);
  sound.play("cue", 0.75 + cueShot.power * 0.45);
  updateHud();
}

function updateCueShot(now) {
  if (!cueShot.active) return;

  const progress = clamp((now - cueShot.start) / cueShot.duration, 0, 1);
  if (!cueShot.contactStarted && progress >= cueShot.impactAt) {
    cueShot.contactStarted = true;
  }
  if (!cueShot.impactDone && progress >= cueShot.impulseAt) {
    cueShot.impactDone = true;
    applyCueImpact();
  }
  if (progress >= 1) cueShot.active = false;
}

function applyCueImpact() {
  const cue = balls.find((ball) => ball.id === "cue");
  if (!cue || cue.sunk || !cue.body) return;

  const direction = new THREE.Vector2(Math.cos(cueShot.angle), Math.sin(cueShot.angle));
  const side = new THREE.Vector2(-direction.y, direction.x);
  const spin = new THREE.Vector2(cueShot.spin.x, cueShot.spin.y);
  const speedBoost = 1 + Math.max(spin.y, 0) * 0.15 - Math.max(-spin.y, 0) * 0.08;
  const impulsePower = MAX_POWER * cueShot.power * speedBoost * BALL_MASS;

  cue.body.wakeUp();
  cue.body.applyImpulse(
    new CANNON.Vec3(direction.x * impulsePower + side.x * spin.x * cueShot.power * 0.22, 0, direction.y * impulsePower + side.y * spin.x * cueShot.power * 0.22),
    cue.body.position
  );
  cue.body.angularVelocity.x += -spin.y * cueShot.power * 7.5;
  cue.body.angularVelocity.y += spin.x * cueShot.power * 8.5;
  cue.spin.copy(spin.multiplyScalar(cueShot.power));
}

function syncMeshes() {
  for (const ball of balls) {
    const mesh = ballMeshes.get(ball.id);
    if (!mesh) continue;

    mesh.visible = !ball.sunk;
    if (ball.body && !ball.sunk) {
      const nextPosition = ball.body.position;
      if (!mesh.userData.prevPosition) {
        mesh.userData.prevPosition = new THREE.Vector3(nextPosition.x, nextPosition.y, nextPosition.z);
      }
      const prev = mesh.userData.prevPosition;
      const dx = nextPosition.x - prev.x;
      const dz = nextPosition.z - prev.z;
      const distance = Math.hypot(dx, dz);
      mesh.position.copy(nextPosition);
      if (distance > 0.00001) {
        const axis = new THREE.Vector3(dz, 0, -dx).normalize();
        const roll = new THREE.Quaternion().setFromAxisAngle(axis, distance / BALL_RADIUS);
        mesh.quaternion.premultiply(roll);
      }
      prev.set(nextPosition.x, nextPosition.y, nextPosition.z);
      ball.position.set(nextPosition.x, nextPosition.z);
      ball.velocity.set(ball.body.velocity.x, ball.body.velocity.z);
    }
  }
}

function updateCueLine(now = performance.now()) {
  if (spectatorMode) {
    applyRemoteCueLine();
    return;
  }

  const cue = balls.find((ball) => ball.id === "cue");
  const canAim = cue && !cue.sunk && !gameState.ballInHand && (!isMoving() || cueShot.active);
  cueLine.visible = !!canAim;
  if (!canAim) return;

  // Durante a tacada, o taco fica preso no ponto inicial da bola branca.
  // Depois do impacto ele some, para nunca acompanhar/grudar na bola em tacadas fortes.
  if (cueShot.active && cueShot.impactDone) {
    cueLine.visible = false;
    return;
  }

  const activeAngle = cueShot.active ? cueShot.angle : aim.angle;
  const cueAnchor = cueShot.active ? cueShot.origin : cue.position;
  const cueLength = cueLengthBehind(cueAnchor, activeAngle);
  const tipGap = BALL_RADIUS + 0.18 + cueShotOffset(now);
  const activeSpin = cueShot.active ? cueShot.spin : aim.spin;
  const spinSide = clamp(Number(activeSpin?.x) || 0, -1, 1) * BALL_RADIUS * 0.62;
  const spinHeight = clamp(Number(activeSpin?.y) || 0, -1, 1) * BALL_RADIUS * 0.52;
  setCueLineVisual({
    visible: true,
    px: cueAnchor.x,
    py: BALL_CENTER_Y + 0.03 + spinHeight,
    pz: cueAnchor.y,
    angle: activeAngle,
    pitch: CUE_PITCH + spinHeight * 0.35,
    lateralOffset: spinSide,
    shaftX: -tipGap - cueLength / 2,
    shaftScaleY: cueLength,
    wrapX: -tipGap - cueLength + 0.35,
    buttX: -tipGap - cueLength - 0.14,
    tipX: -tipGap + 0.045
  });
}

function setCueLineVisual(state) {
  cueLine.visible = !!state?.visible;
  if (!state || !state.visible) return;

  cueLine.position.set(Number(state.px) || 0, Number(state.py) || BALL_CENTER_Y + 0.03, Number(state.pz) || 0);

  if (Array.isArray(state.q) && state.q.length === 4) {
    cueLine.quaternion.set(Number(state.q[0]) || 0, Number(state.q[1]) || 0, Number(state.q[2]) || 0, Number(state.q[3]) || 1);
  } else {
    const angle = Number(state.angle) || 0;
    const pitch = typeof state.pitch === "number" ? state.pitch : CUE_PITCH;
    cueLine.quaternion
      .setFromAxisAngle(new THREE.Vector3(0, 1, 0), -angle)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), pitch));
  }

  const lateralOffset = clamp(Number(state.lateralOffset) || 0, -BALL_RADIUS * 0.95, BALL_RADIUS * 0.95);
  // O eixo horizontal do efeito precisa mover o taco para os lados da bola.
  // Como o taco fica alinhado no eixo local X e inclinado no eixo Z, o deslocamento lateral correto é no eixo local Z.
  // O eixo local Y estava sendo usado antes, mas ele aparece como subir/descer depois do pitch.
  cueLine.userData.shaft.position.x = Number(state.shaftX) || -2.2;
  cueLine.userData.shaft.position.y = 0;
  cueLine.userData.shaft.position.z = lateralOffset;
  cueLine.userData.shaft.scale.y = Math.max(0.2, Number(state.shaftScaleY) || 3.2);
  cueLine.userData.wrap.position.x = Number(state.wrapX) || -3.4;
  cueLine.userData.wrap.position.y = 0;
  cueLine.userData.wrap.position.z = lateralOffset;
  cueLine.userData.butt.position.x = Number(state.buttX) || -3.9;
  cueLine.userData.butt.position.y = 0;
  cueLine.userData.butt.position.z = lateralOffset;
  cueLine.userData.tip.position.x = Number(state.tipX) || -0.22;
  cueLine.userData.tip.position.y = 0;
  cueLine.userData.tip.position.z = lateralOffset;
}

function applyRemoteCueLine() {
  if (!remoteCueState) {
    cueLine.visible = false;
    return;
  }
  setCueLineVisual(remoteCueState);
}

function cueSnapshot() {
  return {
    visible: !!cueLine.visible,
    px: round(cueLine.position.x),
    py: round(cueLine.position.y),
    pz: round(cueLine.position.z),
    q: [round(cueLine.quaternion.x), round(cueLine.quaternion.y), round(cueLine.quaternion.z), round(cueLine.quaternion.w)],
    shaftX: round(cueLine.userData.shaft.position.x),
    shaftScaleY: round(cueLine.userData.shaft.scale.y),
    wrapX: round(cueLine.userData.wrap.position.x),
    buttX: round(cueLine.userData.butt.position.x),
    tipX: round(cueLine.userData.tip.position.x),
    lateralOffset: round(cueLine.userData.tip.position.z || 0),
    active: !!cueShot.active,
    impactDone: !!cueShot.impactDone,
    angle: round(cueShot.active ? cueShot.angle : aim.angle),
    power: round(cueShot.active ? cueShot.power : aim.power)
  };
}

function updateTrajectoryLine() {
  if (spectatorMode) { trajectoryLine.visible = false; return; }
  const cue = balls.find((ball) => ball.id === "cue");
  const canAim = cue && !cue.sunk && !gameState.ballInHand && !isMoving();
  trajectoryLine.visible = !!canAim;
  if (!canAim) return;

  const points = predictedTrajectory(cue.position, aim.angle, 4);
  const positions = [];
  for (const point of points) {
    positions.push(point.x, BALL_CENTER_Y + 0.04, point.y);
  }

  trajectoryLine.geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  trajectoryLine.geometry.setDrawRange(0, points.length);
  trajectoryLine.computeLineDistances();
}

function predictedTrajectory(start, angle, bounces) {
  const maxX = TABLE_WIDTH / 2 - BALL_RADIUS;
  const maxY = TABLE_HEIGHT / 2 - BALL_RADIUS;
  const points = [start.clone()];
  const position = start.clone();
  const direction = new THREE.Vector2(Math.cos(angle), Math.sin(angle)).normalize();

  for (let i = 0; i <= bounces; i++) {
    const tx = direction.x > 0
      ? (maxX - position.x) / direction.x
      : direction.x < 0
        ? (-maxX - position.x) / direction.x
        : Infinity;
    const ty = direction.y > 0
      ? (maxY - position.y) / direction.y
      : direction.y < 0
        ? (-maxY - position.y) / direction.y
        : Infinity;
    const railDistance = Math.min(tx, ty);
    const ballDistance = firstTrajectoryBallHit(position, direction);
    const distance = Math.min(railDistance, ballDistance ?? Infinity);
    if (!Number.isFinite(distance)) break;

    const hit = position.clone().addScaledVector(direction, Math.max(distance, 0));
    points.push(hit.clone());

    if (ballDistance !== null && ballDistance <= railDistance) break;
    if (distance < 0.001) break;

    if (Math.abs(tx - distance) < 0.001) direction.x *= -1;
    if (Math.abs(ty - distance) < 0.001) direction.y *= -1;
    position.copy(hit).addScaledVector(direction, 0.002);
  }

  return points;
}

function firstTrajectoryBallHit(position, direction) {
  let nearest = null;
  const hitRadius = BALL_RADIUS * 2.04;

  for (const ball of balls) {
    if (ball.sunk || ball.id === "cue") continue;

    const toBall = ball.position.clone().sub(position);
    const projection = toBall.dot(direction);
    if (projection <= BALL_RADIUS * 0.5) continue;

    const closestSq = toBall.lengthSq() - projection * projection;
    const radiusSq = hitRadius * hitRadius;
    if (closestSq > radiusSq) continue;

    const offset = Math.sqrt(radiusSq - closestSq);
    const distance = projection - offset;
    if (distance <= 0.02) continue;
    nearest = nearest === null ? distance : Math.min(nearest, distance);
  }

  return nearest;
}

function cueShotOffset(now) {
  if (!cueShot.active) return 0;

  const progress = clamp((now - cueShot.start) / cueShot.duration, 0, 1);
  const pullback = 0.38 + cueShot.power * 0.42;
  const contactOffset = 0.015;

  if (progress < 0.22) return easeOut(progress / 0.22) * pullback;
  if (progress < cueShot.impactAt) {
    return lerp(pullback, contactOffset, easeIn((progress - 0.22) / (cueShot.impactAt - 0.22)));
  }
  if (progress < cueShot.impulseAt) return contactOffset;
  return contactOffset * (1 - easeOut((progress - cueShot.impulseAt) / (1 - cueShot.impulseAt)));
}

function updateAimFromPointer(event) {
  if (isMoving() || gameState.ballInHand) return;

  const rect = canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  const y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(x, y), camera);

  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  raycaster.ray.intersectPlane(plane, hit);

  const cue = balls.find((ball) => ball.id === "cue");
  if (!cue) return;
  aim.angle = Math.atan2(hit.z - cue.position.y, hit.x - cue.position.x);
}

function resetCamera() {
  cameraOrbit.radius = 8.55;
  cameraOrbit.theta = 0;
  cameraOrbit.phi = 0.8;
  updateCamera();
}

function applyCameraInput(action) {
  if (action === "camera-left") cameraOrbit.theta += 0.08;
  if (action === "camera-right") cameraOrbit.theta -= 0.08;
  if (action === "camera-up") cameraOrbit.phi = clamp(cameraOrbit.phi - 0.055, 0.38, 1.26);
  if (action === "camera-down") cameraOrbit.phi = clamp(cameraOrbit.phi + 0.055, 0.38, 1.26);
  if (action === "camera-zoom-in") cameraOrbit.radius = clamp(cameraOrbit.radius - 0.24, 5.3, 10.6);
  if (action === "camera-zoom-out") cameraOrbit.radius = clamp(cameraOrbit.radius + 0.24, 5.3, 18.5);
  if (action === "camera-reset") resetCamera();
}

function applyCameraOrbit(value) {
  const x = clamp(Number(value?.x || 0), -1, 1);
  const y = clamp(Number(value?.y || 0), -1, 1);
  cameraOrbit.theta -= x * 0.045;
  cameraOrbit.phi = clamp(cameraOrbit.phi + y * 0.032, 0.38, 1.26);
}

function cameraRelativeAimAngle(value) {
  const x = clamp(Number(value?.x || 0), -1, 1);
  const y = clamp(Number(value?.y || 0), -1, 1);
  if (Math.hypot(x, y) < 0.18) return aim.angle;

  const right = new THREE.Vector2(Math.cos(cameraOrbit.theta), -Math.sin(cameraOrbit.theta));
  const forward = new THREE.Vector2(-Math.sin(cameraOrbit.theta), -Math.cos(cameraOrbit.theta));
  const direction = right.multiplyScalar(x).add(forward.multiplyScalar(-y));
  return Math.atan2(direction.y, direction.x);
}

function updateCamera() {
  if (!editorMode) {
    const cue = balls.find((ball) => ball.id === "cue" && !ball.sunk);
    const targetX = cue ? cue.position.x * 0.38 : 0;
    const targetZ = cue ? cue.position.y * 0.38 : 0;
    cameraTarget.lerp(new THREE.Vector3(targetX, 0, targetZ), 0.18);
  }

  cameraOrbit.radius = clamp(cameraOrbit.radius, 5.3, 18.5);
  cameraOrbit.phi = clamp(cameraOrbit.phi, 0.38, 1.22);
  const sinPhi = Math.sin(cameraOrbit.phi);
  camera.position.set(
    cameraTarget.x + cameraOrbit.radius * sinPhi * Math.sin(cameraOrbit.theta),
    Math.max(1.35, cameraTarget.y + cameraOrbit.radius * Math.cos(cameraOrbit.phi)),
    cameraTarget.z + cameraOrbit.radius * sinPhi * Math.cos(cameraOrbit.theta)
  );
  camera.lookAt(cameraTarget);
  camera.updateProjectionMatrix();
}

function sendState() {
  if (spectatorMode || ws?.readyState !== WebSocket.OPEN) return;
  if (ws.bufferedAmount > 32 * 1024) return;

  ws.send(JSON.stringify({
    type: "state",
    snapshot: {
      t: performance.now(),
      turn: currentTurn,
      moving: isMoving(),
      ballInHand: gameState.ballInHand,
      message: gameState.message,
      winner: gameState.winner,
      assignments: gameState.assignments,
      pocketed: gameState.pocketed,
      foul: gameState.foul,
      breakShot: gameState.breakShot,
      ai: { enabled: gameState.ai.enabled, difficulty: gameState.ai.difficulty, label: aiDifficulty().label },
      power: aim.power,
      angle: aim.angle,
      spin: aim.spin,
      audioEnabled: sound.isEnabled(),
      pendingRemoveChoice: gameState.pendingRemoveChoice,
      shotClockEnabled: gameState.shotClockEnabled,
      shotClockRemaining: shotClockRemaining(),
      cue: cueSnapshot(),
      balls: balls.map((ball) => {
        const mesh = ballMeshes.get(ball.id);
        const body = ball.body;
        return {
          id: ball.id,
          x: round(ball.position.x),
          y: round(ball.position.y),
          vx: round(body?.velocity?.x || 0),
          vy: round(body?.velocity?.z || 0),
          q: mesh ? [round(mesh.quaternion.x), round(mesh.quaternion.y), round(mesh.quaternion.z), round(mesh.quaternion.w)] : undefined,
          sunk: ball.sunk
        };
      })
    }
  }));
}


function applyRemoteSnapshot(snapshot) {
  currentTurn = snapshot.turn || currentTurn;
  gameState.ballInHand = !!snapshot.ballInHand;
  gameState.message = String(snapshot.message || "");
  gameState.winner = snapshot.winner || null;
  if (snapshot.assignments) gameState.assignments = snapshot.assignments;
  if (snapshot.pocketed) gameState.pocketed = snapshot.pocketed;
  gameState.foul = snapshot.foul || null;
  gameState.breakShot = !!snapshot.breakShot;
  if (snapshot.ai) gameState.ai = { ...gameState.ai, enabled: !!snapshot.ai.enabled, difficulty: snapshot.ai.difficulty || gameState.ai.difficulty };
  gameState.pendingRemoveChoice = snapshot.pendingRemoveChoice || null;
  gameState.shotClockEnabled = snapshot.shotClockEnabled !== false;
  if (typeof snapshot.shotClockRemaining === "number") gameState.remoteShotClockRemaining = snapshot.shotClockRemaining;
  if (typeof snapshot.power === "number") aim.power = snapshot.power;
  if (typeof snapshot.angle === "number") aim.angle = snapshot.angle;
  if (snapshot.spin) aim.spin = normalizeSpin(snapshot.spin);
  remoteCueState = snapshot.cue || null;

  const receivedAt = performance.now();
  for (const item of snapshot.balls || []) {
    const ball = balls.find((candidate) => candidate.id === item.id);
    if (!ball) continue;

    const x = Number(item.x) || 0;
    const y = Number(item.y) || 0;
    const vx = Number(item.vx) || 0;
    const vy = Number(item.vy) || 0;
    const sunk = !!item.sunk;
    const quaternion = Array.isArray(item.q) && item.q.length === 4
      ? new THREE.Quaternion(Number(item.q[0]) || 0, Number(item.q[1]) || 0, Number(item.q[2]) || 0, Number(item.q[3]) || 1)
      : null;

    ball.sunk = sunk;
    remoteTargets.set(ball.id, { x, y, vx, vy, sunk, quaternion, receivedAt });

    const mesh = ballMeshes.get(ball.id);
    const firstPacket = !mesh?.userData?.remoteReady;
    if (firstPacket || sunk) {
      ball.position.set(x, y);
      ball.velocity.set(vx, vy);
      if (ball.body) {
        ball.body.position.set(x, BALL_CENTER_Y, y);
        ball.body.velocity.set(vx, 0, vy);
        ball.body.angularVelocity.set(0, 0, 0);
      }
      if (mesh) {
        mesh.position.set(x, BALL_CENTER_Y, y);
        if (quaternion) mesh.quaternion.copy(quaternion);
        mesh.visible = !sunk;
        mesh.userData.remoteReady = true;
        mesh.userData.prevPosition?.set(x, BALL_CENTER_Y, y);
      }
    }
  }
  updateHud();
}

function applyRemoteInterpolation(dt) {
  for (const ball of balls) {
    const target = remoteTargets.get(ball.id);
    if (!target || !ball.body) continue;

    if (target.sunk) {
      ball.sunk = true;
      ball.body.position.set(target.x, BALL_CENTER_Y, target.y);
      ball.body.velocity.set(0, 0, 0);
      continue;
    }

    ball.sunk = false;
    const age = Math.min((performance.now() - target.receivedAt) / 1000, NET_MAX_PREDICTION);
    const predictedX = target.x + target.vx * age;
    const predictedY = target.y + target.vy * age;
    const current = ball.body.position;
    const distance = Math.hypot(predictedX - current.x, predictedY - current.z);
    const snap = distance > 0.7;
    const blend = snap ? 1 : clamp(dt * 18, 0.18, 0.72);

    const nextX = snap ? predictedX : lerp(current.x, predictedX, blend);
    const nextY = snap ? predictedY : lerp(current.z, predictedY, blend);
    ball.body.position.set(nextX, BALL_CENTER_Y, nextY);
    ball.body.velocity.set(target.vx, 0, target.vy);
    ball.position.set(nextX, nextY);
    ball.velocity.set(target.vx, target.vy);

    const mesh = ballMeshes.get(ball.id);
    if (mesh && target.quaternion) {
      mesh.quaternion.slerp(target.quaternion, clamp(dt * 14, 0.12, 0.68));
    }
  }
}


function setAiMode(value) {
  const enabled = !!value?.enabled;
  const difficulty = AI_DIFFICULTIES[value?.difficulty] ? value.difficulty : gameState.ai.difficulty;
  clearAiTimer();
  gameState.ai.enabled = enabled;
  gameState.ai.difficulty = difficulty || "normal";
  gameState.ai.thinking = false;
  gameState.message = enabled ? `Modo solo contra IA (${aiDifficulty().label})` : "Modo contra amigos";
  resetTurnClock();
  if (enabled && currentTurn === AI_PLAYER_ID && !isMoving()) maybeRunAiTurn(true);
}

function aiDifficulty() {
  return AI_DIFFICULTIES[gameState.ai.difficulty] || AI_DIFFICULTIES.normal;
}

function clearAiTimer() {
  if (gameState.ai.timer) clearTimeout(gameState.ai.timer);
  gameState.ai.timer = null;
  gameState.ai.thinking = false;
}

function maybeRunAiTurn(force = false) {
  if (!gameState.ai.enabled || spectatorMode || gameState.winner) return;
  if (currentTurn !== AI_PLAYER_ID) { clearAiTimer(); return; }
  if (isMoving() || cueShot.active) return;
  if (gameState.ai.thinking && !force) return;

  const config = aiDifficulty();
  const [minThink, maxThink] = config.think;
  gameState.ai.thinking = true;
  gameState.message = `IA pensando (${config.label})...`;
  updateHud();
  gameState.ai.timer = setTimeout(() => {
    gameState.ai.timer = null;
    gameState.ai.thinking = false;
    runAiShot();
  }, Math.round(lerp(minThink, maxThink, Math.random())));
}

function runAiShot() {
  if (!gameState.ai.enabled || currentTurn !== AI_PLAYER_ID || gameState.winner || isMoving()) return;


  if (gameState.ballInHand) {
    placeAiCueBall();
    confirmCueBallInHand();
  }

  const shot = chooseAiShot();
  const aiPlan = {
    angle: shot.angle,
    power: shot.power,
    spin: { ...shot.spin }
  };
  aim.angle = aiPlan.angle;
  aim.power = aiPlan.power;
  aim.spin = { ...aiPlan.spin };
  gameState.message = `IA ${aiDifficulty().label} tacando`;
  updateHud();
  sendState();
  setTimeout(() => {
    if (!gameState.ai.enabled || currentTurn !== AI_PLAYER_ID || gameState.winner || isMoving()) return;
    aim.angle = aiPlan.angle;
    aim.power = aiPlan.power;
    aim.spin = { ...aiPlan.spin };
    shoot(aiPlan.power);
  }, 120);
}

function placeAiCueBall() {
  const cue = balls.find((ball) => ball.id === "cue");
  if (!cue) return;
  reviveCueForBallInHand();
  const legal = legalTargetBalls(AI_PLAYER_ID);
  let best = new THREE.Vector2(-2.5, 0);
  let bestScore = -Infinity;
  for (let xi = 0; xi < 10; xi++) {
    for (let zi = 0; zi < 6; zi++) {
      const point = new THREE.Vector2(
        lerp(-TABLE_WIDTH / 2 + 0.45, TABLE_WIDTH / 2 - 0.45, xi / 9),
        lerp(-TABLE_HEIGHT / 2 + 0.42, TABLE_HEIGHT / 2 - 0.42, zi / 5)
      );
      if (!isSpotFree(point, cue, BALL_RADIUS * 2.18)) continue;
      const nearestTarget = legal.reduce((bestDistance, ball) => Math.min(bestDistance, point.distanceTo(ball.position)), Infinity);
      const nearestPocket = pockets().reduce((bestDistance, pocket) => Math.min(bestDistance, point.distanceTo(pocket)), Infinity);
      const score = -nearestTarget + nearestPocket * 0.18 + (Math.random() * 0.18);
      if (score > bestScore) { bestScore = score; best = point; }
    }
  }
  placeBall(cue, best.x, best.y);
}

function aiCueScratchRisk(angle, power = 0.55) {
  const cue = balls.find((ball) => ball.id === "cue" && !ball.sunk);
  if (!cue) return 0;
  const dir = new THREE.Vector2(Math.cos(angle), Math.sin(angle));
  let risk = 0;
  for (const pocket of pockets()) {
    const toPocket = pocket.clone().sub(cue.position);
    const along = toPocket.dot(dir);
    if (along <= 0.08) continue;
    const closest = cue.position.clone().addScaledVector(dir, along);
    const miss = closest.distanceTo(pocket);
    const directLineClear = isLineMostlyClear(cue.position, pocket, null);
    const capture = (Math.abs(pocket.x) < 0.001 ? SIDE_POCKET_THROAT_RADIUS : CORNER_POCKET_THROAT_RADIUS) + BALL_RADIUS * 0.45;
    if (miss < capture && directLineClear) {
      const distanceFactor = clamp(1 - along / 7.5, 0.2, 1);
      risk = Math.max(risk, (1 - miss / capture) * distanceFactor * clamp(power, 0.25, 1));
    }
  }
  return risk;
}

function aiSafeShot(baseAngle, power, config) {
  let angle = baseAngle;
  let shotPower = power;
  let risk = aiCueScratchRisk(angle, shotPower);
  if (risk > 0.18) {
    // Pequenas variações laterais para fugir da linha direta da caçapa da branca.
    const offsets = [-0.28, 0.28, -0.18, 0.18, -0.42, 0.42, 0];
    let best = { angle, power: shotPower, risk };
    for (const offset of offsets) {
      const testAngle = baseAngle + offset * (config.error > 0.12 ? 0.75 : 1);
      const testPower = clamp(power * 0.78, 0.18, 0.72);
      const testRisk = aiCueScratchRisk(testAngle, testPower);
      if (testRisk < best.risk) best = { angle: testAngle, power: testPower, risk: testRisk };
    }
    angle = best.angle;
    shotPower = best.power;
  }
  const shot = aiShotWithError(angle, shotPower, config);
  if (aiCueScratchRisk(shot.angle, shot.power) > 0.24) {
    shot.power = clamp(shot.power * 0.62, 0.16, 0.52);
    shot.spin = { x: 0, y: 0 };
  }
  return shot;
}

function chooseAiShot() {
  const cue = balls.find((ball) => ball.id === "cue" && !ball.sunk);
  const config = aiDifficulty();
  if (!cue) return randomAiShot();

  const candidates = [];
  for (const target of legalTargetBalls(AI_PLAYER_ID)) {
    for (const pocket of pockets()) {
      const targetToPocket = pocket.clone().sub(target.position);
      if (targetToPocket.lengthSq() < 0.0001) continue;
      const pocketDir = targetToPocket.clone().normalize();
      const ghost = target.position.clone().addScaledVector(pocketDir, -BALL_RADIUS * 2.05);
      if (!isLineMostlyClear(cue.position, ghost, target) || !isLineMostlyClear(target.position, pocket, target)) continue;
      const cueToGhost = ghost.clone().sub(cue.position);
      const cutAngle = angleBetween(cueToGhost, targetToPocket);
      const distance = cueToGhost.length() + targetToPocket.length() * 0.65;
      const pocketBonus = Math.abs(pocket.x) > TABLE_WIDTH / 2 - 0.05 && Math.abs(pocket.y) > TABLE_HEIGHT / 2 - 0.05 ? 0.08 : 0;
      const score = 1.7 - cutAngle * 1.2 - distance * 0.13 + pocketBonus + Math.random() * config.safety;
      candidates.push({ target, pocket, ghost, score, distance, cutAngle });
    }
  }

  const chosen = candidates.sort((a, b) => b.score - a.score)[0];
  if (!chosen) {
    const target = nearestLegalTarget(cue.position) || balls.find((ball) => !ball.sunk && ball.id !== "cue");
    if (!target) return randomAiShot();
    const baseAngle = Math.atan2(target.position.y - cue.position.y, target.position.x - cue.position.x);
    return aiSafeShot(baseAngle, 0.34 + Math.random() * 0.18, config);
  }

  const baseAngle = Math.atan2(chosen.ghost.y - cue.position.y, chosen.ghost.x - cue.position.x);
  const distancePower = clamp(chosen.distance / 5.4, 0.18, 0.78);
  const [minPower, maxPower] = config.power;
  const power = clamp(lerp(minPower, maxPower, distancePower + Math.random() * 0.18), 0.12, 1);
  return aiSafeShot(baseAngle, power, config);
}

function aiShotWithError(baseAngle, power, config) {
  const error = (Math.random() * 2 - 1) * config.error;
  const spinNoise = config.error * 0.55;
  return {
    angle: baseAngle + error,
    power: clamp(power + (Math.random() * 2 - 1) * config.error * 0.25, 0.12, 1),
    spin: { x: clamp((Math.random() * 2 - 1) * spinNoise, -0.08, 0.08), y: clamp((Math.random() * 2 - 1) * spinNoise, -0.06, 0.06) }
  };
}

function randomAiShot() {
  return aiSafeShot(Math.random() * Math.PI * 2, 0.34, aiDifficulty());
}

function legalTargetBalls(playerId) {
  const suit = gameState.assignments[playerId];
  if (!suit) return balls.filter((ball) => !ball.sunk && ball.id !== "cue" && ball.suit !== "eight");
  const remaining = balls.filter((ball) => !ball.sunk && ball.suit === suit);
  if (remaining.length) return remaining;
  return balls.filter((ball) => !ball.sunk && ball.suit === "eight");
}

function nearestLegalTarget(point) {
  return legalTargetBalls(AI_PLAYER_ID).sort((a, b) => a.position.distanceTo(point) - b.position.distanceTo(point))[0] || null;
}

function isLineMostlyClear(from, to, ignoredBall = null) {
  const segment = to.clone().sub(from);
  const length = segment.length();
  if (length < 0.01) return true;
  const dir = segment.clone().divideScalar(length);
  for (const ball of balls) {
    if (ball.sunk || ball === ignoredBall || ball.id === "cue") continue;
    const projection = ball.position.clone().sub(from).dot(dir);
    if (projection <= BALL_RADIUS * 1.2 || projection >= length - BALL_RADIUS * 0.6) continue;
    const closest = from.clone().addScaledVector(dir, projection);
    if (closest.distanceTo(ball.position) < BALL_RADIUS * 2.05) return false;
  }
  return true;
}

function angleBetween(a, b) {
  const al = a.length();
  const bl = b.length();
  if (!al || !bl) return 0;
  return Math.acos(clamp(a.dot(b) / (al * bl), -1, 1));
}


function resetTurnClock() {
  gameState.turnStartedAt = performance.now();
}

function shotClockRemaining() {
  if (!gameState.shotClockEnabled || gameState.winner || spectatorMode) return SHOT_CLOCK_SECONDS * 1000;
  return Math.max(0, SHOT_CLOCK_SECONDS * 1000 - (performance.now() - gameState.turnStartedAt));
}

function updateShotClock(now) {
  if (!gameState.shotClockEnabled || gameState.winner || cueShot.active) return;
  const elapsed = now - gameState.turnStartedAt;
  if (elapsed < SHOT_CLOCK_SECONDS * 1000) return;
  handleShotClockExpired();
}

function handleShotClockExpired() {
  const previous = currentTurn;
  const next = previous === 1 ? 2 : 1;

  // Tempo estourado conta como falta: passa a vez e libera bola na mão
  // para o adversário. Também cancela qualquer estado de mira/reposicionamento
  // do jogador anterior para não ficar preso em 0s.
  currentTurn = next;
  gameState.foul = `Tempo do jogador ${previous} esgotado`;
  gameState.ballInHand = true;
  gameState.pendingRemoveChoice = null;
  gameState.message = `Tempo esgotado. Jogador ${currentTurn} com bola na mão`;
  cueShot.active = false;
  cueShot.contactStarted = false;
  cueShot.impactDone = false;
  reviveCueForBallInHand();
  resetTurnClock();
  updateHud();
  sendState();
}

// 8-ball: não existe escolha manual de bola para remover.
// Bolas do adversário encaçapadas permanecem encaçapadas a favor dele; falta gera bola na mão.

function updateShotClockDisplay() {
  if (!shotTimerEl) return;
  if (!gameState.shotClockEnabled) {
    shotTimerEl.textContent = "OFF";
    return;
  }
  const remaining = spectatorMode ? gameState.remoteShotClockRemaining : shotClockRemaining();
  shotTimerEl.textContent = `${Math.ceil(Math.max(0, remaining) / 1000)}s`;
}

function updateWinnerOverlay() {
  if (!winnerOverlayEl || !winnerTitleEl || !winnerReasonEl) return;
  if (!gameState.winner) {
    winnerOverlayEl.classList.remove("is-visible");
    winnerOverlayEl.setAttribute("aria-hidden", "true");
    return;
  }

  winnerTitleEl.textContent = `Jogador ${gameState.winner} venceu!`;
  const message = String(gameState.message || "");
  winnerReasonEl.textContent = message.includes("·") ? message.split("·").slice(1).join("·").trim() : "Partida encerrada";
  winnerOverlayEl.classList.add("is-visible");
  winnerOverlayEl.setAttribute("aria-hidden", "false");
}

function updateHud() {
  updateWinnerOverlay();
  const currentSuit = gameState.assignments[currentTurn];
  if (gameState.winner) {
    turnEl.textContent = `Jogador ${gameState.winner} venceu`;
  } else if (gameState.ballInHand) {
    turnEl.textContent = `Jogador ${currentTurn} - bola na mão`;
  } else {
    turnEl.textContent = `Jogador ${currentTurn}${currentSuit ? ` - ${suitLabel(currentSuit)}` : ""}`;
  }
  powerMeter.value = aim.power;
  if (aiModeEl) aiModeEl.textContent = gameState.ai.enabled ? `Solo vs IA · ${aiDifficulty().label}` : "Contra amigos";
  updateShotClockDisplay();
  playersEl.textContent = gameState.ai.enabled ? "1 + IA" : (spectatorMode ? (playMode ? `${players.length}/2 online` : `${players.length}/2 espectadores`) : `${players.length}/2`);
  assignmentsEl.innerHTML = [1, 2].map((playerId) => playerAssignmentMarkup(playerId)).join("");
  sendState();
}

function isMoving() {
  return cueShot.active || balls.some((ball) => !ball.sunk && ball.body && horizontalSpeed(ball.body) > STOP_SPEED);
}

function applyBallSpin(ball, dt) {
  if (!ball.body || ball.spin.lengthSq() <= 0 || horizontalSpeed(ball.body) <= 0) return;
  const velocity = new THREE.Vector2(ball.body.velocity.x, ball.body.velocity.z);
  const side = new THREE.Vector2(-velocity.y, velocity.x);
  if (side.lengthSq() > 0) side.normalize();
  const forward = velocity.clone().normalize();
  ball.body.velocity.x += side.x * ball.spin.x * dt * 0.38 + forward.x * ball.spin.y * dt * 0.16;
  ball.body.velocity.z += side.y * ball.spin.x * dt * 0.38 + forward.y * ball.spin.y * dt * 0.16;
  ball.spin.multiplyScalar(Math.pow(0.975, dt * 60));
  if (ball.spin.length() < 0.015) ball.spin.set(0, 0);
}

function buildTable() {
  const feltFallback = new THREE.Mesh(
    new THREE.BoxGeometry(TABLE_WIDTH, 0.035, TABLE_HEIGHT),
    new THREE.MeshStandardMaterial({ color: 0x235f27, roughness: 0.92 })
  );
  feltFallback.position.y = -0.006;
  feltFallback.receiveShadow = true;
  tableGroup.add(feltFallback);

  const loader = new GLTFLoader();
  loader.load("/assets/pool-table/pool-table.glb", (gltf) => {
    const model = gltf.scene;
    model.name = "professional-pool-table";
    model.scale.setScalar(TABLE_MODEL_SCALE);
    model.position.set(-TABLE_WIDTH / 2, 0, TABLE_HEIGHT / 2);
    model.traverse((child) => {
      if (child.name === "Cue") child.visible = false;
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
      if (child.material) {
        child.material.envMapIntensity = 1.15;
        child.material.needsUpdate = true;
      }
    });
    feltFallback.visible = false;
    tableGroup.add(model);
    registerEditableObject(model, "Mesa de sinuca");
  }, undefined, () => {
    buildFallbackRails();
  });
}

function buildRailColliders() {
  // Mesa física: seis trechos retos de cushion + jaws nas seis caçapas.
  // Aberturas ficam vazias; os bicos são corpos estáticos reais, não lógica.
  const x = TABLE_WIDTH / 2;
  const z = TABLE_HEIGHT / 2;
  const cornerGap = CORNER_POCKET_MOUTH;
  const sideGap = SIDE_POCKET_MOUTH;
  const railDepth = JAW_THICKNESS;
  const railZ = z + railDepth * 0.48;
  const railX = x + railDepth * 0.48;
  const longRailLength = (TABLE_WIDTH - sideGap - cornerGap * 2) / 2;
  const longRailOffset = sideGap / 2 + longRailLength / 2;
  const shortRailLength = TABLE_HEIGHT - cornerGap * 2;

  addRailCollider(longRailLength, railDepth, -longRailOffset, railZ);
  addRailCollider(longRailLength, railDepth, longRailOffset, railZ);
  addRailCollider(longRailLength, railDepth, -longRailOffset, -railZ);
  addRailCollider(longRailLength, railDepth, longRailOffset, -railZ);
  addRailCollider(railDepth, shortRailLength, railX, 0);
  addRailCollider(railDepth, shortRailLength, -railX, 0);

  addCornerJawColliders(cornerGap);
  addSideJawColliders(sideGap);
}

function addCornerJawColliders(cornerGap) {
  const x = TABLE_WIDTH / 2;
  const z = TABLE_HEIGHT / 2;
  const jawInset = cornerGap * 0.43;
  const jawAngle = 0.44;

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      // Bico ligado ao cushion longo.
      addRailCollider(
        JAW_LENGTH,
        JAW_THICKNESS,
        sx * (x - jawInset),
        sz * (z + JAW_THICKNESS * 0.22),
        -sx * sz * jawAngle,
        "jaw"
      );

      // Bico ligado ao cushion curto.
      addRailCollider(
        JAW_THICKNESS,
        JAW_LENGTH,
        sx * (x + JAW_THICKNESS * 0.22),
        sz * (z - jawInset),
        sx * sz * jawAngle,
        "jaw"
      );
    }
  }
}

function addSideJawColliders(sideGap) {
  const z = TABLE_HEIGHT / 2;
  const jawAngle = 0.34;
  const jawOffset = sideGap * 0.5 + JAW_LENGTH * 0.22;

  for (const sz of [-1, 1]) {
    for (const side of [-1, 1]) {
      addRailCollider(
        JAW_LENGTH,
        JAW_THICKNESS,
        side * jawOffset,
        sz * (z + JAW_THICKNESS * 0.22),
        -side * sz * jawAngle,
        "jaw"
      );
    }
  }
}

function addRailCollider(width, depth, x, z, angle = 0, type = "rail") {
  const body = new CANNON.Body({
    mass: 0,
    material: railMaterial,
    position: new CANNON.Vec3(x, BALL_CENTER_Y, z),
    shape: new CANNON.Box(new CANNON.Vec3(width / 2, 0.34, depth / 2))
  });
  if (angle) body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), angle);
  body.userData = { type: "rail", railKind: type };
  world.addBody(body);
}

function buildFallbackRails() {
  const cushionMaterial = new THREE.MeshStandardMaterial({ color: 0x246f21, roughness: 0.86 });
  const railMaterialVisual = new THREE.MeshStandardMaterial({ map: makeWoodTexture(), roughness: 0.34 });
  const metalMaterial = new THREE.MeshStandardMaterial({ color: 0xd0a13d, roughness: 0.2, metalness: 0.75 });

  const apron = new THREE.Mesh(
    new THREE.BoxGeometry(TABLE_WIDTH + RAIL_THICKNESS * 2 + TABLE_APRON, 0.24, TABLE_HEIGHT + RAIL_THICKNESS * 2 + TABLE_APRON),
    railMaterialVisual
  );
  apron.position.y = -0.16;
  apron.castShadow = true;
  apron.receiveShadow = true;
  tableGroup.add(apron);

  const cornerRailGap = POCKET_RAIL_GAP * 0.48;
  const sideRailGap = POCKET_RAIL_GAP;
  const longRailLength = (TABLE_WIDTH - sideRailGap - cornerRailGap * 2) / 2;
  const longRailOffset = sideRailGap / 2 + longRailLength / 2;
  const shortRailLength = TABLE_HEIGHT - cornerRailGap * 2;
  const railZ = TABLE_HEIGHT / 2 + RAIL_THICKNESS / 2;
  const railX = TABLE_WIDTH / 2 + RAIL_THICKNESS / 2;

  addRail(longRailLength, RAIL_THICKNESS, -longRailOffset, railZ, railMaterialVisual, cushionMaterial, "horizontal");
  addRail(longRailLength, RAIL_THICKNESS, longRailOffset, railZ, railMaterialVisual, cushionMaterial, "horizontal");
  addRail(longRailLength, RAIL_THICKNESS, -longRailOffset, -railZ, railMaterialVisual, cushionMaterial, "horizontal");
  addRail(longRailLength, RAIL_THICKNESS, longRailOffset, -railZ, railMaterialVisual, cushionMaterial, "horizontal");
  addRail(RAIL_THICKNESS, shortRailLength, railX, 0, railMaterialVisual, cushionMaterial, "vertical");
  addRail(RAIL_THICKNESS, shortRailLength, -railX, 0, railMaterialVisual, cushionMaterial, "vertical");
  addRailTopVeneer(railMaterialVisual);

  for (const pocket of pockets()) addPocketAssembly(pocket);
  addDiamonds(metalMaterial);
  addFeltMarkings(metalMaterial);
  addTableBase(railMaterialVisual);
}

function loadLightingEnvironment() {
  new RGBELoader().load("/assets/hdr/pool_table.hdr", (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromEquirectangular(texture).texture;
    scene.environmentIntensity = 0.36;
    texture.dispose();
    pmrem.dispose();
  });
}

function addRail(width, depth, x, z, material, cushionMaterial, orientation) {
  const rail = new THREE.Mesh(new THREE.BoxGeometry(width, RAIL_HEIGHT, depth), material);
  rail.position.set(x, RAIL_HEIGHT / 2, z);
  rail.castShadow = true;
  rail.receiveShadow = true;
  tableGroup.add(rail);

  const cushionDepth = 0.12;
  const cushion = new THREE.Mesh(
    new THREE.BoxGeometry(
      orientation === "horizontal" ? width : cushionDepth,
      0.16,
      orientation === "horizontal" ? cushionDepth : depth
    ),
    cushionMaterial
  );
  const insetX = orientation === "vertical" ? Math.sign(x) * -RAIL_THICKNESS * 0.35 : 0;
  const insetZ = orientation === "horizontal" ? Math.sign(z) * -RAIL_THICKNESS * 0.35 : 0;
  cushion.position.set(x + insetX, 0.2, z + insetZ);
  cushion.castShadow = true;
  cushion.receiveShadow = true;
  tableGroup.add(cushion);
}

function addRailTopVeneer(material) {
  const outerX = TABLE_WIDTH / 2 + RAIL_THICKNESS + TABLE_APRON * 0.22;
  const outerZ = TABLE_HEIGHT / 2 + RAIL_THICKNESS + TABLE_APRON * 0.22;
  const innerX = TABLE_WIDTH / 2 - 0.03;
  const innerZ = TABLE_HEIGHT / 2 - 0.03;
  const shape = new THREE.Shape();

  shape.moveTo(-outerX, -outerZ);
  shape.lineTo(outerX, -outerZ);
  shape.lineTo(outerX, outerZ);
  shape.lineTo(-outerX, outerZ);
  shape.lineTo(-outerX, -outerZ);

  const feltOpening = new THREE.Path();
  feltOpening.moveTo(-innerX, -innerZ);
  feltOpening.lineTo(-innerX, innerZ);
  feltOpening.lineTo(innerX, innerZ);
  feltOpening.lineTo(innerX, -innerZ);
  feltOpening.lineTo(-innerX, -innerZ);
  shape.holes.push(feltOpening);

  const veneerMaterial = material.clone();
  veneerMaterial.side = THREE.DoubleSide;
  const veneer = new THREE.Mesh(new THREE.ShapeGeometry(shape), veneerMaterial);
  veneer.rotation.x = -Math.PI / 2;
  veneer.position.y = RAIL_HEIGHT + 0.014;
  veneer.receiveShadow = true;
  tableGroup.add(veneer);
}

function addDiamonds(material) {
  const diamondGeometry = new THREE.BoxGeometry(0.09, 0.018, 0.09);
  const topZ = TABLE_HEIGHT / 2 + RAIL_THICKNESS / 2;
  const sideX = TABLE_WIDTH / 2 + RAIL_THICKNESS / 2;
  const longXs = [-3.15, -2.1, -1.05, 1.05, 2.1, 3.15];
  const sideZs = [-1.25, 0, 1.25];

  for (const x of longXs) {
    addDiamond(diamondGeometry, material, x, topZ);
    addDiamond(diamondGeometry, material, x, -topZ);
  }
  for (const z of sideZs) {
    addDiamond(diamondGeometry, material, sideX, z);
    addDiamond(diamondGeometry, material, -sideX, z);
  }
}

function addDiamond(geometry, material, x, z) {
  const diamond = new THREE.Mesh(geometry, material);
  diamond.position.set(x, RAIL_HEIGHT + 0.032, z);
  diamond.rotation.y = Math.PI / 4;
  diamond.castShadow = true;
  tableGroup.add(diamond);
}

function addPocketAssembly(pocket) {
  const visualRadius = POCKET_VISUAL_RADIUS;
  const pocketMaterial = new THREE.MeshStandardMaterial({ color: 0x030404, roughness: 0.82 });
  const leatherMaterial = new THREE.MeshStandardMaterial({ color: 0x24140f, roughness: 0.7 });
  const netMaterial = new THREE.LineBasicMaterial({ color: 0xd0b889, transparent: true, opacity: 0.8 });

  const mouth = new THREE.Mesh(
    new THREE.CircleGeometry(visualRadius, 48),
    pocketMaterial
  );
  mouth.position.set(pocket.x, 0.057, pocket.y);
  mouth.rotation.x = -Math.PI / 2;
  tableGroup.add(mouth);

  const throat = new THREE.Mesh(
    new THREE.CylinderGeometry(visualRadius * 0.82, visualRadius * 0.54, 0.28, 36, 1, true),
    pocketMaterial
  );
  throat.position.set(pocket.x, -0.06, pocket.y);
  tableGroup.add(throat);

  const leatherRim = new THREE.Mesh(
    new THREE.TorusGeometry(visualRadius, 0.014, 8, 48),
    leatherMaterial
  );
  leatherRim.position.set(pocket.x, 0.058, pocket.y);
  leatherRim.rotation.x = Math.PI / 2;
  leatherRim.castShadow = true;
  tableGroup.add(leatherRim);

  const drop = new THREE.Mesh(
    new THREE.CylinderGeometry(visualRadius * 0.78, visualRadius * 0.48, 0.62, 28, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x12100d, roughness: 0.78, transparent: true, opacity: 0.72 })
  );
  drop.position.set(pocket.x, -0.22, pocket.y);
  tableGroup.add(drop);

  addPocketNet(pocket, netMaterial);
}

function addPocketNet(pocket, material) {
  const topRadius = POCKET_RADIUS * 0.72;
  const bottomRadius = POCKET_RADIUS * 0.45;
  const topY = -0.02;
  const bottomY = -0.52;
  const segments = 14;
  const positions = [];

  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const next = ((i + 1) / segments) * Math.PI * 2;
    const top = new THREE.Vector3(pocket.x + Math.cos(a) * topRadius, topY, pocket.y + Math.sin(a) * topRadius);
    const bottom = new THREE.Vector3(pocket.x + Math.cos(a + 0.18) * bottomRadius, bottomY, pocket.y + Math.sin(a + 0.18) * bottomRadius);
    const topNext = new THREE.Vector3(pocket.x + Math.cos(next) * topRadius, topY, pocket.y + Math.sin(next) * topRadius);
    const bottomNext = new THREE.Vector3(pocket.x + Math.cos(next + 0.18) * bottomRadius, bottomY, pocket.y + Math.sin(next + 0.18) * bottomRadius);

    positions.push(top.x, top.y, top.z, bottom.x, bottom.y, bottom.z);
    positions.push(top.x, top.y, top.z, bottomNext.x, bottomNext.y, bottomNext.z);
    positions.push(bottom.x, bottom.y, bottom.z, bottomNext.x, bottomNext.y, bottomNext.z);
    positions.push(top.x, top.y, top.z, topNext.x, topNext.y, topNext.z);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const net = new THREE.LineSegments(geometry, material);
  tableGroup.add(net);
}

function addFeltMarkings(material) {
  const spotGeometry = new THREE.CylinderGeometry(0.055, 0.055, 0.01, 24);
  const lineMaterial = new THREE.MeshBasicMaterial({ color: 0xc7d8cd, transparent: true, opacity: 0.32 });
  const spots = [
    new THREE.Vector2(-2.1, 0),
    new THREE.Vector2(1.45, 0)
  ];

  for (const spot of spots) {
    const marker = new THREE.Mesh(spotGeometry, material);
    marker.position.set(spot.x, 0.075, spot.y);
    tableGroup.add(marker);
  }

  const headString = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.01, TABLE_HEIGHT * 0.82), lineMaterial);
  headString.position.set(-2.1, 0.082, 0);
  tableGroup.add(headString);
}

function addTableBase(material) {
  const legGeometry = new THREE.CylinderGeometry(0.2, 0.28, 0.9, 16);
  const legPositions = [
    [-3.35, -1.55],
    [3.35, -1.55],
    [-3.35, 1.55],
    [3.35, 1.55]
  ];

  for (const [x, z] of legPositions) {
    const leg = new THREE.Mesh(legGeometry, material);
    leg.position.set(x, -0.72, z);
    leg.castShadow = true;
    leg.receiveShadow = true;
    tableGroup.add(leg);
  }

  const longStretcher = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.16, 0.18), material);
  longStretcher.position.set(0, -0.82, 1.55);
  longStretcher.castShadow = true;
  tableGroup.add(longStretcher);

  const longStretcherBack = longStretcher.clone();
  longStretcherBack.position.z = -1.55;
  tableGroup.add(longStretcherBack);
}

function buildRoom() {
  // Sala compacta estilo bar/salão de bilhar. Mantém abertura superior para vista de cima
  // e evita que a câmera atravesse um teto escuro ao usar zoom out.
  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x17100e, roughness: 0.86, side: THREE.DoubleSide });
  const accentWallMaterial = new THREE.MeshStandardMaterial({ color: 0x211510, roughness: 0.84, side: THREE.DoubleSide });
  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x171411, roughness: 0.78 });

  const roomWidth = 15.8;
  const roomDepth = 11.8;
  const wallHeight = 4.2;
  const wallY = 1.0;

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(roomWidth + 1.4, roomDepth + 1.4), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.34;
  floor.receiveShadow = true;
  scene.add(floor);

  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(roomWidth, wallHeight), accentWallMaterial);
  backWall.position.set(0, wallY, -roomDepth / 2);
  backWall.receiveShadow = true;
  scene.add(backWall);

  const frontWallLow = new THREE.Mesh(new THREE.PlaneGeometry(roomWidth, wallHeight * 0.72), wallMaterial);
  frontWallLow.position.set(0, wallY - 0.55, roomDepth / 2);
  frontWallLow.rotation.y = Math.PI;
  frontWallLow.receiveShadow = true;
  scene.add(frontWallLow);

  const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(roomDepth, wallHeight), wallMaterial);
  leftWall.rotation.y = Math.PI / 2;
  leftWall.position.set(-roomWidth / 2, wallY, 0);
  leftWall.receiveShadow = true;
  scene.add(leftWall);

  const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(roomDepth, wallHeight), wallMaterial);
  rightWall.rotation.y = -Math.PI / 2;
  rightWall.position.set(roomWidth / 2, wallY, 0);
  rightWall.receiveShadow = true;
  scene.add(rightWall);

  // Rodapés e molduras para dar escala sem fechar o campo de visão superior.
  addWallTrim(roomWidth, roomDepth);

  // Bar e ambientação.
  addBarCounter(4.75, -5.05);
  addBottleShelf(4.75, -5.65);
  addBottleShelf(1.25, -5.65);
  addTrophyShelf(-7.35, -1.9);
  addWallFrames(-3.2, -5.88);

  addBarStool(3.4, -3.95);
  addBarStool(4.75, -3.95);
  addBarStool(6.1, -3.95);

  addSpectator(-5.85, -3.9, 0.35, 0x315b8a);
  addSpectator(-6.55, 2.45, 1.15, 0x7a4830);
  addSpectator(6.6, 2.05, -1.25, 0x3f7a4b);
  addSpectator(6.0, -1.7, -0.55, 0x73518d);
  addSeatedPerson(4.75, -4.05, Math.PI, 0x284e74);

  // Luzes quentes do bar + luz ambiente lateral, mais aconchegante.
  const barLight = new THREE.PointLight(0xff9f4a, 0.72, 8.5);
  barLight.position.set(4.9, 2.05, -4.75);
  scene.add(barLight);

  const wallGlow = new THREE.PointLight(0xffd39a, 0.38, 8.5);
  wallGlow.position.set(-6.8, 1.8, -1.8);
  scene.add(wallGlow);

  const softFill = new THREE.HemisphereLight(0xffe5c3, 0x050708, 0.45);
  scene.add(softFill);
}

function addWallTrim(roomWidth, roomDepth) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x110d0b, roughness: 0.65 });
  const baseH = 0.12;
  const baseY = -1.02;
  const back = new THREE.Mesh(new THREE.BoxGeometry(roomWidth, baseH, 0.12), mat);
  back.position.set(0, baseY, -roomDepth / 2 + 0.06);
  scene.add(back);
  const front = back.clone();
  front.position.z = roomDepth / 2 - 0.06;
  scene.add(front);
  const left = new THREE.Mesh(new THREE.BoxGeometry(0.12, baseH, roomDepth), mat);
  left.position.set(-roomWidth / 2 + 0.06, baseY, 0);
  scene.add(left);
  const right = left.clone();
  right.position.x = roomWidth / 2 - 0.06;
  scene.add(right);
}

function addBarCounter(x, z) {
  const wood = new THREE.MeshStandardMaterial({ color: 0x4b2615, roughness: 0.48, metalness: 0.03 });
  const darkWood = new THREE.MeshStandardMaterial({ color: 0x24110b, roughness: 0.55 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xc28a38, roughness: 0.28, metalness: 0.55 });
  const group = new THREE.Group();
  group.name = `bar-counter-${x.toFixed(2)}-${z.toFixed(2)}`;

  const counter = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.95, 0.82), wood);
  counter.position.set(x, -0.83, z + 0.55);
  counter.castShadow = true;
  counter.receiveShadow = true;
  group.add(counter);

  const top = new THREE.Mesh(new THREE.BoxGeometry(5.75, 0.12, 1.0), darkWood);
  top.position.set(x, -0.28, z + 0.55);
  top.castShadow = true;
  top.receiveShadow = true;
  group.add(top);

  const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 5.6, 18), brass);
  rail.rotation.z = Math.PI / 2;
  rail.position.set(x, -0.38, z + 1.12);
  rail.castShadow = true;
  group.add(rail);

  const backPanel = new THREE.Mesh(new THREE.BoxGeometry(5.9, 1.75, 0.18), new THREE.MeshStandardMaterial({ color: 0x1a0f0b, roughness: 0.62 }));
  backPanel.position.set(x, 0.4, z - 0.18);
  backPanel.receiveShadow = true;
  group.add(backPanel);

  scene.add(group);
  registerEditableObject(group, `Bar ${x.toFixed(1)}, ${z.toFixed(1)}`);
}

function addBarStool(x, z) {
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x3b1d13, roughness: 0.48 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xb79056, roughness: 0.24, metalness: 0.65 });
  const group = new THREE.Group();
  group.name = `bar-stool-${x.toFixed(2)}-${z.toFixed(2)}`;

  const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.34, 0.1, 24), seatMat);
  seat.position.set(x, -0.52, z);
  seat.castShadow = true;
  group.add(seat);
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.76, 14), metal);
  leg.position.set(x, -0.94, z);
  leg.castShadow = true;
  group.add(leg);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.035, 18), metal);
  foot.position.set(x, -1.31, z);
  foot.castShadow = true;
  group.add(foot);

  scene.add(group);
  registerEditableObject(group, `Banqueta ${x.toFixed(1)}, ${z.toFixed(1)}`);
}

function addTrophyShelf(x, z) {
  const group = new THREE.Group();
  group.name = `trophy-shelf-${x.toFixed(2)}-${z.toFixed(2)}`;

  const shelfMat = new THREE.MeshStandardMaterial({ color: 0x24130d, roughness: 0.52 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd7a73a, roughness: 0.24, metalness: 0.8 });
  const silver = new THREE.MeshStandardMaterial({ color: 0xcfd5d6, roughness: 0.22, metalness: 0.75 });

  for (let row = 0; row < 3; row++) {
    const shelf = new THREE.Mesh(
      new THREE.BoxGeometry(0.30, 0.1, 3.7),
      shelfMat
    );

    shelf.position.set(x, 0.2 + row * 0.62, z + 0.2);

    // troca aqui:
    shelf.rotation.y = 0; 
    // se ainda ficar errado, use:
    // shelf.rotation.y = Math.PI / 2;

    group.add(shelf);

    for (let i = 0; i < 4; i++) {
      addTrophy(
        x + 0.01,
        0.43 + row * 0.62,
        z - 1.35 + i * 0.9,
        (i + row) % 2 ? silver : gold,
        group
      );
    }
  }

  scene.add(group);
  registerEditableObject(group, "Prateleira de troféus");
}

function addTrophy(x, y, z, material, parent = scene) {
  const cup = new THREE.Group();
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 0.22, 20), material);
  bowl.position.y = 0.14;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.16, 14), material);
  stem.position.y = -0.03;
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.06, 0.18), material);
  base.position.y = -0.14;
  cup.add(bowl, stem, base);
  cup.position.set(x, y, z);
  cup.rotation.y = Math.PI / 2;
  cup.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  parent.add(cup);
}

function addWallFrames(x, z) {
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x0e0907, roughness: 0.5 });
  const feltMat = new THREE.MeshStandardMaterial({ color: 0x1f5c42, roughness: 0.8 });
  for (let i = 0; i < 3; i++) {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.75, 0.06), frameMat);
    frame.position.set(x + i * 1.45, 1.65, z);
    scene.add(frame);
    const inner = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.52, 0.065), feltMat);
    inner.position.set(x + i * 1.45, 1.65, z + 0.01);
    scene.add(inner);
  }
}

function addSpectator(x, z, facing = 0, shirtColor = 0x446688) {
  const group = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xd3a071, roughness: 0.62 });
  const shirt = new THREE.MeshStandardMaterial({ color: shirtColor, roughness: 0.7 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x1d2430, roughness: 0.75 });
  const hair = new THREE.MeshStandardMaterial({ color: 0x1b130f, roughness: 0.65 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.76, 16), shirt);
  body.position.y = -0.55;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 18, 14), skin);
  head.position.y = -0.05;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.185, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), hair);
  cap.position.y = 0.02;
  const legA = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.55, 10), pants);
  legA.position.set(-0.08, -1.2, 0);
  const legB = legA.clone();
  legB.position.x = 0.08;
  group.add(body, head, cap, legA, legB);
  group.position.set(x, 0, z);
  group.rotation.y = facing;
  group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  scene.add(group);
}

function addSeatedPerson(x, z, facing = 0, shirtColor = 0x446688) {
  addSpectator(x, z, facing, shirtColor);
  const shadowSeat = new THREE.Mesh(
    new THREE.BoxGeometry(0.46, 0.08, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x2b1710, roughness: 0.5 })
  );
  shadowSeat.position.set(x, -0.78, z);
  shadowSeat.castShadow = true;
  scene.add(shadowSeat);
}

function addBottleShelf(x, z) {
  const shelfMaterial = new THREE.MeshStandardMaterial({ color: 0x151010, roughness: 0.55 });
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(3, 0.12, 0.26), shelfMaterial);
  shelf.position.set(x, 1.55, z);
  scene.add(shelf);

  const colors = [0x5bbcff, 0xffbb4d, 0xff4d80, 0x62e07a, 0x945cff, 0xffffff];
  for (let i = 0; i < 12; i++) {
    const bottle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.075, 0.42, 10),
      new THREE.MeshStandardMaterial({ color: colors[i % colors.length], roughness: 0.35, transparent: true, opacity: 0.82 })
    );
    bottle.position.set(x - 1.3 + i * 0.23, 1.84, z + 0.02);
    scene.add(bottle);
  }
}

function makeCueLine() {
  const group = new THREE.Group();
  const shaftMaterial = new THREE.MeshStandardMaterial({ color: 0xe7be79, roughness: 0.34 });
  const wrapMaterial = new THREE.MeshStandardMaterial({ color: 0x2a1711, roughness: 0.5 });
  const buttMaterial = new THREE.MeshStandardMaterial({ color: 0x14100d, roughness: 0.4, metalness: 0.12 });
  const tipMaterial = new THREE.MeshStandardMaterial({ color: 0xd9e2ea, roughness: 0.28 });

  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.062, 0.018, 1, 28),
    shaftMaterial
  );
  shaft.rotation.z = Math.PI / 2;
  shaft.castShadow = true;

  const wrap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.071, 0.071, 0.7, 24),
    wrapMaterial
  );
  wrap.rotation.z = Math.PI / 2;
  wrap.castShadow = true;

  const butt = new THREE.Mesh(
    new THREE.CylinderGeometry(0.082, 0.082, 0.28, 24),
    buttMaterial
  );
  butt.rotation.z = Math.PI / 2;
  butt.castShadow = true;

  const tip = new THREE.Mesh(
    new THREE.CylinderGeometry(0.022, 0.018, 0.09, 18),
    tipMaterial
  );
  tip.rotation.z = Math.PI / 2;
  tip.castShadow = true;

  group.add(shaft, wrap, butt, tip);
  group.userData = { shaft, wrap, butt, tip };
  return group;
}

function makeTrajectoryLine() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([], 3));
  const material = new THREE.LineDashedMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.82,
    dashSize: 0.12,
    gapSize: 0.1,
    depthTest: true
  });
  const line = new THREE.Line(geometry, material);
  line.visible = false;
  return line;
}

function cueLengthBehind(position, angle) {
  const backX = -Math.cos(angle);
  const backY = -Math.sin(angle);
  const maxX = TABLE_WIDTH / 2 + RAIL_THICKNESS + 0.3;
  const maxY = TABLE_HEIGHT / 2 + RAIL_THICKNESS + 0.3;
  const distances = [];

  if (Math.abs(backX) > 0.001) distances.push(((backX > 0 ? maxX : -maxX) - position.x) / backX);
  if (Math.abs(backY) > 0.001) distances.push(((backY > 0 ? maxY : -maxY) - position.y) / backY);

  const clearance = distances.filter((distance) => distance > 0).reduce((best, distance) => Math.min(best, distance), 4.25);
  return clamp(clearance - 0.16, 2.6, 4.25);
}

function pockets() {
  return pocketDefs().map((pocket) => new THREE.Vector2(pocket.x, pocket.z));
}

function pocketDefs() {
  const x = TABLE_WIDTH / 2;
  const z = TABLE_HEIGHT / 2;
  return [
    { type: "corner", x: -x, z: -z, sx: -1, sz: -1 },
    { type: "side", x: 0, z: -z - 0.04, sx: 0, sz: -1 },
    { type: "corner", x, z: -z, sx: 1, sz: -1 },
    { type: "corner", x: -x, z, sx: -1, sz: 1 },
    { type: "side", x: 0, z: z + 0.04, sx: 0, sz: 1 },
    { type: "corner", x, z, sx: 1, sz: 1 }
  ];
}

function ballSuit(number) {
  if (!number) return "cue";
  if (number === 8) return "eight";
  return number < 8 ? "solids" : "stripes";
}

function ballColor(number) {
  const colors = {
    1: 0xf0c84c,
    2: 0x2f6eea,
    3: 0xd74444,
    4: 0x7e4bd8,
    5: 0xf08235,
    6: 0x2f9f76,
    7: 0x7d2633,
    8: 0x111111,
    9: 0xf0c84c,
    10: 0x2f6eea,
    11: 0xd74444,
    12: 0x7e4bd8,
    13: 0xf08235,
    14: 0x2f9f76,
    15: 0x7d2633
  };
  return colors[number] || 0xffffff;
}

function makeBallMaterial(number, color) {
  const material = new THREE.MeshStandardMaterial({
    color: number ? 0xffffff : 0xfff6e6,
    roughness: 0.16,
    metalness: 0.0,
    envMapIntensity: 0.9
  });

  if (number) {
    const texture = textureLoader.load(`${BALL_TEXTURE_PATH}${number}ball.png`, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      material.map = tex;
      material.needsUpdate = true;
    }, undefined, () => {
      material.map = makeBallTexture(number, color, ballSuit(number));
      material.needsUpdate = true;
    });
    texture.colorSpace = THREE.SRGBColorSpace;
    material.map = texture;
  }

  return material;
}

function makeBallTexture(number, color, suit) {
  const canvasTexture = document.createElement("canvas");
  canvasTexture.width = 256;
  canvasTexture.height = 256;
  const ctx = canvasTexture.getContext("2d");
  const colorCss = `#${color.toString(16).padStart(6, "0")}`;

  ctx.fillStyle = suit === "stripes" ? "#f8f1df" : colorCss;
  ctx.fillRect(0, 0, 256, 256);

  if (suit === "stripes") {
    ctx.fillStyle = colorCss;
    ctx.fillRect(0, 76, 256, 104);
  }

  ctx.beginPath();
  ctx.arc(128, 128, 48, 0, Math.PI * 2);
  ctx.fillStyle = "#fff8e8";
  ctx.fill();

  ctx.fillStyle = "#111719";
  ctx.font = "bold 58px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(number), 128, 131);

  const texture = new THREE.CanvasTexture(canvasTexture);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeWoodTexture(multiplier = 1) {
  const woodCanvas = document.createElement("canvas");
  woodCanvas.width = 512;
  woodCanvas.height = 128;
  const ctx = woodCanvas.getContext("2d");
  const base = Math.round(118 * multiplier);
  const gradient = ctx.createLinearGradient(0, 0, 512, 0);
  gradient.addColorStop(0, `rgb(${base}, ${Math.round(54 * multiplier)}, ${Math.round(24 * multiplier)})`);
  gradient.addColorStop(0.5, `rgb(${Math.round(base * 1.25)}, ${Math.round(72 * multiplier)}, ${Math.round(32 * multiplier)})`);
  gradient.addColorStop(1, `rgb(${Math.round(base * 0.82)}, ${Math.round(42 * multiplier)}, ${Math.round(18 * multiplier)})`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 512, 128);

  for (let y = 10; y < 128; y += 13) {
    ctx.beginPath();
    ctx.strokeStyle = "rgba(40, 18, 8, 0.32)";
    ctx.lineWidth = 2;
    for (let x = 0; x <= 512; x += 18) {
      const wave = Math.sin(x * 0.035 + y * 0.22) * 6;
      if (x === 0) ctx.moveTo(x, y + wave);
      else ctx.lineTo(x, y + wave);
    }
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(woodCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 1);
  return texture;
}

function playerAssignmentMarkup(playerId) {
  const suit = gameState.assignments[playerId];
  const target = suit ? targetNumbers(suit) : [];
  const potted = suit ? gameState.pocketed[suit] : [];
  const remaining = target.filter((number) => !potted.includes(number));
  const ballsMarkup = suit
    ? remaining.length
      ? remaining.map(ballHudIcon).join("")
      : ballHudIcon(8, "Bola 8 liberada")
    : `<span class="assignment-open">Aguardando primeira bola encaçapada</span>`;

  return `
    <div class="assignment-card">
      <span class="label">Jogador ${playerId}</span>
      <strong>${suit ? suitLabel(suit) : "A definir"}</strong>
      <div class="remaining-balls" aria-label="Bolas restantes">${ballsMarkup}</div>
    </div>
  `;
}

function ballHudIcon(number, label = `Bola ${number}`) {
  return `
    <img
      class="hud-ball-icon"
      src="/assets/pool-table/${number}ball.png"
      alt="${label}"
      title="${label}"
      loading="eager"
      draggable="false"
    />
  `;
}

function targetNumbers(suit) {
  return suit === "solids" ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15];
}

function suitLabel(suit) {
  if (suit === "solids") return "Lisas";
  if (suit === "stripes") return "Listradas";
  return "Bola 8";
}

function createSoundManager() {
  const base = "/assets/sound/";
  const musicBase = "/assets/sound/music/";

  const files = {
    cue: "tableHit.wav",
    ball: "ball_ball.mp3",
    rail: "ball_edge.mp3",
    pocket: "ball_fall.mp3",
    room: "env.mp3",
    people: "peopleTalking1.wav"
  };

  const oneShots = new Map();
  const loops = new Map();
  const lastPlayed = new Map();

  let enabled = false;
  let musicAudio = null;
  let musicList = [];
  let musicQueue = [];
  let lastPlayedMusic = null;

  function makeAudio(name, loop = false, volume = 1) {
    const audio = new Audio(base + files[name]);
    audio.preload = "auto";
    audio.loop = loop;
    audio.volume = volume;
    return audio;
  }

  function makeMusicAudio(file) {
    const audio = new Audio(musicBase + file);
    audio.preload = "auto";
    audio.loop = false;
    audio.volume = 0.18;
    audio.addEventListener("ended", playRandomMusic);
    return audio;
  }

  async function loadMusicList() {
    try {
      const res = await fetch(musicBase + "manifest.json", { cache: "no-store" });
      if (!res.ok) throw new Error("manifest.json não encontrado");

      const list = await res.json();

      musicList = list.filter((file) =>
        /\.(mp3|wav|ogg|m4a)$/i.test(file)
      );

      refillMusicQueue();
    } catch (err) {
      console.warn("Não foi possível carregar lista de músicas:", err);
      musicList = [];
      musicQueue = [];
    }
  }

  function shuffle(array) {
    const copy = [...array];

    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }

    return copy;
  }

  function refillMusicQueue() {
    musicQueue = shuffle(musicList);

    if (
      musicQueue.length > 1 &&
      lastPlayedMusic &&
      musicQueue[0] === lastPlayedMusic
    ) {
      const swapIndex = musicQueue.findIndex((file) => file !== lastPlayedMusic);

      if (swapIndex > 0) {
        [musicQueue[0], musicQueue[swapIndex]] = [
          musicQueue[swapIndex],
          musicQueue[0]
        ];
      }
    }
  }

  function getNextMusic() {
    if (musicList.length === 0) return null;

    if (musicQueue.length === 0) {
      refillMusicQueue();
    }

    const file = musicQueue.shift();
    lastPlayedMusic = file;

    return file;
  }

  function playRandomMusic() {
    if (!enabled) return;

    const file = getNextMusic();
    if (!file) return;

    if (musicAudio) {
      musicAudio.pause();
      musicAudio.removeEventListener("ended", playRandomMusic);
    }

    console.log("Tocando música:", file);

    musicAudio = makeMusicAudio(file);

    musicAudio.play().catch((err) => {
      console.warn("Não conseguiu tocar música:", err);
    });
  }

  for (const name of ["cue", "ball", "rail", "pocket"]) {
    oneShots.set(
      name,
      Array.from({ length: name === "ball" ? 6 : 3 }, () => makeAudio(name))
    );
  }

  loops.set("room", makeAudio("room", true, 0.22));
  loops.set("people", makeAudio("people", true, 0.13));

  function updateButton() {
    if (!audioBtn) return;

    audioBtn.classList.toggle("is-on", enabled);
    audioBtn.textContent = enabled ? "Som ligado" : "Ativar som";
    audioBtn.setAttribute("aria-pressed", enabled ? "true" : "false");
  }

  async function unlock() {
    if (enabled) return true;

    enabled = true;
    updateButton();

    await loadMusicList();

    for (const audio of loops.values()) {
      audio.currentTime = 0;
      audio.play().catch(() => {});
    }

    playRandomMusic();

    return true;
  }

  function disable() {
    if (!enabled) return;

    enabled = false;
    updateButton();

    if (musicAudio) {
      musicAudio.pause();
      musicAudio.currentTime = 0;
    }

    for (const audio of loops.values()) {
      audio.pause();
    }

    for (const pool of oneShots.values()) {
      for (const audio of pool) {
        audio.pause();
        audio.currentTime = 0;
      }
    }
  }

  function toggle() {
    return setEnabled(!enabled);
  }

  function setEnabled(value) {
    if (value) {
      unlock();
      return true;
    }

    disable();
    return false;
  }

  function play(name, volume = 1) {
    if (!enabled) return;

    const now = performance.now();
    const minGap = name === "ball" ? 42 : name === "rail" ? 70 : 95;

    if (now - (lastPlayed.get(name) || 0) < minGap) return;

    lastPlayed.set(name, now);

    const pool = oneShots.get(name);
    if (!pool) return;

    const audio = pool.find((item) => item.paused || item.ended) || pool[0];

    audio.pause();
    audio.currentTime = 0;
    audio.volume = clamp(volume, 0, 1);
    audio.play().catch(() => {});
  }

  updateButton();

  function isEnabled() {
    return enabled;
  }

  return {
    unlock,
    disable,
    toggle,
    setEnabled,
    play,
    isEnabled
  };
}

function installAudioUnlock() {
  audioBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    sound.toggle();
  });
  window.addEventListener("pointerdown", () => sound.unlock(), { once: true, passive: true });
  window.addEventListener("keydown", () => sound.unlock(), { once: true });
  window.addEventListener("touchstart", () => sound.unlock(), { once: true, passive: true });
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  renderer.setSize(rect.width, rect.height, false);
  camera.aspect = rect.width / Math.max(rect.height, 1);
  camera.updateProjectionMatrix();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeSpin(value) {
  const x = clamp(Number(value?.x || 0), -1, 1);
  const y = clamp(Number(value?.y || 0), -1, 1);
  const length = Math.hypot(x, y);
  if (length <= 1) return { x, y };
  return { x: x / length, y: y / length };
}

function easeIn(value) {
  return value * value;
}

function easeOut(value) {
  return 1 - Math.pow(1 - value, 3);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function parseMessage(data) {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

// lighting tuned v39
