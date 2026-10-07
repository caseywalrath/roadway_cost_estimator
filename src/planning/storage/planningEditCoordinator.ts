type CoordinatorMessage =
  | { type: "probe"; workspaceId: string; senderId: string; requestId: string }
  | { type: "occupied"; workspaceId: string; senderId: string; requestId: string }
  | { type: "heartbeat"; workspaceId: string; senderId: string }
  | { type: "takeover"; workspaceId: string; senderId: string };

const CHANNEL_NAME = "roadway-cost-estimator:planning-edits";
const HEARTBEAT_INTERVAL_MS = 5000;
const STALE_AFTER_MS = 15000;

export class PlanningEditCoordinator {
  private readonly senderId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random()}`;
  private readonly channel: BroadcastChannel | null;
  private ownedWorkspaceId: string | null = null;
  private readonly pendingProbes = new Map<string, () => void>();
  private heartbeatTimer: number | null = null;
  private staleTimer: number | null = null;
  private watchedWorkspaceId: string | null = null;
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

  owns(workspaceId: string): boolean {
    return this.ownedWorkspaceId === workspaceId;
  }

  async claim(workspaceId: string): Promise<boolean> {
    this.release();
    if (!this.channel) {
      this.beginOwnership(workspaceId);
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
    this.channel.postMessage({ type: "probe", workspaceId, senderId: this.senderId, requestId } satisfies CoordinatorMessage);
    await occupiedPromise;
    this.pendingProbes.delete(requestId);
    if (!occupied) {
      this.beginOwnership(workspaceId);
    } else {
      this.watchOwner(workspaceId);
    }
    return !occupied;
  }

  takeOver(workspaceId: string): void {
    this.channel?.postMessage({ type: "takeover", workspaceId, senderId: this.senderId } satisfies CoordinatorMessage);
    this.beginOwnership(workspaceId);
  }

  release(): void {
    this.ownedWorkspaceId = null;
    if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.stopWatchingOwner();
  }

  close(): void {
    this.release();
    this.channel?.close();
  }

  private beginOwnership(workspaceId: string): void {
    this.stopWatchingOwner();
    this.ownedWorkspaceId = workspaceId;
    if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
    this.sendHeartbeat();
    this.heartbeatTimer = window.setInterval(() => this.sendHeartbeat(), HEARTBEAT_INTERVAL_MS);
  }

  private sendHeartbeat(): void {
    if (!this.ownedWorkspaceId) return;
    this.channel?.postMessage({
      type: "heartbeat",
      workspaceId: this.ownedWorkspaceId,
      senderId: this.senderId
    } satisfies CoordinatorMessage);
  }

  private receive(message: CoordinatorMessage): void {
    if (!message || message.senderId === this.senderId) return;
    if (message.type === "probe" && this.ownedWorkspaceId === message.workspaceId) {
      this.channel?.postMessage({
        type: "occupied",
        workspaceId: message.workspaceId,
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
    if (message.type === "heartbeat" && this.watchedWorkspaceId === message.workspaceId) {
      this.lastOwnerHeartbeatAt = Date.now();
      return;
    }
    if (message.type === "takeover" && this.ownedWorkspaceId === message.workspaceId) {
      this.release();
      this.lostOwnershipHandler?.();
    }
  }

  private watchOwner(workspaceId: string): void {
    this.watchedWorkspaceId = workspaceId;
    this.lastOwnerHeartbeatAt = Date.now();
    if (this.staleTimer !== null) window.clearInterval(this.staleTimer);
    this.staleTimer = window.setInterval(() => {
      if (this.watchedWorkspaceId && Date.now() - this.lastOwnerHeartbeatAt >= STALE_AFTER_MS) {
        this.stopWatchingOwner();
        this.ownershipAvailableHandler?.();
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopWatchingOwner(): void {
    this.watchedWorkspaceId = null;
    if (this.staleTimer !== null) window.clearInterval(this.staleTimer);
    this.staleTimer = null;
  }
}

export const PLANNING_EDIT_STALE_AFTER_MS = STALE_AFTER_MS;
