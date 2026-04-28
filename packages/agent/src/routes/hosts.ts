/**
 * Host management routes.
 *
 * GET  /api/hosts                  - list all configured hosts
 * POST /api/hosts                  - add a new host
 * PUT  /api/hosts/:alias           - edit existing host
 * DELETE /api/hosts/:alias         - remove host (also disconnects)
 * GET  /api/hosts/keys             - scan ~/.ssh/ for available private keys
 * POST /api/hosts/:alias/passphrase - submit passphrase for an encrypted key
 * POST /api/hosts/:alias/password   - submit password for a password-auth SSH host
 * POST /api/hosts/:alias/test      - test connection (lightweight `echo ok`)
 */

import { Hono } from 'hono';
import { loadConfig, updateConfig } from '../config/store';
import { detectEncrypted, scanLocalKeys } from '../config/keys';
import type { ExecutorPool } from '../remote/pool';
import { RemoteExecError } from '../remote/executor';
import { listWslDistros } from '../remote/wsl-executor';
import type {
  CreateHostInput,
  HostConfig,
  SshHostConfig,
} from '@review-app/shared';

export function hostsRoutes(pool: ExecutorPool) {
  const r = new Hono();

  r.get('/', async (c) => {
    const cfg = await loadConfig();
    return c.json({
      hosts: cfg.hosts,
      // Tell client which hosts already have an in-memory password/passphrase.
      credentialLoaded: cfg.hosts
        .filter((h) => hostNeedsCredential(h) && pool.hasCredential(h.alias))
        .map((h) => h.alias),
      passphraseLoaded: cfg.hosts
        .filter((h) => h.kind === 'ssh' && h.auth === 'key' && h.hasPassphrase && pool.hasPassphrase(h.alias))
        .map((h) => h.alias),
    });
  });

  r.get('/keys', async (c) => {
    const keys = await scanLocalKeys();
    return c.json({ keys });
  });

  r.get('/wsl-distros', async (c) => {
    const distros = await listWslDistros();
    return c.json({ distros, available: process.platform === 'win32' });
  });

  r.post('/', async (c) => {
    const body = (await c.req.json()) as CreateHostInput;
    const parsed = await parseCreateHost(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const newHost = parsed.host;
    const existing = await loadConfig();
    if (existing.hosts.find((h) => h.alias === newHost.alias)) {
      return c.json(
        { error: `Host alias "${newHost.alias}" already exists` },
        409,
      );
    }
    const updated = await updateConfig((cfg) => {
      cfg.hosts.push(newHost);
    });
    if (parsed.password) pool.setPassword(newHost.alias, parsed.password);
    return c.json({ host: newHost, hosts: updated.hosts });
  });

  r.put('/:alias', async (c) => {
    const alias = c.req.param('alias');
    const body = (await c.req.json()) as Partial<CreateHostInput> & { password?: string };
    const cfgPre = await loadConfig();
    const existingPre = cfgPre.hosts.find((h) => h.alias === alias);
    if (!existingPre) {
      return c.json({ error: 'host not found' }, 404);
    }
    const parsed = await parseUpdateHost(existingPre, body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    let resolved: HostConfig | null = null;
    await updateConfig(async (cfg) => {
      const idx = cfg.hosts.findIndex((h) => h.alias === alias);
      if (idx === -1) return;
      cfg.hosts[idx] = parsed.host;
      resolved = parsed.host;
    });
    // Drop any active connection so the new config takes effect on next use
    await pool.disconnect(alias);
    pool.clearCredential(alias);
    if (parsed.password) pool.setPassword(alias, parsed.password);
    return c.json({ host: resolved });
  });

  r.delete('/:alias', async (c) => {
    const alias = c.req.param('alias');
    await pool.disconnect(alias);
    pool.clearCredential(alias);
    await updateConfig((cfg) => {
      cfg.hosts = cfg.hosts.filter((h) => h.alias !== alias);
      delete cfg.recentRepos[alias];
      cfg.readMarks = cfg.readMarks.filter((m) => m.hostAlias !== alias);
    });
    return c.json({ ok: true });
  });

  r.post('/:alias/passphrase', async (c) => {
    const alias = c.req.param('alias');
    const { passphrase } = (await c.req.json()) as { passphrase: string };
    if (!passphrase) return c.json({ error: 'passphrase required' }, 400);
    pool.setPassphrase(alias, passphrase);
    // Also drop any old connection so the new passphrase is used
    await pool.disconnect(alias);
    return c.json({ ok: true });
  });

  r.post('/:alias/password', async (c) => {
    const alias = c.req.param('alias');
    const { password } = (await c.req.json()) as { password: string };
    if (!password) return c.json({ error: 'password required' }, 400);
    pool.setPassword(alias, password);
    await pool.disconnect(alias);
    return c.json({ ok: true });
  });

  r.post('/:alias/test', async (c) => {
    const alias = c.req.param('alias');
    const cfg = await loadConfig();
    const host = cfg.hosts.find((h) => h.alias === alias);
    if (!host) return c.json({ error: 'host not found' }, 404);
    try {
      const exec = pool.get(host);
      const r = await exec.exec('git --version', { timeoutMs: 10_000 });
      return c.json({
        ok: true,
        gitVersion: r.stdout.trim(),
      });
    } catch (err) {
      if (err instanceof RemoteExecError) {
        return c.json({ ok: false, error: err.info }, 200);
      }
      return c.json(
        { ok: false, error: { kind: 'unknown', message: String(err) } },
        200,
      );
    }
  });

  return r;
}

function hostNeedsCredential(host: HostConfig): boolean {
  return host.kind === 'ssh' && (host.auth === 'password' || host.hasPassphrase);
}

async function parseCreateHost(
  body: CreateHostInput,
): Promise<
  | { ok: true; host: HostConfig; password?: string }
  | { ok: false; error: string }
> {
  if (!body?.alias) return { ok: false, error: 'alias is required' };
  if (body.kind === 'local') {
    return { ok: true, host: { alias: body.alias, kind: 'local' } };
  }
  if (body.kind === 'wsl') {
    if (!body.distro) return { ok: false, error: 'distro is required' };
    return {
      ok: true,
      host: { alias: body.alias, kind: 'wsl', distro: body.distro },
    };
  }
  if (body.kind !== 'ssh' || !body.hostname || !body.user) {
    return { ok: false, error: 'alias, hostname and user are required' };
  }
  if (body.auth === 'password') {
    return {
      ok: true,
      host: {
        alias: body.alias,
        kind: 'ssh',
        auth: 'password',
        hostname: body.hostname,
        user: body.user,
        port: body.port ?? 22,
      },
      password: body.password,
    };
  }
  if (!body.keyPath) {
    return { ok: false, error: 'keyPath is required for key auth' };
  }
  const encrypted = await detectEncrypted(body.keyPath);
  return {
    ok: true,
    host: {
      alias: body.alias,
      kind: 'ssh',
      auth: 'key',
      hostname: body.hostname,
      user: body.user,
      port: body.port ?? 22,
      keyPath: body.keyPath,
      hasPassphrase: encrypted,
    },
  };
}

async function parseUpdateHost(
  existing: HostConfig,
  body: Partial<CreateHostInput> & { password?: string },
): Promise<
  | { ok: true; host: HostConfig; password?: string }
  | { ok: false; error: string }
> {
  const kind = body.kind ?? existing.kind;
  const sshBody = body as Partial<Extract<CreateHostInput, { kind: 'ssh' }>> & {
    password?: string;
  };
  if (kind === 'local') {
    return { ok: true, host: { alias: existing.alias, kind: 'local' } };
  }
  if (kind === 'wsl') {
    const wslBody = body as Partial<Extract<CreateHostInput, { kind: 'wsl' }>>;
    const distro =
      wslBody.distro ?? (existing.kind === 'wsl' ? existing.distro : undefined);
    if (!distro) return { ok: false, error: 'distro is required' };
    return {
      ok: true,
      host: { alias: existing.alias, kind: 'wsl', distro },
    };
  }

  const sshExisting = existing.kind === 'ssh' ? existing : null;
  const auth = sshBody.auth ?? sshExisting?.auth ?? 'key';
  const hostname = sshBody.hostname ?? sshExisting?.hostname;
  const user = sshBody.user ?? sshExisting?.user;
  const port = sshBody.port ?? sshExisting?.port ?? 22;
  const keyPathInput = 'keyPath' in sshBody ? sshBody.keyPath : undefined;
  if (!hostname || !user) {
    return { ok: false, error: 'hostname and user are required for SSH hosts' };
  }

  if (auth === 'password') {
    return {
      ok: true,
      host: {
        alias: existing.alias,
        kind: 'ssh',
        auth: 'password',
        hostname,
        user,
        port,
      },
      password: sshBody.password,
    };
  }

  const keyPath = keyPathInput ?? (sshExisting?.auth === 'key' ? sshExisting.keyPath : undefined);
  if (!keyPath) return { ok: false, error: 'keyPath is required for key auth' };
  const hasPassphrase =
    keyPathInput && (!sshExisting || sshExisting.auth !== 'key' || sshExisting.keyPath !== keyPathInput)
      ? await detectEncrypted(keyPathInput)
      : sshExisting?.auth === 'key'
        ? sshExisting.hasPassphrase
        : await detectEncrypted(keyPath);

  return {
    ok: true,
    host: {
      alias: existing.alias,
      kind: 'ssh',
      auth: 'key',
      hostname,
      user,
      port,
      keyPath,
      hasPassphrase,
    } satisfies SshHostConfig,
  };
}
