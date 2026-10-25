import { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { metrics } from "@opentelemetry/api";
import { eventIndexerEmitter, IndexedEventRecord } from "./event-indexer";
import { appLogger } from "../middleware/logger";
import { AuthService } from "./auth.service";

interface StreamFilter {
  tradeId?: string;
  eventType?: string;
}

interface ClientMeta {
  filter: StreamFilter;
  userId: string;
  failedPongs: number;
}

// Connection limit configuration (see issue #1036)
const MAX_CONNECTIONS_PER_USER = 5;
const MAX_TOTAL_CONNECTIONS = 10_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_MISSED_PONGS = 3;
const WS_CLOSE_TRY_AGAIN_LATER = 1013;
const MAX_BUFFERED_AMOUNT_BYTES = 16 * 1024 * 1024; // 16MB backpressure threshold

export class EventStreamService {
  private static current: EventStreamService | null = null;

  private wss: WebSocketServer;
  private clients: Map<WebSocket, ClientMeta> = new Map();
  private userCounts: Map<string, number> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private connectionGauge: ReturnType<ReturnType<typeof metrics.getMeter>["createObservableGauge"]> | null = null;
  private connectionGaugeCallback: ((result: { observe: (value: number) => void }) => void) | null = null;

  constructor(server: HttpServer) {
    EventStreamService.current = this;
    this.wss = new WebSocketServer({ server, path: "/api/v1/ws/events" });

    this.registerMetrics();

    this.wss.on("connection", (ws: WebSocket, req) => {
      (async () => {
      const reject = (code: number, reason: string) => {
        try {
          ws.close(code, reason);
        } finally {
          ws.terminate();
        }
      };

      if (this.clients.size >= MAX_TOTAL_CONNECTIONS) {
        appLogger.warn("[EventStream] Global connection limit reached; rejecting connection");
        return reject(WS_CLOSE_TRY_AGAIN_LATER, "Server connection limit reached");
      }

      const url = new URL(req.url ?? "", "http://localhost");
      const filter: StreamFilter = {};
      const tradeId = url.searchParams.get("trade_id");
      const eventType = url.searchParams.get("type");
      if (tradeId) filter.tradeId = tradeId;
      if (eventType) filter.eventType = eventType;

      // Authenticate: require Authorization: Bearer <JWT>
      const authHeader = (req.headers.authorization as string) || (req.headers["authorization"] as any) || "";
      let userId = req.socket.remoteAddress ?? "anonymous";
      if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
        appLogger.warn("[EventStream] Missing Authorization header; rejecting websocket");
        return reject(1008, "Unauthorized: missing token");
      }

      const token = authHeader.split(" ")[1];
      try {
        const payload = await AuthService.validateToken(token);
        userId = payload.walletAddress.toLowerCase();
      } catch (err) {
        appLogger.warn({ err }, "[EventStream] Token validation failed; rejecting websocket");
        return reject(1008, "Unauthorized: invalid token");
      }

      const currentUserCount = this.userCounts.get(userId) ?? 0;
      if (currentUserCount >= MAX_CONNECTIONS_PER_USER) {
        appLogger.warn(
          { userId },
          "[EventStream] Per-user connection limit reached; rejecting connection",
        );
        return reject(WS_CLOSE_TRY_AGAIN_LATER, "Connection limit reached for user");
      }

      const meta: ClientMeta = { filter, userId, failedPongs: 0 };
      this.clients.set(ws, meta);
      this.userCounts.set(userId, currentUserCount + 1);

      ws.on("pong", () => {
        const m = this.clients.get(ws);
        if (m) m.failedPongs = 0;
      });

      ws.on("close", () => this.removeClient(ws));
      ws.on("error", () => this.removeClient(ws));

      ws.send(JSON.stringify({ type: "connected", message: "Event stream connected" }));
      })();
    });

    this.heartbeatInterval = setInterval(() => this.heartbeat(), HEARTBEAT_INTERVAL_MS);
    if (typeof this.heartbeatInterval.unref === "function") {
      this.heartbeatInterval.unref();
    }

    eventIndexerEmitter.on("event", (event: IndexedEventRecord) => {
      this.broadcast(event);
    });

    appLogger.info("[EventStream] WebSocket server initialized on /api/v1/ws/events");
  }

  private registerMetrics(): void {
    try {
      const meter = metrics.getMeter("amana-backend");
      this.connectionGauge = meter.createObservableGauge(
        "websocket_active_connections",
        {
          description: "Number of active WebSocket connections to the event stream",
          unit: "1",
        },
      );
      this.connectionGaugeCallback = (result) => {
        result.observe(this.clients.size);
      };
      this.connectionGauge.addCallback(this.connectionGaugeCallback);
    } catch (error) {
      appLogger.warn({ error }, "[EventStream] Failed to register connection metric");
    }
  }

  private heartbeat(): void {
    for (const [ws, meta] of this.clients.entries()) {
      if (ws.readyState !== WebSocket.OPEN) {
        this.removeClient(ws);
        continue;
      }

      meta.failedPongs += 1;
      if (meta.failedPongs > MAX_MISSED_PONGS) {
        appLogger.info(
          { userId: meta.userId },
          "[EventStream] Terminating stale connection after missed pongs",
        );
        this.removeClient(ws);
        try {
          ws.terminate();
        } catch {
          /* no-op */
        }
        continue;
      }

      try {
        ws.ping();
      } catch {
        this.removeClient(ws);
      }
    }
  }

  private removeClient(ws: WebSocket): void {
    const meta = this.clients.get(ws);
    if (!meta) return;
    this.clients.delete(ws);
    const remaining = (this.userCounts.get(meta.userId) ?? 1) - 1;
    if (remaining <= 0) {
      this.userCounts.delete(meta.userId);
    } else {
      this.userCounts.set(meta.userId, remaining);
    }
  }

  private broadcast(event: IndexedEventRecord): void {
    const message = JSON.stringify({ type: "event", data: event });

    for (const [ws, meta] of this.clients.entries()) {
      if (ws.readyState !== WebSocket.OPEN) {
        this.removeClient(ws);
        continue;
      }

      if (meta.filter.tradeId && event.tradeId !== meta.filter.tradeId) continue;
      if (meta.filter.eventType && event.eventType !== meta.filter.eventType) continue;

      if (ws.bufferedAmount > MAX_BUFFERED_AMOUNT_BYTES) {
        appLogger.warn(
          { userId: meta.userId, bufferedAmount: ws.bufferedAmount },
          "[EventStream] Dropping slow consumer due to backpressure",
        );
        this.removeClient(ws);
        try {
          ws.close(1008, "Server dropping slow consumer");
        } catch {
          /* no-op */
        }
        continue;
      }

      try {
        ws.send(message);
      } catch {
        this.removeClient(ws);
      }
    }
  }

  /**
   * Snapshot of connection state for the health check endpoint (issue #1036).
   */
  static getConnectionStats(): {
    total: number;
    perUserLimit: number;
    globalLimit: number;
    maxPerUser: number;
  } {
    const instance = EventStreamService.current;
    let maxPerUser = 0;
    if (instance) {
      for (const count of instance.userCounts.values()) {
        if (count > maxPerUser) maxPerUser = count;
      }
    }
    return {
      total: instance?.clients.size ?? 0,
      perUserLimit: MAX_CONNECTIONS_PER_USER,
      globalLimit: MAX_TOTAL_CONNECTIONS,
      maxPerUser,
    };
  }

  async stop(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.connectionGauge && this.connectionGaugeCallback) {
      this.connectionGauge.removeCallback(this.connectionGaugeCallback);
    }
    for (const ws of this.clients.keys()) {
      try {
        ws.close();
      } catch {
        /* no-op */
      }
    }
    this.clients.clear();
    this.userCounts.clear();
    await new Promise<void>((resolve, reject) => {
      this.wss.close((error) => (error ? reject(error) : resolve()));
    });
    if (EventStreamService.current === this) {
      EventStreamService.current = null;
    }
    appLogger.info("[EventStream] Stopped");
  }
}
