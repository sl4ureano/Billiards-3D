const express = require("express");
const http = require("http");
const os = require("os");
const path = require("path");
const QRCode = require("qrcode");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3100;
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const sessions = new Map();

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/table", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/controller", (req, res) => res.sendFile(path.join(__dirname, "public", "controller.html")));
app.get("/spectator", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/viewer", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/play", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/editor", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.get("/new-session", async (req, res) => {
  let code = makeCode();
  while (sessions.has(code)) code = makeCode();

  const session = createSession(code);
  const details = await sessionDetails(req, session);

  console.log("");
  console.log("=======================================");
  console.log(`BILLIARDS 3D ROOM: ${code}`);
  console.log(`TABLE      ${details.tableUrl}`);
  console.log(`CONTROL    ${details.controllerUrl}`);
  console.log(`SPECTATOR  ${details.spectatorUrl}`);
  console.log("=======================================");
  console.log("");

  res.json(details);
});

app.get("/session/:code", async (req, res) => {
  const session = sessions.get(String(req.params.code || "").toUpperCase());
  if (!session) return res.status(404).json({ error: "Sala nao encontrada" });
  res.json(await sessionDetails(req, session));
});


app.get("/qr-link", async (req, res) => {
  const target = String(req.query.url || "");
  if (!target || !/^https?:\/\//.test(target)) return res.status(400).send("URL invalida");
  try {
    const png = await QRCode.toBuffer(target, { type: "png", width: 220, margin: 1 });
    res.type("png").send(png);
  } catch {
    res.status(500).send("Erro ao gerar QR");
  }
});

app.get("/qr/:code", async (req, res) => {
  const session = sessions.get(String(req.params.code || "").toUpperCase());
  if (!session) return res.status(404).send("Sala nao encontrada");

  const details = await sessionDetails(req, session);
  const png = await QRCode.toBuffer(details.controllerUrl, { type: "png", width: 280, margin: 1 });
  res.type("png").send(png);
});

wss.on("connection", (ws) => {
  ws.role = null;
  ws.code = null;
  ws.playerId = null;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === "join-host") {
      const session = ensureSession(msg.code);
      if (session.host && session.host !== ws && session.host.readyState === WebSocket.OPEN) {
        return send(ws, {
          type: "host-occupied",
          code: session.code,
          controllerUrl: `/controller?code=${session.code}`
        });
      }

      ws.role = "host";
      ws.code = session.code;
      session.host = ws;
      send(ws, {
        type: "host-ready",
        code: session.code,
        players: sessionPlayers(session),
        snapshot: session.snapshot
      });
      broadcastControllers(session, { type: "players", players: sessionPlayers(session) });
      return;
    }

    if (msg.type === "join-controller") {
      const session = sessions.get(String(msg.code || "").toUpperCase());
      if (!session) return send(ws, { type: "error", message: "Sala nao encontrada" });
      if (session.controllers.size >= 2) return send(ws, { type: "error", message: "Mesa cheia" });

      let playerId = 1;
      while (session.controllers.has(playerId)) playerId += 1;
      if (playerId > 2) return send(ws, { type: "error", message: "Mesa cheia" });
      session.nextPlayerId = Math.max(session.nextPlayerId, playerId + 1);
      ws.role = "controller";
      ws.code = session.code;
      ws.playerId = playerId;
      session.controllers.set(playerId, ws);

      send(ws, { type: "controller-ready", code: session.code, playerId, players: sessionPlayers(session) });
      send(session.host, { type: "player-joined", playerId, players: sessionPlayers(session) });
      broadcastControllers(session, { type: "players", players: sessionPlayers(session) });
      return;
    }



    if (msg.type === "join-viewer" || msg.type === "join-spectator") {
      const session = sessions.get(String(msg.code || "").toUpperCase());
      if (!session) return send(ws, { type: "error", message: "Sala nao encontrada" });

      ws.role = "viewer";
      ws.code = session.code;
      session.viewers.add(ws);

      send(ws, {
        type: "viewer-ready",
        code: session.code,
        players: sessionPlayers(session),
        snapshot: session.snapshot
      });
      return;
    }

    if (ws.role === "controller" && msg.type === "input") {
      const session = sessions.get(ws.code);
      send(session?.host, {
        type: "input",
        playerId: ws.playerId,
        action: msg.action,
        value: msg.value
      });
      return;
    }

    if (ws.role === "host" && msg.type === "state") {
      const session = sessions.get(ws.code);
      if (!session) return;
      session.snapshot = msg.snapshot;
      broadcastControllers(session, { type: "state", snapshot: msg.snapshot });
      broadcastViewers(session, { type: "state", snapshot: msg.snapshot });
    }
  });

  ws.on("close", () => {
    const session = sessions.get(ws.code);
    if (!session) return;

    if (ws.role === "host" && session.host === ws) {
      session.host = null;
      broadcastControllers(session, { type: "host-left" });
    }

    if (ws.role === "viewer") {
      session.viewers.delete(ws);
    }

    if (ws.role === "controller") {
      session.controllers.delete(ws.playerId);
      send(session.host, { type: "player-left", playerId: ws.playerId, players: sessionPlayers(session) });
      broadcastControllers(session, { type: "players", players: sessionPlayers(session) });
    }

    if (!session.host && session.controllers.size === 0 && session.viewers.size === 0) sessions.delete(session.code);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Billiards 3D running on http://localhost:${PORT}`);
  console.log(`LAN URL: http://${getLocalIp()}:${PORT}`);
});

function ensureSession(rawCode) {
  const requested = String(rawCode || "").toUpperCase();
  if (requested && sessions.has(requested)) return sessions.get(requested);

  let code = requested || makeCode();
  while (sessions.has(code)) code = makeCode();

  return createSession(code);
}

function createSession(code) {
  const session = {
    code,
    host: null,
    controllers: new Map(),
    viewers: new Set(),
    nextPlayerId: 1,
    snapshot: null
  };
  sessions.set(code, session);
  return session;
}

async function sessionDetails(req, session) {
  const origin = getPublicOrigin(req);
  const tableUrl = `${origin}/table?code=${session.code}`;
  const controllerUrl = `${origin}/controller?code=${session.code}`;
  const playUrl = `${origin}/play?code=${session.code}`;
  const spectatorUrl = `${origin}/spectator?code=${session.code}`;
  const qr = await QRCode.toDataURL(controllerUrl, { width: 280, margin: 1 });
  return { code: session.code, tableUrl, controllerUrl, playUrl, spectatorUrl, qr };
}

function makeCode() {
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}

function send(ws, payload) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function broadcastControllers(session, payload) {
  for (const controller of session.controllers.values()) send(controller, payload);
}

function broadcastViewers(session, payload) {
  for (const viewer of session.viewers || []) {
    if (viewer.bufferedAmount > 64 * 1024) continue;
    send(viewer, payload);
  }
}

function sessionPlayers(session) {
  return [...session.controllers.keys()].sort((a, b) => a - b);
}

function getLocalIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "localhost";
}

function firstHeaderValue(value) {
  return String(Array.isArray(value) ? value[0] : value || "").split(",")[0].trim();
}

function hostName(host) {
  const value = String(host || "").trim().toLowerCase();
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    return end >= 0 ? value.slice(1, end) : value;
  }
  return value.split(":")[0];
}

function hostPort(host) {
  const value = String(host || "").trim();
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    return end >= 0 && value[end + 1] === ":" ? value.slice(end + 2) : "";
  }
  const parts = value.split(":");
  return parts.length > 1 ? parts.pop() : "";
}

function isLoopback(host) {
  const name = hostName(host);
  return name === "localhost" || name === "127.0.0.1" || name === "0.0.0.0" || name === "::1";
}

function getPublicOrigin(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, "");

  const protocol = firstHeaderValue(req.headers["x-forwarded-proto"]) || req.protocol || "http";
  const host = firstHeaderValue(req.headers["x-forwarded-host"]) || firstHeaderValue(req.headers.host) || `localhost:${PORT}`;
  if (!isLoopback(host)) return `${protocol}://${host}`;

  const port = hostPort(host) || PORT;
  return `${protocol}://${getLocalIp()}:${port}`;
}
