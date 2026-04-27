/**
 * Agent entry point.
 *
 * Starts Hono on 127.0.0.1:7676 (auto-incrementing if busy, up to 5 times).
 * Opens the system browser to that URL on startup.
 *
 * Always binds to 127.0.0.1 - never 0.0.0.0 - so the agent is not reachable
 * from the network. Don't change this.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { spawn } from 'node:child_process';

import { ExecutorPool } from './remote/pool';
import { hostsRoutes } from './routes/hosts';
import { reposRoutes } from './routes/repos';
import { diffRoutes } from './routes/diff';
import { annotationsRoutes } from './routes/annotations';
import { readMarksRoutes } from './routes/read-marks';
import { prefsRoutes } from './routes/prefs';
import { mountStatic } from './static';
import { ensureConfigDir, loadConfig } from './config/store';

const HOST = '127.0.0.1'; // SECURITY: never 0.0.0.0
const DEFAULT_PORT = 7676;
const MAX_PORT_TRIES = 5;

async function main() {
  await ensureConfigDir();
  await loadConfig(); // surface any config errors at startup

  const pool = new ExecutorPool();
  const app = new Hono();

  // CORS only matters when using the dev client on a different port
  app.use('/api/*', cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] }));
  if (process.env.NODE_ENV !== 'production') app.use('*', logger());

  app.get('/api/health', (c) => c.json({ ok: true }));
  app.route('/api/hosts', hostsRoutes(pool));
  app.route('/api/repos', reposRoutes(pool));
  app.route('/api/diff', diffRoutes(pool));
  app.route('/api/annotations', annotationsRoutes());
  app.route('/api/read-marks', readMarksRoutes());
  app.route('/api/prefs', prefsRoutes());

  await mountStatic(app);

  // Try ports DEFAULT_PORT..DEFAULT_PORT+MAX_PORT_TRIES-1
  let port = DEFAULT_PORT;
  let server: ReturnType<typeof Bun.serve> | null = null;
  for (let i = 0; i < MAX_PORT_TRIES; i++) {
    try {
      server = Bun.serve({
        hostname: HOST,
        port,
        fetch: app.fetch,
      });
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EADDRINUSE') {
        port++;
        continue;
      }
      throw err;
    }
  }

  if (!server) {
    console.error(`Could not bind to any port from ${DEFAULT_PORT} to ${DEFAULT_PORT + MAX_PORT_TRIES - 1}`);
    process.exit(1);
  }

  const url = `http://${HOST}:${port}`;
  console.log(`\n  review-app  ${url}\n`);
  console.log('  press Ctrl+C to stop\n');

  // Open browser unless --no-open is passed
  if (!process.argv.includes('--no-open')) {
    openBrowser(url);
  }

  // Graceful shutdown
  const shutdown = async (sig: string) => {
    console.log(`\nReceived ${sig}, shutting down...`);
    await pool.closeAll();
    server!.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

function openBrowser(url: string): void {
  const platform = process.platform;
  let cmd: string;
  let args: string[];
  if (platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else if (platform === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '""', url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // No big deal - just print the URL
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
