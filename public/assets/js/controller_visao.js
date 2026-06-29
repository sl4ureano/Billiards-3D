(() => {
  const params = new URLSearchParams(window.location.search);
  const code = String(params.get("code") || "").toUpperCase();

  const shell = document.querySelector(".shell");
  const video = document.querySelector("#video");
  const canvas = document.querySelector("#overlay");
  const ctx = canvas.getContext("2d", { alpha: true });
  const start = document.querySelector("#start");
  const startBtn = document.querySelector("#startBtn");
  const statusEl = document.querySelector("#status");
  const turnEl = document.querySelector("#turn");
  const gestureEl = document.querySelector("#gesture");
  const motionMeter = document.querySelector("#motionMeter");
  const powerMeter = document.querySelector("#powerMeter");
  const calibrateBtn = document.querySelector("#calibrateBtn");
  const modeBtn = document.querySelector("#modeBtn");
  const cameraBtn = document.querySelector("#cameraBtn");
  const startStatusEl = document.querySelector("#startStatus");

  const SAMPLE_W = 96;
  const SAMPLE_H = 54;
  const DIFF_THRESHOLD = 26;
  const SEND_INTERVAL_MS = 70;
  const AIM_SEND_INTERVAL_MS = 170;
  const POWER_SEND_INTERVAL_MS = 55;
  const SHOOT_COOLDOWN_MS = 1400;
  const DEADZONE = 0.055;
  const AIM_SMOOTHING = 0.91;
  const AIM_TURN_DEADZONE = 0.18;
  const AIM_FAST_THRESHOLD = 0.52;
  const POWER_SENSITIVITY = 1.35;
  const HAND_SEND_FPS = 16;
  const FIST_HOLD_MS = 120;
  const SHOOT_MOTION_THRESHOLD = 0.78;
  const SHOOT_CENTER_RATIO = 0.42;
  const SHOOT_MIN_CENTER_BURST = 18;
  const GESTURE_CLICK_COOLDOWN_MS = 850;
  const AIM_ZONE = { x1: 0.06, y1: 0.16, x2: 0.46, y2: 0.84 };
  const POWER_ZONE = { x1: 0.54, y1: 0.16, x2: 0.94, y2: 0.84 };
  const ZONE_MARGIN = 0.015;

  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = SAMPLE_W;
  sampleCanvas.height = SAMPLE_H;
  const sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true });

  let ws;
  let playerId = 0;
  let currentTurn = 1;
  let moving = true;
  let ballInHand = false;
  let winner = null;
  let power = 0.45;
  let previousFrame = null;
  let baseline = null;
  let lastSend = 0;
  let lastShoot = 0;
  let smoothedAimX = 0;
  let smoothedPlaceY = 0;
  let smoothedTurnX = 0;
  let lastAimSend = 0;
  let lastPowerSend = 0;
  let mode = "aim";
  let raf = 0;
  let appWidth = 0;
  let appHeight = 0;

  let hands = null;
  let handBusy = false;
  let lastHandSend = 0;
  let latestHand = null;
  let latestHands = [];
  let handTrackingReady = false;
  let calibratedAimHand = null;
  let calibratedPowerHand = null;
  let calibratedHand = null;
  let calibratedPower = power;
  let fistSince = 0;
  let wasFist = false;
  let lastGestureClick = 0;
  let clickedButtonWhileFist = false;

  startBtn.addEventListener("click", startCamera);
  calibrateBtn.addEventListener("click", calibrate);
  cameraBtn.addEventListener("click", () => sendInput("camera-reset"));
  modeBtn.addEventListener("click", () => {
    mode = mode === "aim" ? "camera" : "aim";
    modeBtn.textContent = `Modo: ${mode === "aim" ? "mira" : "câmera"}`;
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelAnimationFrame(raf);
    else if (video.srcObject) raf = requestAnimationFrame(tick);
  });

  setupResponsiveViewport();
  connect();

  async function startCamera() {
    startBtn.disabled = true;
    startBtn.textContent = "Abrindo câmera...";
    setStartStatus("Solicitando permissão da câmera...");

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Este navegador não expõe getUserMedia. No celular/TV, use HTTPS ou localhost.");
      }

      // Para getUserMedia funcionar fora de localhost, o navegador exige HTTPS.
      if (!window.isSecureContext && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
        throw new Error("A câmera exige HTTPS. Abra a URL com https:// ou teste em localhost.");
      }

      stopCameraStream();

      const stream = await openCameraWithFallback();
      video.setAttribute("playsinline", "");
      video.setAttribute("webkit-playsinline", "");
      video.muted = true;
      video.autoplay = true;
      video.srcObject = stream;

      await waitForVideoToStart();

      handleViewportChange();
      await initHandTracking();
      hideStartModal();
      statusEl.textContent = handTrackingReady ? "Câmera + mão ativa" : "Câmera ativa · fallback por movimento";
      setStartStatus("");
      calibrate();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
      requestFullscreenSoft();
    } catch (error) {
      console.error("Erro ao abrir câmera:", error);
      statusEl.textContent = "Erro ao abrir câmera";
      showStartModal(formatCameraError(error));
    } finally {
      startBtn.disabled = false;
      startBtn.textContent = "Ativar câmera";
    }
  }

  async function openCameraWithFallback() {
    const attempts = [
      {
        audio: false,
        video: {
          facingMode: { ideal: "user" },
          width: { ideal: 640 },
          height: { ideal: 360 },
          frameRate: { ideal: 24, max: 30 }
        }
      },
      {
        audio: false,
        video: {
          facingMode: "user",
          width: { ideal: 320 },
          height: { ideal: 240 },
          frameRate: { ideal: 15, max: 24 }
        }
      },
      { audio: false, video: true }
    ];

    let lastError;
    for (const constraints of attempts) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("Não foi possível abrir nenhuma câmera.");
  }

  function waitForVideoToStart() {
    return new Promise((resolve, reject) => {
      let done = false;
      const timeout = setTimeout(() => finish(false), 7000);

      function finish(ok) {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        video.removeEventListener("loadedmetadata", onReady);
        video.removeEventListener("canplay", onReady);
        video.removeEventListener("playing", onReady);
        video.removeEventListener("error", onError);
        ok ? resolve() : reject(new Error("A câmera abriu, mas o vídeo não iniciou. Toque novamente em Ativar câmera."));
      }

      async function onReady() {
        try {
          await video.play();
        } catch (error) {
          // Em alguns WebViews o primeiro play falha, mas o evento playing chega logo depois.
        }
        if (video.videoWidth > 0 && video.videoHeight > 0) finish(true);
      }

      function onError() {
        finish(false);
      }

      video.addEventListener("loadedmetadata", onReady);
      video.addEventListener("canplay", onReady);
      video.addEventListener("playing", onReady);
      video.addEventListener("error", onError);

      video.play().then(onReady).catch(() => {});
    });
  }

  function stopCameraStream() {
    const stream = video.srcObject;
    if (stream?.getTracks) stream.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
    previousFrame = null;
  }

  function formatCameraError(error) {
    const name = error?.name || "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError") return "Permissão da câmera negada. Libere a câmera no navegador e tente novamente.";
    if (name === "NotFoundError" || name === "DevicesNotFoundError") return "Nenhuma câmera foi encontrada nesse dispositivo.";
    if (name === "NotReadableError" || name === "TrackStartError") return "A câmera está ocupada por outro app ou o navegador bloqueou o acesso.";
    if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") return "A câmera não aceitou a resolução solicitada. Tente novamente; o fallback será usado.";
    return error?.message || "Não foi possível abrir a câmera.";
  }

  function hideStartModal() {
    start.hidden = true;
    start.classList.add("is-hidden");
    start.setAttribute("aria-hidden", "true");
  }

  function showStartModal(message) {
    start.hidden = false;
    start.classList.remove("is-hidden");
    start.removeAttribute("aria-hidden");
    if (message) {
      gestureEl.textContent = message;
      setStartStatus(message);
    }
  }

  function setStartStatus(message) {
    if (startStatusEl) startStatusEl.textContent = message || "";
  }

  function connect() {
    if (!code) {
      statusEl.textContent = "Código ausente";
      return;
    }
    ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`);

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ type: "join-controller", code }));
      statusEl.textContent = `Conectando na sala ${code}`;
    });

    ws.addEventListener("message", (event) => {
      const msg = parseMessage(event.data);
      if (!msg) return;

      if (msg.type === "controller-ready") {
        playerId = msg.playerId;
        turnEl.textContent = `Jogador ${playerId} · Sala ${msg.code}`;
        statusEl.textContent = "Conectado";
      }

      if (msg.type === "state" && msg.snapshot) {
        currentTurn = msg.snapshot.turn || 1;
        moving = !!msg.snapshot.moving;
        ballInHand = !!msg.snapshot.ballInHand;
        winner = msg.snapshot.winner || null;
        if (typeof msg.snapshot.power === "number") power = clamp(msg.snapshot.power, 0.12, 1);
        renderPower();
      }

      if (msg.type === "host-left") statusEl.textContent = "Mesa desconectada";
      if (msg.type === "error") statusEl.textContent = msg.message || "Erro";
    });

    ws.addEventListener("close", () => {
      statusEl.textContent = "Reconectando...";
      setTimeout(connect, 900);
    });
  }

  function tick(now = performance.now()) {
    if (handTrackingReady) {
      analyzeHand(now);
      pumpHandTracker(now);
    } else {
      analyzeMotion();
    }
    raf = requestAnimationFrame(tick);
  }

  async function initHandTracking() {
    if (!window.Hands) {
      handTrackingReady = false;
      gestureEl.textContent = "MediaPipe não carregou; usando fallback por movimento";
      return;
    }

    try {
      hands = new window.Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
      });

      hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 0,
        minDetectionConfidence: 0.62,
        minTrackingConfidence: 0.58
      });

      hands.onResults((results) => {
        const list = results.multiHandLandmarks || [];
        latestHands = list.map((landmarks, index) => {
          const handedness = results.multiHandedness?.[index]?.label || "";
          return readHand(landmarks, handedness);
        }).sort((a, b) => a.x - b.x);

        // Compatibilidade com o fallback antigo de uma mão.
        latestHand = latestHands[0] || null;
      });

      handTrackingReady = true;
    } catch (error) {
      console.warn("Hand tracking indisponível, usando fallback:", error);
      handTrackingReady = false;
    }
  }

  function pumpHandTracker(now) {
    if (!hands || handBusy || !video.videoWidth || !video.videoHeight) return;
    if (now - lastHandSend < 1000 / HAND_SEND_FPS) return;
    lastHandSend = now;
    handBusy = true;
    hands.send({ image: video }).catch((error) => {
      console.warn("Erro no hand tracking:", error);
      handTrackingReady = false;
    }).finally(() => {
      handBusy = false;
    });
  }

  function readHand(lm, handedness = "") {
    // MediaPipe retorna coordenadas do frame da câmera.
    // A tela renderiza esse frame com object-fit: cover e espelhamento horizontal.
    // Por isso cada landmark precisa ser convertido para o espaço real da interface.
    const palmPoints = [lm[0], lm[5], lm[9], lm[13], lm[17]].map(mediaPipePointToShellPoint);
    const palmX = palmPoints.reduce((acc, point) => acc + point.x, 0) / palmPoints.length;
    const palmY = palmPoints.reduce((acc, point) => acc + point.y, 0) / palmPoints.length;

    const extended = [
      isFingerExtended(lm, 8, 6, 5),
      isFingerExtended(lm, 12, 10, 9),
      isFingerExtended(lm, 16, 14, 13),
      isFingerExtended(lm, 20, 18, 17)
    ].filter(Boolean).length;

    const palmSize = dist(lm[0], lm[9]) || 0.001;
    const tipFold = [8, 12, 16, 20].reduce((acc, idx) => acc + dist(lm[idx], lm[0]) / palmSize, 0) / 4;
    const fist = extended <= 1 && tipFold < 2.05;
    const open = extended >= 3;

    return { x: palmX, y: palmY, open, fist, extended, raw: lm, handedness };
  }

  function isFingerExtended(lm, tip, pip, mcp) {
    const wrist = lm[0];
    const tipDistance = dist(lm[tip], wrist);
    const pipDistance = dist(lm[pip], wrist);
    const mcpDistance = dist(lm[mcp], wrist);
    return tipDistance > pipDistance * 1.08 && tipDistance > mcpDistance * 1.34;
  }

  function analyzeHand(now) {
    renderPower();

    const aimHand = getAimHand();
    const powerHand = getPowerHand();
    drawHandOverlay({ aimHand, powerHand, all: latestHands });

    if (handleButtonGesture(now, latestHands)) {
      motionMeter.style.width = "100%";
      return;
    }

    const isMyTurn = playerId && currentTurn === playerId && !moving && !winner;
    if (!isMyTurn) {
      gestureEl.textContent = currentTurn === playerId ? "Aguardando bolas pararem" : "Aguardando sua vez";
      motionMeter.style.width = "0%";
      fistSince = 0;
      wasFist = false;
      clickedButtonWhileFist = false;
      return;
    }

    if (!aimHand && !powerHand) {
      gestureEl.textContent = "Coloque uma mão em cada área da tela";
      motionMeter.style.width = "0%";
      fistSince = 0;
      wasFist = false;
      clickedButtonWhileFist = false;
      return;
    }

    const aimCenter = calibratedAimHand || calibratedHand || { x: (AIM_ZONE.x1 + AIM_ZONE.x2) / 2, y: 0.5 };
    const powerCenter = calibratedPowerHand || calibratedHand || { x: (POWER_ZONE.x1 + POWER_ZONE.x2) / 2, y: 0.5 };
    const aimDelta = aimHand ? zoneLocalDelta(aimHand, aimCenter, AIM_ZONE) : { x: 0, y: 0 };
    const powerDelta = powerHand ? zoneLocalDelta(powerHand, powerCenter, POWER_ZONE) : { x: 0, y: 0 };
    const aimDx = aimDelta.x;
    const aimDy = aimDelta.y;
    const powerDy = powerDelta.y;
    const activity = clamp((Math.abs(aimDx) + Math.abs(aimDy) + Math.abs(powerDy)) * 0.72, 0, 1);
    motionMeter.style.width = `${Math.round(activity * 100)}%`;

    // Mão direita fechada = tacada/confirmar. A mão esquerda não dispara tacada.
    if (powerHand?.fist) {
      if (!fistSince) fistSince = now;
      const held = now - fistSince >= FIST_HOLD_MS;
      if (held && !wasFist && now - lastShoot > SHOOT_COOLDOWN_MS) {
        wasFist = true;
        lastShoot = now;
        sendInput("shoot", power);
        gestureEl.textContent = ballInHand ? "Mão direita fechada: confirmou" : "Mão direita fechada: tacada";
      } else {
        gestureEl.textContent = "Mão direita fechada detectada";
      }
      return;
    }

    fistSince = 0;
    wasFist = false;
    clickedButtonWhileFist = false;

    if (mode === "camera") {
      const canSend = now - lastSend >= SEND_INTERVAL_MS;
      if (!canSend) return;
      lastSend = now;

      let didCamera = false;
      let didZoom = false;

      // Modo câmera:
      // - área MIRA continua orbitando a câmera;
      // - área FORÇA/TACADA vira zoom in/out;
      // - uma área nunca interfere na outra.
      if (aimHand?.open && (Math.abs(aimDx) > DEADZONE || Math.abs(aimDy) > DEADZONE)) {
        sendInput("camera-orbit", {
          x: clamp(aimDx * 0.50, -1, 1),
          y: clamp(aimDy * 0.38, -1, 1)
        });
        didCamera = true;
      }

      if (powerHand?.open && Math.abs(powerDy) > DEADZONE * 1.25) {
        sendInput(powerDy < 0 ? "camera-zoom-in" : "camera-zoom-out");
        didZoom = true;
      }

      if (didCamera && didZoom) gestureEl.textContent = "Movendo câmera + zoom";
      else if (didCamera) gestureEl.textContent = "Mão esquerda: movendo câmera";
      else if (didZoom) gestureEl.textContent = powerDy < 0 ? "Mão direita: zoom in" : "Mão direita: zoom out";
      else gestureEl.textContent = "Modo câmera: MIRA move · FORÇA dá zoom";
      return;
    }

    let didPower = false;
    let didAim = false;

    // Mão direita aberta: força. O eixo horizontal é ignorado para não atrapalhar a mira.
    if (powerHand?.open && Math.abs(powerDy) > DEADZONE && now - lastPowerSend >= POWER_SEND_INTERVAL_MS) {
      lastPowerSend = now;
      power = clamp(calibratedPower - powerDy * POWER_SENSITIVITY, 0.12, 1);
      sendInput("power", power);
      renderPower();
      didPower = true;
    }

    // Mão esquerda aberta: mira. O eixo vertical é ignorado para ficar estável.
    if (aimHand?.open) {
      if (ballInHand) {
        if ((Math.abs(aimDx) > DEADZONE || Math.abs(aimDy) > DEADZONE) && now - lastAimSend >= AIM_SEND_INTERVAL_MS) {
          lastAimSend = now;
          smoothedAimX = smoothedAimX * AIM_SMOOTHING + aimDx * 1.55 * (1 - AIM_SMOOTHING);
          smoothedPlaceY = smoothedPlaceY * AIM_SMOOTHING + aimDy * 1.15 * (1 - AIM_SMOOTHING);
          sendInput("place-cue", {
            x: clamp(smoothedAimX, -1, 1),
            y: clamp(smoothedPlaceY, -1, 1)
          });
          didAim = true;
        }
      } else {
        smoothedTurnX = smoothedTurnX * AIM_SMOOTHING + aimDx * (1 - AIM_SMOOTHING);
        const turn = smoothedTurnX;
        const absTurn = Math.abs(turn);

        if (absTurn > AIM_TURN_DEADZONE && now - lastAimSend >= AIM_SEND_INTERVAL_MS) {
          lastAimSend = now;
          const action = turn < 0
            ? (absTurn > AIM_FAST_THRESHOLD ? "aim-left" : "fine-left")
            : (absTurn > AIM_FAST_THRESHOLD ? "aim-right" : "fine-right");
          sendInput(action);
          didAim = true;
        }
      }
    }

    if (!aimHand) {
      gestureEl.textContent = powerHand ? "Mão de mira fora da área MIRA" : "Coloque uma mão em cada área";
      return;
    }

    if (!powerHand) {
      gestureEl.textContent = "Mão de força fora da área FORÇA/TACADA";
      return;
    }

    if (!aimHand.open && !powerHand.open) {
      gestureEl.textContent = "Abra as mãos para controlar";
      return;
    }

    if (didAim && didPower) {
      gestureEl.textContent = "Mira + força";
    } else if (didAim) {
      gestureEl.textContent = ballInHand ? "Mão esquerda: posicionando branca" : "Mão esquerda: mirando";
    } else if (didPower) {
      gestureEl.textContent = powerDy < 0 ? "Mão direita: aumentando força" : "Mão direita: diminuindo força";
    } else {
      gestureEl.textContent = "Mão na área MIRA mira · mão na área FORÇA controla força";
    }
  }

  function getAimHand() {
    return pickHandInZone(AIM_ZONE);
  }

  function getPowerHand() {
    return pickHandInZone(POWER_ZONE);
  }

  function pickHandInZone(zone) {
    if (!latestHands.length) return null;
    const candidates = latestHands
      .filter((hand) => isInsideZone(hand, zone, ZONE_MARGIN))
      .sort((a, b) => distanceToZoneCenter(a, zone) - distanceToZoneCenter(b, zone));
    return candidates[0] || null;
  }

  function isInsideZone(hand, zone, margin = 0) {
    if (!hand) return false;
    return hand.x >= zone.x1 - margin && hand.x <= zone.x2 + margin && hand.y >= zone.y1 - margin && hand.y <= zone.y2 + margin;
  }

  function distanceToZoneCenter(hand, zone) {
    const cx = (zone.x1 + zone.x2) / 2;
    const cy = (zone.y1 + zone.y2) / 2;
    return Math.hypot(hand.x - cx, hand.y - cy);
  }

  function zoneLocalDelta(hand, center, zone) {
    const halfW = Math.max((zone.x2 - zone.x1) / 2, 0.001);
    const halfH = Math.max((zone.y2 - zone.y1) / 2, 0.001);
    return {
      x: clamp((hand.x - center.x) / halfW, -1, 1),
      y: clamp((hand.y - center.y) / halfH, -1, 1)
    };
  }

  function drawHandOverlay(data) {
    const aimHand = data?.aimHand || null;
    const powerHand = data?.powerHand || null;
    const all = data?.all || [];

    ctx.clearRect(0, 0, appWidth, appHeight);
    ctx.save();

    ctx.strokeStyle = "rgba(150, 230, 255, .30)";
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 8]);
    drawZoneRect(AIM_ZONE);
    drawZoneRect(POWER_ZONE);
    ctx.setLineDash([]);

    ctx.fillStyle = "rgba(0,0,0,.35)";
    drawZoneHeader(AIM_ZONE);
    drawZoneHeader(POWER_ZONE);
    ctx.fillStyle = "#fff";
    ctx.font = "800 16px system-ui";
    ctx.textAlign = "center";
    drawZoneTitle("MIRA", AIM_ZONE);
    drawZoneTitle("FORÇA / TACADA", POWER_ZONE);

    if (calibratedAimHand) drawCalibrationPoint(calibratedAimHand, "rgba(25, 183, 255, .95)");
    if (calibratedPowerHand) drawCalibrationPoint(calibratedPowerHand, "rgba(255, 230, 109, .95)");

    for (const hand of all) {
      const role = hand === aimHand ? "MIRA" : hand === powerHand ? "FORÇA" : "FORA DA ÁREA";
      drawHandMarker(hand, role);
    }

    ctx.restore();
  }

  function drawZoneRect(zone) {
    ctx.strokeRect(
      appWidth * zone.x1,
      appHeight * zone.y1,
      appWidth * (zone.x2 - zone.x1),
      appHeight * (zone.y2 - zone.y1)
    );
  }

  function drawZoneHeader(zone) {
    ctx.fillRect(
      appWidth * zone.x1,
      appHeight * zone.y1,
      appWidth * (zone.x2 - zone.x1),
      34
    );
  }

  function drawZoneTitle(label, zone) {
    ctx.fillText(label, appWidth * ((zone.x1 + zone.x2) / 2), appHeight * zone.y1 + 23);
  }

  function drawCalibrationPoint(point, color) {
    ctx.beginPath();
    ctx.arc(point.x * appWidth, point.y * appHeight, 10, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  function handleButtonGesture(now, handsList) {
    const hands = (handsList || []).filter((hand) => hand?.fist);
    if (!hands.length) {
      clickedButtonWhileFist = false;
      return false;
    }

    const target = findGestureButton(hands);
    if (!target) return false;

    gestureEl.textContent = `Feche a mão: ${target.textContent.trim()}`;

    if (clickedButtonWhileFist || now - lastGestureClick < GESTURE_CLICK_COOLDOWN_MS) return true;

    clickedButtonWhileFist = true;
    lastGestureClick = now;
    target.click();
    gestureEl.textContent = `Clique: ${target.textContent.trim()}`;
    return true;
  }

  function findGestureButton(handsList) {
    const buttons = [calibrateBtn, modeBtn, cameraBtn].filter(Boolean);
    const rectShell = getShellRect();
    for (const hand of handsList) {
      const x = rectShell.left + hand.x * rectShell.width;
      const y = rectShell.top + hand.y * rectShell.height;
      for (const button of buttons) {
        const rect = button.getBoundingClientRect();
        const pad = 18;
        if (
          x >= rect.left - pad && x <= rect.right + pad &&
          y >= rect.top - pad && y <= rect.bottom + pad
        ) {
          return button;
        }
      }
    }
    return null;
  }

  function drawHandMarker(hand, label) {
    const x = hand.x * appWidth;
    const y = hand.y * appHeight;
    const isPower = label === "FORÇA";
    ctx.beginPath();
    ctx.arc(x, y, hand.fist ? 56 : 36, 0, Math.PI * 2);
    ctx.fillStyle = hand.fist
      ? "rgba(255, 93, 115, .28)"
      : isPower ? "rgba(255, 230, 109, .22)" : "rgba(86, 227, 159, .22)";
    ctx.fill();
    ctx.strokeStyle = hand.fist
      ? "rgba(255, 93, 115, .95)"
      : isPower ? "rgba(255, 230, 109, .95)" : "rgba(86, 227, 159, .95)";
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = "#fff";
    ctx.font = "800 17px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(hand.fist && isPower ? "TACADA" : label, x, y - 48);
  }

  function analyzeMotion() {
    if (!video.videoWidth || !video.videoHeight) return;

    sampleCtx.drawImage(video, 0, 0, SAMPLE_W, SAMPLE_H);
    const frame = sampleCtx.getImageData(0, 0, SAMPLE_W, SAMPLE_H);
    const data = frame.data;

    if (!previousFrame) {
      previousFrame = new Uint8ClampedArray(data);
      return;
    }

    let total = 0;
    let cx = 0;
    let cy = 0;
    let left = 0;
    let right = 0;
    let top = 0;
    let bottom = 0;
    let centerBurst = 0;
    let innerCenterBurst = 0;

    for (let y = 0; y < SAMPLE_H; y += 2) {
      for (let x = 0; x < SAMPLE_W; x += 2) {
        const i = (y * SAMPLE_W + x) * 4;
        const d = Math.abs(data[i] - previousFrame[i]) + Math.abs(data[i + 1] - previousFrame[i + 1]) + Math.abs(data[i + 2] - previousFrame[i + 2]);
        if (d <= DIFF_THRESHOLD) continue;
        const w = Math.min(255, d) / 255;
        total += w;
        cx += x * w;
        cy += y * w;
        if (x < SAMPLE_W * 0.33) left += w;
        else if (x > SAMPLE_W * 0.67) right += w;
        if (y < SAMPLE_H * 0.33) top += w;
        else if (y > SAMPLE_H * 0.67) bottom += w;
        if (x > SAMPLE_W * 0.28 && x < SAMPLE_W * 0.72 && y > SAMPLE_H * 0.18 && y < SAMPLE_H * 0.82) centerBurst += w;
        if (x > SAMPLE_W * 0.40 && x < SAMPLE_W * 0.60 && y > SAMPLE_H * 0.34 && y < SAMPLE_H * 0.66) innerCenterBurst += w;
      }
    }

    previousFrame.set(data);

    const normalizedMotion = clamp(total / 140, 0, 1);
    motionMeter.style.width = `${Math.round(normalizedMotion * 100)}%`;

    drawOverlay(total, cx, cy, normalizedMotion, left, right, top, bottom, centerBurst);
    if (total < 3.2) {
      gestureEl.textContent = "Pouco movimento";
      return;
    }

    const mx = clamp((cx / total - SAMPLE_W / 2) / (SAMPLE_W / 2), -1, 1);
    const my = clamp((cy / total - SAMPLE_H / 2) / (SAMPLE_H / 2), -1, 1);
    const horizontalIntent = clamp((right - left) / Math.max(left + right, 1), -1, 1);
    const verticalIntent = clamp((bottom - top) / Math.max(top + bottom, 1), -1, 1);

    const now = performance.now();
    if (now - lastSend < SEND_INTERVAL_MS) return;
    lastSend = now;

    const isMyTurn = playerId && currentTurn === playerId && !moving && !winner;
    if (!isMyTurn) {
      gestureEl.textContent = currentTurn === playerId ? "Aguardando bolas pararem" : "Aguardando sua vez";
      return;
    }

    const centerRatio = centerBurst / Math.max(total, 1);
    const innerCenterRatio = innerCenterBurst / Math.max(total, 1);
    const sideways = Math.abs(horizontalIntent);
    const vertical = Math.abs(verticalIntent);
    const isStrongCenterGesture =
      normalizedMotion > SHOOT_MOTION_THRESHOLD &&
      centerRatio > SHOOT_CENTER_RATIO &&
      innerCenterBurst > SHOOT_MIN_CENTER_BURST &&
      sideways < 0.36 &&
      vertical < 0.46;

    if (isStrongCenterGesture && now - lastShoot > SHOOT_COOLDOWN_MS) {
      lastShoot = now;
      sendInput("shoot", power);
      gestureEl.textContent = ballInHand ? "Confirmou posição" : "Tacada";
      return;
    }

    if (mode === "camera") {
      if (Math.abs(mx) > DEADZONE || Math.abs(my) > DEADZONE) {
        sendInput("camera-orbit", { x: clamp(mx * 0.28, -1, 1), y: clamp(my * 0.20, -1, 1) });
        gestureEl.textContent = "Movendo câmera";
      } else {
        gestureEl.textContent = "Câmera parada";
      }
      return;
    }

    // Controle simplificado:
    // - esquerda/direita mira.
    // - cima/baixo muda força.
    // - gesto forte no centro dá tacada.
    if (sideways > DEADZONE && sideways >= vertical * 0.9) {
      smoothedAimX = smoothedAimX * AIM_SMOOTHING + horizontalIntent * (1 - AIM_SMOOTHING);
      sendInput(ballInHand ? "place-cue" : "aim-vector", {
        x: clamp(smoothedAimX * AIM_GAIN, -1, 1),
        y: 0
      });
      gestureEl.textContent = ballInHand ? "Movendo branca" : "Mirando";
      return;
    }

    if (vertical > 0.28 && vertical > sideways * 1.15) {
      power = clamp(power - verticalIntent * POWER_STEP, 0.12, 1);
      sendInput("power", power);
      renderPower();
      gestureEl.textContent = verticalIntent < 0 ? "Aumentando força" : "Diminuindo força";
      return;
    }

    if (ballInHand && Math.abs(my) > 0.18) {
      smoothedPlaceY = smoothedPlaceY * AIM_SMOOTHING + my * (1 - AIM_SMOOTHING);
      sendInput("place-cue", { x: 0, y: clamp(smoothedPlaceY * 0.26, -1, 1) });
      gestureEl.textContent = "Ajustando branca";
      return;
    }

    gestureEl.textContent = "Pronto: lado mira, cima/baixo força";
  }

  function drawOverlay(total, cx, cy, motion, left, right, top, bottom, centerBurst) {
    ctx.clearRect(0, 0, appWidth, appHeight);
    ctx.save();
    ctx.strokeStyle = "rgba(150, 230, 255, .38)";
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 8]);
    ctx.strokeRect(appWidth * 0.18, appHeight * 0.12, appWidth * 0.64, appHeight * 0.76);
    ctx.setLineDash([]);

    if (total > 0) {
      const x = appWidth - (cx / total / SAMPLE_W) * appWidth;
      const y = (cy / total / SAMPLE_H) * appHeight;
      const r = 18 + motion * 46;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(25, 183, 255, .20)";
      ctx.fill();
      ctx.strokeStyle = "rgba(25, 183, 255, .9)";
      ctx.stroke();
    }

    const maxZone = Math.max(left, right, top, bottom, centerBurst, 1);
    drawZoneBar("L", 16, appHeight / 2 - 40, left / maxZone);
    drawZoneBar("R", appWidth - 74, appHeight / 2 - 40, right / maxZone);
    drawZoneBar("↑", appWidth / 2 - 28, 84, top / maxZone);
    drawZoneBar("↓", appWidth / 2 - 28, appHeight - 132, bottom / maxZone);
    ctx.restore();
  }

  function drawZoneBar(label, x, y, amount) {
    ctx.fillStyle = "rgba(0,0,0,.42)";
    ctx.fillRect(x, y, 58, 80);
    ctx.fillStyle = "rgba(86, 227, 159, .82)";
    ctx.fillRect(x + 8, y + 68 - amount * 56, 42, amount * 56);
    ctx.fillStyle = "#fff";
    ctx.font = "700 16px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(label, x + 29, y + 22);
  }

  function calibrate() {
    previousFrame = null;
    baseline = performance.now();
    calibratedPower = power;

    const aimHand = getAimHand();
    const powerHand = getPowerHand();

    calibratedAimHand = aimHand ? { x: aimHand.x, y: aimHand.y } : { x: (AIM_ZONE.x1 + AIM_ZONE.x2) / 2, y: 0.5 };
    calibratedPowerHand = powerHand ? { x: powerHand.x, y: powerHand.y } : { x: (POWER_ZONE.x1 + POWER_ZONE.x2) / 2, y: 0.5 };

    // Mantém compatibilidade com trechos antigos/fallback.
    calibratedHand = calibratedAimHand;

    smoothedAimX = 0;
    smoothedPlaceY = 0;
    smoothedTurnX = 0;

    if (aimHand && powerHand) {
      gestureEl.textContent = "Calibrado: esquerda mira, direita força";
    } else if (aimHand) {
      gestureEl.textContent = "Mira calibrada; mostre a mão direita";
    } else if (powerHand) {
      gestureEl.textContent = "Força calibrada; mostre a mão esquerda";
    } else {
      gestureEl.textContent = handTrackingReady ? "Calibrado no centro; mostre as duas mãos" : "Calibrado";
    }
  }

  function renderPower() {
    powerMeter.style.width = `${Math.round(power * 100)}%`;
  }

  function sendInput(action, value = true) {
    if (ws?.readyState !== WebSocket.OPEN || !playerId) return;
    ws.send(JSON.stringify({ type: "input", action, value }));
  }

  function setupResponsiveViewport() {
    handleViewportChange();
    window.addEventListener("resize", handleViewportChange, { passive: true });
    window.addEventListener("orientationchange", () => setTimeout(handleViewportChange, 180), { passive: true });
    window.visualViewport?.addEventListener("resize", handleViewportChange, { passive: true });
    window.visualViewport?.addEventListener("scroll", handleViewportChange, { passive: true });
  }

  function handleViewportChange() {
    const viewport = getViewportSize();
    document.documentElement.style.setProperty("--app-w", `${viewport.width}px`);
    document.documentElement.style.setProperty("--app-h", `${viewport.height}px`);
    resize();
    updateInteractionZones();
  }

  function getViewportSize() {
    const vv = window.visualViewport;
    return {
      width: Math.max(320, Math.round(vv?.width || window.innerWidth || document.documentElement.clientWidth || 320)),
      height: Math.max(240, Math.round(vv?.height || window.innerHeight || document.documentElement.clientHeight || 240))
    };
  }

  function getShellRect() {
    const rect = shell?.getBoundingClientRect?.();
    if (rect?.width && rect?.height) return rect;
    const viewport = getViewportSize();
    return { left: 0, top: 0, width: viewport.width, height: viewport.height };
  }

  function updateInteractionZones() {
    const { width, height } = getShellRect();
    const portrait = height > width;
    const short = height < 560;

    AIM_ZONE.x1 = portrait ? 0.04 : 0.06;
    AIM_ZONE.x2 = portrait ? 0.48 : 0.46;
    POWER_ZONE.x1 = portrait ? 0.52 : 0.54;
    POWER_ZONE.x2 = portrait ? 0.96 : 0.94;

    const y1 = portrait ? 0.24 : short ? 0.22 : 0.16;
    const y2 = portrait ? 0.74 : short ? 0.76 : 0.84;
    AIM_ZONE.y1 = POWER_ZONE.y1 = y1;
    AIM_ZONE.y2 = POWER_ZONE.y2 = y2;
  }

  function mediaPipePointToShellPoint(point) {
    const rect = getShellRect();
    const videoWidth = video.videoWidth || rect.width;
    const videoHeight = video.videoHeight || rect.height;
    const scale = Math.max(rect.width / videoWidth, rect.height / videoHeight);
    const drawWidth = videoWidth * scale;
    const drawHeight = videoHeight * scale;
    const offsetX = (rect.width - drawWidth) / 2;
    const offsetY = (rect.height - drawHeight) / 2;

    const videoX = point.x * videoWidth;
    const videoY = point.y * videoHeight;
    const screenXBeforeMirror = offsetX + videoX * scale;
    const screenY = offsetY + videoY * scale;
    const screenX = rect.width - screenXBeforeMirror;

    return {
      x: clamp(screenX / rect.width, 0, 1),
      y: clamp(screenY / rect.height, 0, 1)
    };
  }

  function resize() {
    const rect = getShellRect();
    appWidth = Math.max(1, Math.round(rect.width));
    appHeight = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(appWidth * dpr);
    canvas.height = Math.floor(appHeight * dpr);
    canvas.style.width = `${appWidth}px`;
    canvas.style.height = `${appHeight}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function requestFullscreenSoft() {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().catch(() => {});
    screen.orientation?.lock?.("landscape").catch(() => {});
  }

  function parseMessage(data) {
    try { return JSON.parse(data); } catch { return null; }
  }

  function dist(a, b) {
    const dx = (a?.x || 0) - (b?.x || 0);
    const dy = (a?.y || 0) - (b?.y || 0);
    const dz = (a?.z || 0) - (b?.z || 0);
    return Math.hypot(dx, dy, dz);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, Number(value) || 0));
  }
})();
