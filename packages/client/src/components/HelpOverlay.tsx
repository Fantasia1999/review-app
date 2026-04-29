/**
 * Help overlay listing keyboard shortcuts.
 *
 * Triggered by `?` from anywhere on the review page. Esc or click-outside
 * to dismiss.
 */

import { useEffect } from 'react';

const SHORTCUTS: Array<{ keys: string; desc: string }> = [
  { keys: 'r', desc: 'Refresh diff' },
  { keys: 'j / k', desc: 'Next / previous file' },
  { keys: 'c', desc: 'Annotate the first lines of the current file' },
  { keys: 'y', desc: 'Copy all annotations as markdown' },
  { keys: '?', desc: 'Toggle this help' },
  { keys: 'Esc', desc: 'Close annotation editor / help' },
];

export function HelpOverlay({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal help-overlay" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2>Keyboard shortcuts</h2>
          <button className="btn-close" onClick={onClose}>×</button>
        </header>
        <table className="help-table">
          <tbody>
            {SHORTCUTS.map((s) => (
              <tr key={s.keys}>
                <td><kbd>{s.keys}</kbd></td>
                <td>{s.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
