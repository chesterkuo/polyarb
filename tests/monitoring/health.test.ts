import { describe, it, expect, afterEach } from 'bun:test';
import { HealthServer } from '../../src/monitoring/health';

describe('HealthServer', () => {
  let server: HealthServer;

  afterEach(() => { server?.stop(); });

  it('responds to /health with status ok', async () => {
    server = new HealthServer(0);
    const port = server.getPort();
    const res = await fetch(`http://localhost:${port}/health`);
    const data = await res.json() as any;
    expect(res.status).toBe(200);
    expect(data.status).toBe('ok');
    expect(data.uptime).toBeGreaterThanOrEqual(0);
  });

  it('returns 404 for unknown routes', async () => {
    server = new HealthServer(0);
    const port = server.getPort();
    const res = await fetch(`http://localhost:${port}/unknown`);
    expect(res.status).toBe(404);
  });
});
