export class HealthServer {
  private server: ReturnType<typeof Bun.serve>;
  private startedAt = Date.now();
  public lastTradeAt = 0;
  public openPositions = 0;
  public wsConnected = false;

  constructor(port: number) {
    this.server = Bun.serve({
      port,
      fetch: (req) => this.handleRequest(req),
    });
  }

  private handleRequest(req: Request): Response {
    const url = new URL(req.url);
    if (url.pathname === '/health') {
      return Response.json({
        status: 'ok',
        uptime: Math.floor((Date.now() - this.startedAt) / 1000),
        lastTrade: this.lastTradeAt,
        openPositions: this.openPositions,
        wsConnected: this.wsConnected,
      });
    }
    return new Response('Not Found', { status: 404 });
  }

  getPort(): number { return this.server.port; }
  stop() { this.server.stop(); }
}
