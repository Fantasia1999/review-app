/**
 * POSIX shell escaping. Wraps a string in single quotes and escapes any
 * embedded single quotes. Safe for use as a command argument on any
 * POSIX shell (bash, zsh, dash, sh) on the remote.
 *
 * We use this for any user-controlled input that gets concatenated into
 * a remote command string - chiefly repo paths and file paths.
 *
 * Note: this only protects the remote shell. We don't run anything through
 * a local shell - ssh2.exec() sends the command string straight to the
 * remote, so we only need POSIX rules.
 */
export function shellEscape(s: string): string {
  if (s.length === 0) return "''";
  // If the string only contains safe chars, no escape needed.
  if (/^[a-zA-Z0-9_\-./:=@%+,]+$/.test(s)) return s;
  // Otherwise wrap in single quotes; embedded quotes become '\''
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
