/**
 * Sidebar layout for annotations - right-aligned panel.
 *
 * Used when prefs.annotationLayout === 'sidebar'. Lists annotations for the
 * currently selected file in a compact, scrollable column. Empty state
 * suggests selecting code and pressing 'c' (or clicking).
 */

import { AnnotationCard } from './AnnotationCard';
import type { Annotation } from '@shared/types';

interface Props {
  hostAlias: string;
  repoPath: string;
  filePath: string;
  annotations: Annotation[];
}

export function AnnotationSidebar({ annotations }: Props) {
  return (
    <aside className="annotation-sidebar">
      <header className="annotation-sidebar-header">
        <h3>Annotations</h3>
        <span className="ann-count-badge">{annotations.length}</span>
      </header>
      {annotations.length === 0 ? (
        <div className="empty-state-small">
          No annotations on this file.
          <p className="hint small">
            Click a line in the diff to add one.
          </p>
        </div>
      ) : (
        <div className="annotation-sidebar-list">
          {annotations
            .slice()
            .sort((a, b) => a.quotedStartLine - b.quotedStartLine)
            .map((a) => (
              <AnnotationCard key={a.id} annotation={a} compact />
            ))}
        </div>
      )}
    </aside>
  );
}
