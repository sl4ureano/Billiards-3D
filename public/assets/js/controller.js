(() => {
  const params = new URLSearchParams(window.location.search);
  const code = String(params.get("code") || "").toUpperCase();
  const statusEl = document.querySelector("#status");
  const turnChip = document.querySelector("#turnChip");
  const shootButton = document.querySelector("#shoot");
  const joystick = document.querySelector("#joystick");
  const joystickKnob = document.querySelector("#joystickKnob");
  const powerPad = document.querySelector("#powerPad");
  const powerFill = document.querySelector("#powerFill");
  const powerThumb = document.querySelector("#powerThumb");
  const spinBall = document.querySelector("#spinBall");
  const spinDot = document.querySelector("#spinDot");
  const cameraOrbit = document.querySelector("#cameraOrbit");
  const cameraKnob = document.querySelector("#cameraKnob");

  let playerId = 0;
  let currentTurn = 1;
  let moving = true;
  let power = 0.45;
  let spin = { x: 0, y: 0 };
  let joystickPointerId = null;
  let powerPointerId = null;
  let spinPointerId = null;
  let cameraPointerId = null;
  let cameraVector = { x: 0, y: 0 };
  let cameraTimer = null;
  let ws;

  connect();

  shootButton.addEventListener("click", () => {
    sendInput("shoot", power);
  });

  joystick.addEventListener("pointerdown", (event) => {
    joystickPointerId = event.pointerId;
    joystick.setPointerCapture(event.pointerId);
    updateJoystick(event);
  });

  joystick.addEventListener("pointermove", (event) => {
    if (event.pointerId === joystickPointerId) updateJoystick(event);
  });

  joystick.addEventListener("pointerup", endJoystick);
  joystick.addEventListener("pointercancel", endJoystick);

  powerPad.addEventListener("pointerdown", (event) => {
    powerPointerId = event.pointerId;
    powerPad.setPointerCapture(event.pointerId);
    updatePower(event);
  });

  powerPad.addEventListener("pointermove", (event) => {
    if (event.pointerId === powerPointerId) updatePower(event);
  });

  powerPad.addEventListener("pointerup", endPower);
  powerPad.addEventListener("pointercancel", endPower);
  spinBall.addEventListener("pointerdown", (event) => {
    spinPointerId = event.pointerId;
    spinBall.setPointerCapture(event.pointerId);
    updateSpin(event);
  });

  spinBall.addEventListener("pointermove", (event) => {
    if (event.pointerId === spinPointerId) updateSpin(event);
  });

  spinBall.addEventListener("pointerup", endSpin);
  spinBall.addEventListener("pointercancel", endSpin);
  cameraOrbit.addEventListener("pointerdown", (event) => {
    cameraPointerId = event.pointerId;
    cameraOrbit.setPointerCapture(event.pointerId);
    updateCameraOrbit(event);
    cameraTimer = setInterval(sendCameraOrbit, 60);
  });

  cameraOrbit.addEventListener("pointermove", (event) => {
    if (event.pointerId === cameraPointerId) updateCameraOrbit(event);
  });

  cameraOrbit.addEventListener("pointerup", endCameraOrbit);
  cameraOrbit.addEventListener("pointercancel", endCameraOrbit);
  cameraOrbit.addEventListener("lostpointercapture", () => {
    clearInterval(cameraTimer);
    cameraTimer = null;
    cameraPointerId = null;
    cameraVector = { x: 0, y: 0 };
    cameraKnob.style.transform = "translate(0, 0)";
  });
  document.querySelectorAll("[data-camera]").forEach((button) => {
    let repeatTimer = null;
    const action = button.dataset.camera;

    const stopRepeat = () => {
      clearInterval(repeatTimer);
      repeatTimer = null;
    };

    button.addEventListener("pointerdown", (event) => {
      button.setPointerCapture(event.pointerId);
      sendInput(`camera-${action}`);
      repeatTimer = setInterval(() => sendInput(`camera-${action}`), 80);
    });

    button.addEventListener("pointerup", stopRepeat);
    button.addEventListener("pointercancel", stopRepeat);
    button.addEventListener("lostpointercapture", stopRepeat);
  });
  renderPower();
  renderSpin();

  function connect() {
    if (!code) {
      statusEl.textContent = "Codigo ausente";
      return;
    }

    ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`);

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ type: "join-controller", code }));
      statusEl.textContent = `Sala ${code}`;
    });

    ws.addEventListener("message", (event) => {
      const msg = parseMessage(event.data);
      if (!msg) return;

      if (msg.type === "controller-ready") {
        playerId = msg.playerId;
        statusEl.textContent = `Jogador ${playerId} na sala ${msg.code}`;
        updateControls();
      }

      if (msg.type === "state" && msg.snapshot) {
        currentTurn = msg.snapshot.turn || 1;
        moving = !!msg.snapshot.moving;
        if (typeof msg.snapshot.power === "number" && powerPointerId === null) {
          power = msg.snapshot.power;
          renderPower();
        }
        updateControls();
      }

      if (msg.type === "host-left") {
        turnChip.textContent = "Mesa desconectada";
        shootButton.disabled = true;
      }

      if (msg.type === "error") {
        statusEl.textContent = msg.message || "Erro";
        shootButton.disabled = true;
      }
    });

    ws.addEventListener("close", () => {
      statusEl.textContent = "Reconectando...";
      shootButton.disabled = true;
      setTimeout(connect, 900);
    });
  }

  function sendInput(action, value = true) {
    if (ws?.readyState !== WebSocket.OPEN || !playerId) return;
    ws.send(JSON.stringify({ type: "input", action, value }));
  }

  function updateJoystick(event) {
    const rect = joystick.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const radius = rect.width * 0.38;
    const rawX = event.clientX - centerX;
    const rawY = event.clientY - centerY;
    const distance = Math.hypot(rawX, rawY);
    const limited = Math.min(distance, radius);
    const x = distance ? (rawX / distance) * limited : 0;
    const y = distance ? (rawY / distance) * limited : 0;

    joystickKnob.style.transform = `translate(${x}px, ${y}px)`;

    if (distance > rect.width * 0.08) {
      sendInput("aim-vector", {
        x: clamp(x / radius, -1, 1),
        y: clamp(y / radius, -1, 1)
      });
    }
  }

  function endJoystick(event) {
    if (event.pointerId !== joystickPointerId) return;
    joystickPointerId = null;
    joystickKnob.style.transform = "translate(0, 0)";
  }

  function updatePower(event) {
    const rect = powerPad.getBoundingClientRect();
    const position = 1 - (event.clientY - rect.top) / rect.height;
    power = clamp(position, 0.12, 1);
    renderPower();
    sendInput("power", power);
  }

  function endPower(event) {
    if (event.pointerId === powerPointerId) powerPointerId = null;
  }

  function updateSpin(event) {
    const rect = spinBall.getBoundingClientRect();
    const radius = rect.width * 0.39;
    const rawX = event.clientX - (rect.left + rect.width / 2);
    const rawY = event.clientY - (rect.top + rect.height / 2);
    const distance = Math.hypot(rawX, rawY);
    const limited = Math.min(distance, radius);
    const x = distance ? (rawX / distance) * limited : 0;
    const y = distance ? (rawY / distance) * limited : 0;

    spin = {
      x: clamp(x / radius, -1, 1),
      y: clamp(-y / radius, -1, 1)
    };
    renderSpin();
    sendInput("spin", spin);
  }

  function endSpin(event) {
    if (event.pointerId === spinPointerId) spinPointerId = null;
  }

  function updateCameraOrbit(event) {
    const rect = cameraOrbit.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const radius = rect.width * 0.38;
    const rawX = event.clientX - centerX;
    const rawY = event.clientY - centerY;
    const distance = Math.hypot(rawX, rawY);
    const limited = Math.min(distance, radius);
    const x = distance ? (rawX / distance) * limited : 0;
    const y = distance ? (rawY / distance) * limited : 0;

    cameraVector = {
      x: clamp(x / radius, -1, 1),
      y: clamp(y / radius, -1, 1)
    };
    cameraKnob.style.transform = `translate(${x}px, ${y}px)`;
    sendCameraOrbit();
  }

  function endCameraOrbit(event) {
    if (event.pointerId !== cameraPointerId) return;
    cameraPointerId = null;
    clearInterval(cameraTimer);
    cameraTimer = null;
    cameraVector = { x: 0, y: 0 };
    cameraKnob.style.transform = "translate(0, 0)";
  }

  function sendCameraOrbit() {
    if (Math.hypot(cameraVector.x, cameraVector.y) < 0.05) return;
    sendInput("camera-orbit", cameraVector);
  }

  function renderSpin() {
    const radius = spinBall.clientWidth * 0.39;
    spinDot.style.transform = `translate(calc(-50% + ${spin.x * radius}px), calc(-50% + ${-spin.y * radius}px))`;
  }

  function renderPower() {
    const percent = Math.round(power * 100);
    powerFill.style.height = `${percent}%`;
    powerThumb.style.bottom = `${percent}%`;
    powerPad.setAttribute("aria-valuenow", String(percent));
  }

  function updateControls() {
    const isTurn = playerId === currentTurn;
    shootButton.disabled = !isTurn || moving;
    turnChip.textContent = isTurn
      ? moving ? "Aguarde as bolas" : "Sua vez"
      : `Vez do jogador ${currentTurn}`;
  }

  function parseMessage(data) {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }
})();
