import * as THREE from "https://unpkg.com/three@0.165.0/build/three.module.js";

const TABLE_WIDTH = 8.4;
const TABLE_HEIGHT = 4.2;
const BALL_RADIUS = 0.16;
const POCKET_RADIUS = 0.38;
const POCKET_VISUAL_RADIUS = POCKET_RADIUS * 0.78;
const POCKET_RAIL_GAP = POCKET_VISUAL_RADIUS * 2.35;
const RAIL_THICKNESS = 0.46;
const RAIL_HEIGHT = 0.42;
const TABLE_APRON = 0.42;
const CUE_PITCH = -0.13;
const FRICTION = 0.986;
const STOP_SPEED = 0.035;
const MAX_POWER = 5.6;
const RAIL_RESTITUTION = 0.82;

const canvas = document.querySelector("#scene");
const statusEl = document.querySelector("#status");
const codeEl = document.querySelector("#code");
const qrEl = document.querySelector("#qr");
const linkEl = document.querySelector("#controlLink");
const turnEl = document.querySelector("#turn");
const playersEl = document.querySelector("#players");
const powerMeter = document.querySelector("#powerMeter");
const resetBtn = document.querySelector("#resetBtn");
const assignmentsEl = document.querySelector("#assignments");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e1416);
scene.fog = new THREE.Fog(0x0e1416, 14, 30);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
const cameraTarget = new THREE.Vector3();
const cameraOrbit = {
  radius: 8.55,
  theta: 0,
  phi: 0.8
};
camera.position.set(0, 5.9, 6.1);
camera.lookAt(0, 0, 0);

const ambient = new THREE.HemisphereLight(0xe8fff6, 0x17201f, 1.2);
scene.add(ambient);

const keyLight = new THREE.DirectionalLight(0xffefcf, 2.7);
keyLight.position.set(-3.5, 7, 2.8);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
scene.add(keyLight);

const accentLight = new THREE.PointLight(0xd24bff, 1.4, 16);
accentLight.position.set(-5, 3.2, -4);
scene.add(accentLight);

const warmBarLight = new THREE.PointLight(0xff9a42, 1.1, 14);
warmBarLight.position.set(5, 2.8, 3.5);
scene.add(warmBarLight);

const tableGroup = new THREE.Group();
scene.add(tableGroup);
buildTable();
buildRoom();

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
  spin: { x: 0, y: 0 }
};

const gameState = {
  assignments: { 1: null, 2: null },
  pocketed: { solids: [], stripes: [], eight: [] }
};

let code = new URLSearchParams(window.location.search).get("code") || "";
let ws;
let players = [];
let currentTurn = 1;
let lastTime = performance.now();
let lastStateSent = 0;
let redirectingToController = false;

const cueLine = makeCueLine();
scene.add(cueLine);
const trajectoryLine = makeTrajectoryLine();
scene.add(trajectoryLine);

resetGame();
resize();
window.addEventListener("resize", resize);
resetBtn.addEventListener("click", resetGame);
canvas.addEventListener("pointermove", updateAimFromPointer);
canvas.addEventListener("click", () => shoot(aim.power));

connect();
requestAnimationFrame(loop);

async function connect() {
  if (!code) {
    const response = await fetch("/new-session");
    const session = await response.json();
    code = session.code;
    history.replaceState(null, "", `/table?code=${code}`);
    showRoom(session);
  }

  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`);

  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({ type: "join-host", code }));
    statusEl.textContent = "Mesa online";
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

    if (msg.type === "host-occupied") {
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
  showRoom({ code, controllerUrl: url.href });
}

function showRoom(session) {
  codeEl.textContent = session.code;
  linkEl.href = session.controllerUrl;
  linkEl.textContent = session.controllerUrl;
  const qrUrl = session.qr || `/qr/${encodeURIComponent(session.code)}`;
  qrEl.innerHTML = "";
  const image = document.createElement("img");
  image.alt = `QR code da sala ${session.code}`;
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

function handleInput(playerId, action, value) {
  action = String(action || "");
  if (action === "camera-orbit") {
    applyCameraOrbit(value);
    return;
  }
  if (action.startsWith("camera-")) {
    applyCameraInput(action);
    return;
  }

  if (playerId !== currentTurn || isMoving()) return;

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
  balls.length = 0;
  gameState.assignments = { 1: null, 2: null };
  gameState.pocketed = { solids: [], stripes: [], eight: [] };
  addBall("cue", null, 0xffffff, -2.5, 0);

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
    sunk: false
  };
  balls.push(ball);

  let mesh = ballMeshes.get(id);
  if (!mesh) {
    const geometry = new THREE.SphereGeometry(BALL_RADIUS, 32, 18);
    const material = makeBallMaterial(number, color);
    mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    ballMeshes.set(id, mesh);
    scene.add(mesh);
  } else {
    mesh.material = makeBallMaterial(number, color);
  }

  mesh.visible = true;
}

function loop(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.033);
  lastTime = now;

  updateCueShot(now);
  stepPhysics(dt);
  syncMeshes();
  updateCueLine(now);
  updateTrajectoryLine();
  updateCamera();
  renderer.render(scene, camera);

  if (now - lastStateSent > 120) {
    lastStateSent = now;
    sendState();
  }

  requestAnimationFrame(loop);
}

function stepPhysics(dt) {
  const movingBefore = isMoving();

  for (const ball of balls) {
    if (ball.sunk) continue;

    ball.position.addScaledVector(ball.velocity, dt);
    applyBallSpin(ball, dt);
    ball.velocity.multiplyScalar(Math.pow(FRICTION, dt * 60));
    ball.spin.multiplyScalar(Math.pow(0.975, dt * 60));
    if (ball.velocity.length() < STOP_SPEED) ball.velocity.set(0, 0);
    if (ball.spin.length() < 0.015) ball.spin.set(0, 0);

    handleRails(ball);
    handlePockets(ball);
  }

  for (let i = 0; i < balls.length; i++) {
    for (let j = i + 1; j < balls.length; j++) {
      collideBalls(balls[i], balls[j]);
    }
  }

  if (movingBefore && !isMoving()) {
    currentTurn = currentTurn === 1 ? 2 : 1;
    if (players.length < 2) currentTurn = 1;
    updateHud();
  }
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
  for (const pocket of pockets()) {
    if (ball.position.distanceTo(pocket) > POCKET_RADIUS) continue;

    ball.sunk = true;
    ball.velocity.set(0, 0);
    ball.spin.set(0, 0);

    if (ball.id === "cue") {
      setTimeout(() => {
        ball.sunk = false;
        ball.position.set(-2.5, 0);
      }, 600);
    } else {
      handlePottedBall(ball);
    }
    return;
  }
}

function handlePottedBall(ball) {
  if (ball.suit === "eight") {
    gameState.pocketed.eight.push(ball.number);
    updateHud();
    return;
  }

  if (!gameState.assignments[1] && !gameState.assignments[2]) {
    gameState.assignments[currentTurn] = ball.suit;
    gameState.assignments[currentTurn === 1 ? 2 : 1] = ball.suit === "solids" ? "stripes" : "solids";
  }

  if (!gameState.pocketed[ball.suit].includes(ball.number)) {
    gameState.pocketed[ball.suit].push(ball.number);
  }
  updateHud();
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
  if (!cue || cue.sunk || isMoving() || cueShot.active) return;

  cueShot.active = true;
  cueShot.start = performance.now();
  cueShot.contactStarted = false;
  cueShot.impactDone = false;
  cueShot.power = clamp(power, 0.12, 1);
  cueShot.angle = aim.angle;
  cueShot.spin = { ...aim.spin };
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
  if (!cue || cue.sunk) return;

  const direction = new THREE.Vector2(Math.cos(cueShot.angle), Math.sin(cueShot.angle));
  const side = new THREE.Vector2(-direction.y, direction.x);
  const spin = new THREE.Vector2(cueShot.spin.x, cueShot.spin.y);
  const speedBoost = 1 + Math.max(spin.y, 0) * 0.15 - Math.max(-spin.y, 0) * 0.08;

  cue.velocity.addScaledVector(direction, MAX_POWER * cueShot.power * speedBoost);
  cue.velocity.addScaledVector(side, spin.x * cueShot.power * 0.42);
  cue.spin.copy(spin.multiplyScalar(cueShot.power));
}

function syncMeshes() {
  for (const ball of balls) {
    const mesh = ballMeshes.get(ball.id);
    if (!mesh) continue;

    mesh.visible = !ball.sunk;
    mesh.position.set(ball.position.x, BALL_RADIUS + 0.06, ball.position.y);
    mesh.rotation.x += ball.velocity.y * 0.03;
    mesh.rotation.z -= ball.velocity.x * 0.03;
  }
}

function updateCueLine(now = performance.now()) {
  const cue = balls.find((ball) => ball.id === "cue");
  const canAim = cue && !cue.sunk && (!isMoving() || cueShot.active);
  cueLine.visible = !!canAim;
  if (!canAim) return;

  const activeAngle = cueShot.active ? cueShot.angle : aim.angle;
  const cueLength = cueLengthBehind(cue.position, activeAngle);
  const tipGap = BALL_RADIUS + 0.22 + cueShotOffset(now);
  cueLine.position.set(cue.position.x, BALL_RADIUS + 0.085, cue.position.y);
  cueLine.quaternion
    .setFromAxisAngle(new THREE.Vector3(0, 1, 0), -activeAngle)
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), CUE_PITCH));
  cueLine.userData.shaft.position.x = -tipGap - cueLength / 2;
  cueLine.userData.shaft.scale.y = cueLength;
  cueLine.userData.wrap.position.x = -tipGap - cueLength + 0.35;
  cueLine.userData.butt.position.x = -tipGap - cueLength - 0.14;
  cueLine.userData.tip.position.x = -tipGap + 0.045;
}

function updateTrajectoryLine() {
  const cue = balls.find((ball) => ball.id === "cue");
  const canAim = cue && !cue.sunk && !isMoving();
  trajectoryLine.visible = !!canAim;
  if (!canAim) return;

  const points = predictedTrajectory(cue.position, aim.angle, 4);
  const positions = [];
  for (const point of points) {
    positions.push(point.x, BALL_RADIUS + 0.11, point.y);
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
  const contactOffset = -0.18;

  if (progress < 0.22) return easeOut(progress / 0.22) * pullback;
  if (progress < cueShot.impactAt) {
    return lerp(pullback, contactOffset, easeIn((progress - 0.22) / (cueShot.impactAt - 0.22)));
  }
  if (progress < cueShot.impulseAt) return contactOffset;
  return contactOffset * (1 - easeOut((progress - cueShot.impulseAt) / (1 - cueShot.impulseAt)));
}

function updateAimFromPointer(event) {
  if (isMoving()) return;

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
  if (action === "camera-up") cameraOrbit.phi = clamp(cameraOrbit.phi - 0.055, 0.42, 1.2);
  if (action === "camera-down") cameraOrbit.phi = clamp(cameraOrbit.phi + 0.055, 0.42, 1.2);
  if (action === "camera-zoom-in") cameraOrbit.radius = clamp(cameraOrbit.radius - 0.24, 5.3, 10.6);
  if (action === "camera-zoom-out") cameraOrbit.radius = clamp(cameraOrbit.radius + 0.24, 5.3, 10.6);
  if (action === "camera-reset") resetCamera();
}

function applyCameraOrbit(value) {
  const x = clamp(Number(value?.x || 0), -1, 1);
  const y = clamp(Number(value?.y || 0), -1, 1);
  cameraOrbit.theta -= x * 0.045;
  cameraOrbit.phi = clamp(cameraOrbit.phi + y * 0.032, 0.42, 1.2);
}

function cameraRelativeAimAngle(value) {
  const x = clamp(Number(value?.x || 0), -1, 1);
  const y = clamp(Number(value?.y || 0), -1, 1);
  if (Math.hypot(x, y) < 0.05) return aim.angle;

  const right = new THREE.Vector2(Math.cos(cameraOrbit.theta), -Math.sin(cameraOrbit.theta));
  const forward = new THREE.Vector2(-Math.sin(cameraOrbit.theta), -Math.cos(cameraOrbit.theta));
  const direction = right.multiplyScalar(x).add(forward.multiplyScalar(-y));
  return Math.atan2(direction.y, direction.x);
}

function updateCamera() {
  const cue = balls.find((ball) => ball.id === "cue" && !ball.sunk);
  const targetX = cue ? cue.position.x * 0.38 : 0;
  const targetZ = cue ? cue.position.y * 0.38 : 0;
  cameraTarget.lerp(new THREE.Vector3(targetX, 0, targetZ), 0.1);

  const sinPhi = Math.sin(cameraOrbit.phi);
  camera.position.set(
    cameraTarget.x + cameraOrbit.radius * sinPhi * Math.sin(cameraOrbit.theta),
    cameraTarget.y + cameraOrbit.radius * Math.cos(cameraOrbit.phi),
    cameraTarget.z + cameraOrbit.radius * sinPhi * Math.cos(cameraOrbit.theta)
  );
  camera.lookAt(cameraTarget);
}

function sendState() {
  if (ws?.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({
    type: "state",
    snapshot: {
      turn: currentTurn,
      moving: isMoving(),
      power: aim.power,
      spin: aim.spin,
      balls: balls.map((ball) => ({
        id: ball.id,
        x: round(ball.position.x),
        y: round(ball.position.y),
        sunk: ball.sunk
      }))
    }
  }));
}

function updateHud() {
  const currentSuit = gameState.assignments[currentTurn];
  turnEl.textContent = `Jogador ${currentTurn}${currentSuit ? ` - ${suitLabel(currentSuit)}` : ""}`;
  powerMeter.value = aim.power;
  playersEl.textContent = `${players.length}/2`;
  assignmentsEl.innerHTML = [1, 2].map((playerId) => playerAssignmentMarkup(playerId)).join("");
  sendState();
}

function isMoving() {
  return cueShot.active || balls.some((ball) => !ball.sunk && ball.velocity.lengthSq() > STOP_SPEED * STOP_SPEED);
}

function applyBallSpin(ball, dt) {
  if (ball.spin.lengthSq() <= 0 || ball.velocity.lengthSq() <= 0) return;
  const side = new THREE.Vector2(-ball.velocity.y, ball.velocity.x);
  if (side.lengthSq() > 0) side.normalize();
  ball.velocity.addScaledVector(side, ball.spin.x * dt * 0.38);
  ball.velocity.addScaledVector(ball.velocity.clone().normalize(), ball.spin.y * dt * 0.16);
}

function buildTable() {
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(32, 24),
    new THREE.MeshStandardMaterial({ color: 0x192022, roughness: 0.9 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const feltMaterial = new THREE.MeshStandardMaterial({ color: 0x45b82f, roughness: 0.9 });
  const cushionMaterial = new THREE.MeshStandardMaterial({ color: 0x2f8f1f, roughness: 0.86 });
  const railMaterial = new THREE.MeshStandardMaterial({ map: makeWoodTexture(), roughness: 0.34 });
  const apronMaterial = new THREE.MeshStandardMaterial({ map: makeWoodTexture(0.62), roughness: 0.42 });
  const metalMaterial = new THREE.MeshStandardMaterial({ color: 0xd0a13d, roughness: 0.2, metalness: 0.75 });

  const apron = new THREE.Mesh(
    new THREE.BoxGeometry(TABLE_WIDTH + RAIL_THICKNESS * 2 + TABLE_APRON, 0.24, TABLE_HEIGHT + RAIL_THICKNESS * 2 + TABLE_APRON),
    apronMaterial
  );
  apron.position.y = -0.16;
  apron.castShadow = true;
  apron.receiveShadow = true;
  tableGroup.add(apron);

  const bed = new THREE.Mesh(
    new THREE.BoxGeometry(TABLE_WIDTH, 0.12, TABLE_HEIGHT),
    feltMaterial
  );
  bed.position.y = -0.005;
  bed.receiveShadow = true;
  tableGroup.add(bed);

  const cornerRailGap = POCKET_RAIL_GAP * 0.48;
  const sideRailGap = POCKET_RAIL_GAP;
  const longRailLength = (TABLE_WIDTH - sideRailGap - cornerRailGap * 2) / 2;
  const longRailOffset = sideRailGap / 2 + longRailLength / 2;
  const shortRailLength = TABLE_HEIGHT - cornerRailGap * 2;
  const railZ = TABLE_HEIGHT / 2 + RAIL_THICKNESS / 2;
  const railX = TABLE_WIDTH / 2 + RAIL_THICKNESS / 2;

  addRail(longRailLength, RAIL_THICKNESS, -longRailOffset, railZ, railMaterial, cushionMaterial, "horizontal");
  addRail(longRailLength, RAIL_THICKNESS, longRailOffset, railZ, railMaterial, cushionMaterial, "horizontal");
  addRail(longRailLength, RAIL_THICKNESS, -longRailOffset, -railZ, railMaterial, cushionMaterial, "horizontal");
  addRail(longRailLength, RAIL_THICKNESS, longRailOffset, -railZ, railMaterial, cushionMaterial, "horizontal");
  addRail(RAIL_THICKNESS, shortRailLength, railX, 0, railMaterial, cushionMaterial, "vertical");
  addRail(RAIL_THICKNESS, shortRailLength, -railX, 0, railMaterial, cushionMaterial, "vertical");
  addRailTopVeneer(railMaterial);

  for (const pocket of pockets()) {
    addPocketAssembly(pocket);
  }

  addDiamonds(metalMaterial);
  addFeltMarkings(metalMaterial);
  addTableBase(apronMaterial);
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
  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x211426, roughness: 0.78 });
  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x3a1720, roughness: 0.58 });

  const roomWidth = 24;
  const roomDepth = 18;
  const wallHeight = 4.2;
  const wallY = 1.85;
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(roomWidth, wallHeight, 0.18), wallMaterial);
  backWall.position.set(0, wallY, -roomDepth / 2);
  backWall.receiveShadow = true;
  scene.add(backWall);

  const frontWall = backWall.clone();
  frontWall.position.z = roomDepth / 2;
  scene.add(frontWall);

  const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.18, wallHeight, roomDepth), wallMaterial);
  leftWall.position.set(-roomWidth / 2, wallY, 0);
  leftWall.receiveShadow = true;
  scene.add(leftWall);

  const rightWall = leftWall.clone();
  rightWall.position.x = roomWidth / 2;
  scene.add(rightWall);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(roomWidth + 4, roomDepth + 4), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.96;
  floor.receiveShadow = true;
  scene.add(floor);

  addBottleShelf(-3.9, -5.55);
  addBottleShelf(3.6, -5.55);
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
  const x = TABLE_WIDTH / 2;
  const y = TABLE_HEIGHT / 2;
  return [
    new THREE.Vector2(-x, -y),
    new THREE.Vector2(0, -y - 0.04),
    new THREE.Vector2(x, -y),
    new THREE.Vector2(-x, y),
    new THREE.Vector2(0, y + 0.04),
    new THREE.Vector2(x, y)
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
  if (!number) {
    return new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.34, metalness: 0.02 });
  }

  const texture = makeBallTexture(number, color, ballSuit(number));
  return new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.34,
    metalness: 0.02
  });
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
  const subtitle = suit
    ? `Faltam: ${remaining.length ? remaining.join(", ") : "bola 8"}`
    : "Grupo aberto";

  return `
    <div class="assignment-card">
      <span class="label">Jogador ${playerId}</span>
      <strong>${suit ? suitLabel(suit) : "A definir"}</strong>
      <small>${subtitle}</small>
    </div>
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
