type CoordinatorMessage =
  | { type: "probe"; projectId: string; senderId: string; requestId: string }
  | { type: "occupied"; projectId: string; senderId: string; requestId: string }
  | { type: "heartbeat"; projectId: string; senderId: string }
  | { type: "takeover"; projectId: string; senderId: string };

const CHANNEL_NAME = "roadway-cost-estimator:project-edits";
const HEARTBEAT_INTERVAL_MS = 5000;
const STALE_AFTER_MS = 15000;

export class ProjectEditCoordinator {
  private readonly senderId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random()}`;
  private readonly channel: BroadcastChannel | null;
  private ownedProjectId: string | null = null;
  private readonly pendingProbes = new Map<string, () => void>();
  private heartbeatTimer: number | null = null;
  private staleTimer: number | null = null;
  private watchedProjectId: string | null = null;
  private lastOwnerHeartbeatAt = 0;
  private lostOwnershipHandler: (() => void) | null = null;
  private ownershipAvailableHandler: (() => void) | null = null;

  constructor() {
    this.channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL_NAME);
    if (this.channel) this.channel.onmessage = (event: MessageEvent<CoordinatorMessage>) => this.receive(event.data);
  }

  setLostOwnershipHandler(handler: () => void): void {
    this.lostOwnershipHandler = handler;
  }

  setOwnershipAvailableHandler(handler: () => void): void {
    this.ownershipAvailableHandler = handler;
  }

  async claim(projectId: string): Promise<boolean> {
    this.release();
    if (!this.channel) {
      this.beginOwnership(projectId);
      return true;
    }
    const requestId = `${this.senderId}_${Date.now()}`;
    let occupied = false;
    const occupiedPromise = new Promise<void>((resolve) => {
      this.pendingProbes.set(requestId, () => {
        occupied = true;
        resolve();
      });
      window.setTimeout(resolve, 175);
    });
    this.channel.postMessage({ type: "probe", projectId, senderId: this.senderId, requestId } satisfies CoordinatorMessage);
    await occupiedPromise;
    this.pendingProbes.delete(requestId);
    if (!occupied) {
      this.beginOwnership(projectId);
    } else {
      this.watchOwner(projectId);
    }
    return !occupied;
  }

  takeOver(projectId: string): void {
    this.channel?.postMessage({ type: "takeover", projectId, senderId: this.senderId } satisfies CoordinatorMessage);
    this.beginOwnership(projectId);
  }

  release(): void {
    this.ownedProjectId = null;
    if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.stopWatchingOwner();
  }

  close(): void {
    this.release();
    this.channel?.close();
  }

  private beginOwnership(projectId: string): void {
    this.stopWatchingOwner();
    this.ownedProjectId = projectId;
    if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
    this.sendHeartbeat();
    this.heartbeatTimer = window.setInterval(() => this.sendHeartbeat(), HEARTBEAT_INTERVAL_MS);
  }

  private sendHeartbeat(): void {
    if (!this.ownedProjectId) return;
    this.channel?.postMessage({
      type: "heartbeat",
      projectId: this.ownedProjectId,
      senderId: this.senderId
    } satisfies CoordinatorMessage);
  }

  private receive(message: CoordinatorMessage): void {
    if (!message || message.senderId === this.senderId) return;
    if (message.type === "probe" && this.ownedProjectId === message.projectId) {
      this.channel?.postMessage({
        type: "occupied",
        projectId: message.projectId,
        senderId: this.senderId,
        requestId: message.requestId
      } satisfies CoordinatorMessage);
      return;
    }
    if (message.type === "occupied") {
      this.lastOwnerHeartbeatAt = Date.now();
      this.pendingProbes.get(message.requestId)?.();
      return;
    }
    if (message.type === "heartbeat" && this.watchedProjectId === message.projectId) {
      this.lastOwnerHeartbeatAt = Date.now();
      return;
    }
    if (message.type === "takeover" && this.ownedProjectId === message.projectId) {
      this.release();
      this.lostOwnershipHandler?.();
    }
  }

  private watchOwner(projectId: string): void {
    this.watchedProjectId = projectId;
    this.lastOwnerHeartbeatAt = Date.now();
    if (this.staleTimer !== null) window.clearInterval(this.staleTimer);
    this.staleTimer = window.setInterval(() => {
      if (this.watchedProjectId && Date.now() - this.lastOwnerHeartbeatAt >= STALE_AFTER_MS) {
        this.stopWatchingOwner();
        this.ownershipAvailableHandler?.();
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopWatchingOwner(): void {
    this.watchedProjectId = null;
    if (this.staleTimer !== null) window.clearInterval(this.staleTimer);
    this.staleTimer = null;
  }
}

export const PROJECT_EDIT_STALE_AFTER_MS = STALE_AFTER_MS;
