import { CONFIG } from '../config';

export class WsListener {
  private prices = new Map<string, { price: number; updatedAt: number }>();
  private ws: WebSocket | null = null;
  private reconnectDelay = 1000;
  private subscriptions = new Set<string>();

  connect() {
    this.ws = new WebSocket(CONFIG.wssHost);
    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
      for (const tokenId of this.subscriptions) this.sendSubscribe(tokenId);
    };
    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(String(event.data));
        if (data.asset_id && data.price) {
          this.prices.set(data.asset_id, { price: parseFloat(data.price), updatedAt: Date.now() });
        }
      } catch {}
    };
    this.ws.onclose = () => this.scheduleReconnect();
    this.ws.onerror = () => this.ws?.close();
  }

  subscribe(tokenId: string) {
    this.subscriptions.add(tokenId);
    if (this.ws?.readyState === WebSocket.OPEN) this.sendSubscribe(tokenId);
  }

  private sendSubscribe(tokenId: string) {
    this.ws?.send(JSON.stringify({ type: 'subscribe', channel: 'market', assets_id: tokenId }));
  }

  getLatestPrice(tokenId: string): number {
    return this.prices.get(tokenId)?.price ?? 0;
  }

  isConnected(): boolean { return this.ws?.readyState === WebSocket.OPEN; }

  private scheduleReconnect() {
    setTimeout(() => this.connect(), this.reconnectDelay);
    this.reconnectDelay = Math.min(30_000, this.reconnectDelay * 2);
  }

  close() { this.ws?.close(); }
}
