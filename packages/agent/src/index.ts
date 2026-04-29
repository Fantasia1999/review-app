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
import { resolve as resolvePath, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { stat } from 'node:fs/promises';

import { ExecutorPool } from './remote/pool';
import { hostsRoutes } from './routes/hosts';
import { reposRoutes } from './routes/repos';
import { diffRoutes } from './routes/diff';
import { annotationsRoutes } from './routes/annotations';
import { readMarksRoutes } from './routes/read-marks';
import { prefsRoutes } from './routes/prefs';
import { mountStatic } from './static';
import {
  ensureConfigDir,
  ensureLocalHost,
  loadConfig,
  updateConfig,
} from './config/store';

const HOST = '127.0.0.1'; // SECURITY: never 0.0.0.0
const DEFAULT_PORT = 7676;
const MAX_PORT_TRIES = 5;

async function main() {
  await ensureConfigDir();
  await loadConfig(); // surface any config errors at startup

  // First-run UX: if no hosts are configured, seed an implicit local host
  // so the user doesn't have to fill out a host form to look at a local repo.
  await ensureLocalHost();

  // Optional CLI arg: a path to a repo to open directly.
  // `review-app .` or `review-app C:\some\repo` skips the host/repo pickers
  // and opens the review screen straight away.
  const directRepo = await resolveDirectRepoArg();

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

  // If a repo was passed on the CLI, deep-link straight to its review page.
  // Otherwise just open the landing page.
  let openUrl = url;
  if (directRepo) {
    // Push to recents so it shows up at the top of the landing page too.
    await updateConfig((cfg) => {
      const list = cfg.recentRepos[directRepo.alias] ?? [];
      const filtered = list.filter((e) => e.path !== directRepo.path);
      filtered.unshift({ path: directRepo.path, lastOpenedAt: Date.now() });
      cfg.recentRepos[directRepo.alias] = filtered.slice(0, 20);
    });
    openUrl = `${url}/#/h/${encodeURIComponent(directRepo.alias)}/r/${urlSafeBase64(directRepo.path)}`;
    console.log(`  opening repo: ${directRepo.path}\n`);
  }

  // Open browser unless --no-open is passed
  if (!process.argv.includes('--no-open')) {
    openBrowser(openUrl);
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

/**
 * Look at process.argv for a path to open directly (`review-app .`).
 * Returns null if nothing usable was passed.
 *
 * Accepts:
 *   - `.` and relative paths (resolved against cwd)
 *   - `~`/`~/...` (expanded against $HOME)
 *   - absolute paths
 *
 * The path must exist on disk; we leave git-validation to the normal
 * /api/repos/:alias/validate flow once the browser opens.
 */
async function resolveDirectRepoArg(): Promise<{ alias: string; path: string } | null> {
  // argv[0]=bun, argv[1]=script (or compiled binary). Skip flags.
  const candidates = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  if (candidates.length === 0) return null;
  const raw = candidates[0];
  let expanded = raw;
  if (raw === '~' || raw.startsWith('~/') || raw.startsWith('~\\')) {
    expanded = homedir() + raw.slice(1);
  }
  const abs = isAbsolute(expanded) ? expanded : resolvePath(process.cwd(), expanded);
  try {
    const s = await stat(abs);
    if (!s.isDirectory()) {
      console.warn(`  warning: ${abs} is not a directory; ignoring`);
      return null;
    }
  } catch {
    console.warn(`  warning: ${abs} does not exist; ignoring`);
    return null;
  }
  // Pick a local-kind host to attach to. ensureLocalHost guarantees one
  // exists; we prefer the implicit alias but fall back to any local host.
  const cfg = await loadConfig();
  const local = cfg.hosts.find((h) => h.kind === 'local');
  if (!local) return null;
  return { alias: local.alias, path: abs };
}

/** URL-safe base64 matching client/src/routes.tsx encodeBase64. */
function urlSafeBase64(s: string): string {
  return Buffer.from(s, 'utf8')
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
