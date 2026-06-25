(() => {
  const params = new URLSearchParams(window.location.search);
  const code = String(params.get("code") || "").toUpperCase();
  const statusEl = document.querySelector("#status");
  const startOverlay = document.querySelector("#startOverlay");
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
  const menuBtn = document.querySelector("#menuBtn");
  const controllerMenu = document.querySelector("#controllerMenu");
  const closeMenuBtn = document.querySelector("#closeMenuBtn");
  const soundToggleBtn = document.querySelector("#soundToggleBtn");
  const restartGameBtn = document.querySelector("#restartGameBtn");
  const friendsModeBtn = document.querySelector("#friendsModeBtn");
  const aiModeBtn = document.querySelector("#aiModeBtn");
  const difficultyButtons = Array.from(document.querySelectorAll("[data-ai-difficulty]"));
  const shotClockToggleBtn = document.querySelector("#shotClockToggleBtn");
  const penaltyChoice = document.querySelector("#penaltyChoice");
  const penaltyBalls = document.querySelector("#penaltyBalls");

  let playerId = 0;
  let currentTurn = 1;
  let moving = true;
  let ballInHand = false;
  let gameMessage = "";
  let winner = null;
  let audioEnabled = false;
  let aiEnabled = false;
  let aiDifficulty = "normal";
  let shotClockEnabled = true;
  let shotClockRemaining = 60000;
  let pendingRemoveChoice = null;
  let power = 0.45;
  let spin = { x: 0, y: 0 };
  let joystickPointerId = null;
  let powerPointerId = null;
  let spinPointerId = null;
  let cameraPointerId = null;
  let cameraVector = { x: 0, y: 0 };
  let cameraTimer = null;
  let ws;

  const AIM_SENSITIVITY = 0.46;
  const BALL_IN_HAND_SENSITIVITY = 0.62;
  const CAMERA_SENSITIVITY = 0.38;
  const ANALOG_DEADZONE = 0.12;

  connect();
  installFullscreenUnlock();

  shootButton.addEventListener("click", () => {
    sendInput("shoot", power);
  });

  menuBtn?.addEventListener("click", () => setMenuOpen(true));
  closeMenuBtn?.addEventListener("click", () => setMenuOpen(false));
  controllerMenu?.addEventListener("click", (event) => {
    if (event.target === controllerMenu) setMenuOpen(false);
  });
  soundToggleBtn?.addEventListener("click", () => {
    audioEnabled = !audioEnabled;
    sendInput("audio-set", audioEnabled);
    renderMenuState();
  });
  restartGameBtn?.addEventListener("click", () => {
    sendInput("reset-game");
    setMenuOpen(false);
  });
  friendsModeBtn?.addEventListener("click", () => {
    aiEnabled = false;
    sendInput("set-ai-mode", { enabled: false, difficulty: aiDifficulty });
    renderMenuState();
  });
  aiModeBtn?.addEventListener("click", () => {
    aiEnabled = true;
    sendInput("set-ai-mode", { enabled: true, difficulty: aiDifficulty });
    renderMenuState();
  });
  difficultyButtons.forEach((button) => {
    button.addEventListener("click", () => {
      aiDifficulty = button.dataset.aiDifficulty || "normal";
      aiEnabled = true;
      sendInput("set-ai-mode", { enabled: true, difficulty: aiDifficulty });
      renderMenuState();
    });
  });
  shotClockToggleBtn?.addEventListener("click", () => {
    shotClockEnabled = !shotClockEnabled;
    sendInput("set-shot-clock", shotClockEnabled);
    renderMenuState();
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
        ballInHand = !!msg.snapshot.ballInHand;
        gameMessage = String(msg.snapshot.message || "");
        winner = msg.snapshot.winner || null;
        audioEnabled = !!msg.snapshot.audioEnabled;
        pendingRemoveChoice = msg.snapshot.pendingRemoveChoice || null;
        shotClockEnabled = msg.snapshot.shotClockEnabled !== false;
        shotClockRemaining = Number(msg.snapshot.shotClockRemaining || 0);
        if (msg.snapshot.ai) {
          aiEnabled = !!msg.snapshot.ai.enabled;
          aiDifficulty = msg.snapshot.ai.difficulty || aiDifficulty;
        }
        renderMenuState();
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

    const nx = clamp(x / radius, -1, 1);
    const ny = clamp(y / radius, -1, 1);
    const analogPower = Math.hypot(nx, ny);
    if (analogPower > ANALOG_DEADZONE) {
      const sensitivity = ballInHand ? BALL_IN_HAND_SENSITIVITY : AIM_SENSITIVITY;
      sendInput(ballInHand ? "place-cue" : "aim-vector", {
        x: clamp(nx * sensitivity, -1, 1),
        y: clamp(ny * sensitivity, -1, 1)
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

    const nx = clamp(x / radius, -1, 1);
    const ny = clamp(y / radius, -1, 1);
    cameraVector = {
      x: Math.hypot(nx, ny) < ANALOG_DEADZONE ? 0 : clamp(nx * CAMERA_SENSITIVITY, -1, 1),
      y: Math.hypot(nx, ny) < ANALOG_DEADZONE ? 0 : clamp(ny * CAMERA_SENSITIVITY, -1, 1)
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

  function setMenuOpen(open) {
    if (!controllerMenu) return;
    controllerMenu.classList.toggle("is-open", open);
    controllerMenu.setAttribute("aria-hidden", open ? "false" : "true");
    menuBtn?.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function renderMenuState() {
    if (soundToggleBtn) {
      soundToggleBtn.textContent = audioEnabled ? "🔇 Desligar som da mesa" : "🔊 Ligar som da mesa";
      soundToggleBtn.classList.toggle("is-on", audioEnabled);
    }
    if (restartGameBtn) {
      restartGameBtn.disabled = !playerId;
      restartGameBtn.title = playerId ? "Reiniciar partida" : "Conecte na sala primeiro";
    }
    friendsModeBtn?.classList.toggle("is-on", !aiEnabled);
    aiModeBtn?.classList.toggle("is-on", aiEnabled);
    difficultyButtons.forEach((button) => {
      button.classList.toggle("is-on", aiEnabled && button.dataset.aiDifficulty === aiDifficulty);
    });
    if (shotClockToggleBtn) {
      shotClockToggleBtn.textContent = shotClockEnabled ? "⏱️ Desligar timer de 1 minuto" : "⏱️ Ligar timer de 1 minuto";
      shotClockToggleBtn.classList.toggle("is-on", shotClockEnabled);
    }
  }

  function updateControls() {
    const isTurn = playerId === currentTurn;
    const hasPenaltyChoice = pendingRemoveChoice && pendingRemoveChoice.player === playerId;
    renderPenaltyChoice(hasPenaltyChoice);
    shootButton.disabled = !isTurn || moving || !!winner || !!pendingRemoveChoice;
    document.body.classList.toggle("is-ball-in-hand", ballInHand && isTurn);

    if (hasPenaltyChoice) {
      turnChip.textContent = "Escolha uma bola para remover";
      shootButton.textContent = "Aguardando escolha";
      shootButton.disabled = true;
      return;
    }

    if (pendingRemoveChoice) {
      turnChip.textContent = `Jogador ${pendingRemoveChoice.player} escolhendo uma bola`;
      shootButton.disabled = true;
      return;
    }

    if (winner) {
      turnChip.textContent = `Jogador ${winner} venceu`;
      shootButton.textContent = "Fim";
      return;
    }

    if (ballInHand) {
      if (isTurn) {
        turnChip.textContent = "Bola na mão: mova a branca";
        shootButton.textContent = "Confirmar posição";
        shootButton.disabled = false;
      } else {
        turnChip.textContent = `Jogador ${currentTurn} posicionando a branca`;
        shootButton.textContent = "Tacada";
      }
      return;
    }

    renderMenuState();
    shootButton.textContent = "Tacada";
    const timerText = shotClockEnabled && isTurn && !moving ? ` · ${Math.ceil(shotClockRemaining / 1000)}s` : "";
    turnChip.textContent = isTurn
      ? moving ? "Aguarde as bolas" : `${gameMessage || "Sua vez"}${timerText}`
      : `Vez do jogador ${currentTurn}`;
  }

  function renderPenaltyChoice(active) {
    if (!penaltyChoice || !penaltyBalls) return;
    penaltyChoice.classList.toggle("is-open", !!active);
    penaltyChoice.setAttribute("aria-hidden", active ? "false" : "true");
    if (!active || !pendingRemoveChoice) {
      penaltyBalls.innerHTML = "";
      return;
    }
    penaltyBalls.innerHTML = pendingRemoveChoice.choices.map((number) => `
      <button type="button" class="penalty-ball" data-number="${number}" aria-label="Remover bola ${number}">
        <img src="/assets/pool-table/${number}ball.png" alt="Bola ${number}" />
      </button>
    `).join("");
    penaltyBalls.querySelectorAll("[data-number]").forEach((button) => {
      button.addEventListener("click", () => {
        sendInput("remove-ball-choice", Number(button.dataset.number));
      }, { once: true });
    });
  }

  function installFullscreenUnlock() {
    let unlockInFlight = false;

    const showUnlockPrompt = () => {
      document.body.classList.remove("controller-unlocked");
      if (startOverlay) startOverlay.classList.remove("is-hidden");
    };

    const hideUnlockPrompt = () => {
      document.body.classList.add("controller-unlocked");
      if (startOverlay) startOverlay.classList.add("is-hidden");
    };

    const requestControllerFullscreen = async () => {
      if (unlockInFlight) return;
      unlockInFlight = true;

      try {
        const target = document.documentElement;
        if (!document.fullscreenElement && target.requestFullscreen) {
          await target.requestFullscreen({ navigationUI: "hide" });
        }
      } catch {
        // Chrome/Android só libera em gesto real; se falhar, mostramos o botão de novo.
      }

      try {
        if (screen.orientation?.lock) {
          await screen.orientation.lock("landscape");
        }
      } catch {
        // Em alguns celulares o lock só funciona se o fullscreen foi aceito.
      }

      unlockInFlight = false;

      if (document.fullscreenElement || window.matchMedia("(orientation: landscape)").matches) {
        hideUnlockPrompt();
      } else {
        showUnlockPrompt();
      }
    };

    const bindUnlock = (element) => {
      if (!element) return;
      element.addEventListener("click", (event) => {
        event.preventDefault();
        requestControllerFullscreen();
      });
      element.addEventListener("touchend", (event) => {
        event.preventDefault();
        requestControllerFullscreen();
      }, { passive: false });
    };

    bindUnlock(startOverlay);
    bindUnlock(document.querySelector(".landscape-warning"));

    document.addEventListener("fullscreenchange", () => {
      if (document.fullscreenElement) {
        hideUnlockPrompt();
      } else {
        showUnlockPrompt();
      }
    });

    window.addEventListener("orientationchange", () => {
      setTimeout(() => {
        if (document.fullscreenElement || window.matchMedia("(orientation: landscape)").matches) {
          hideUnlockPrompt();
        }
      }, 250);
    });
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
