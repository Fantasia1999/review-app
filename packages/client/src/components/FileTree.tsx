/**
 * File tree sidebar.
 *
 * Two modes (auto-selected based on file count, can be forced via prefs):
 *   - flat: just a list of full paths. Best for <15 files.
 *   - tree: nested by directory. Best for many files.
 *
 * Shows status icon (A/M/D/U/R), addition/deletion counts, annotation count,
 * and a "read" indicator (filled circle = unread, empty = read or no marker).
 */

import { useMemo } from 'react';
import type { FileChange, ReadMark } from '@shared/types';

interface Props {
  files: FileChange[];
  selected: string | undefined;
  readMarks: ReadMark[];
  mode: 'auto' | 'flat' | 'tree';
  annotationCounts: Map<string, number>;
  onSelect: (path: string) => void;
}

export function FileTree({
  files,
  selected,
  readMarks,
  mode,
  annotationCounts,
  onSelect,
}: Props) {
  const useTree = mode === 'tree' || (mode === 'auto' && files.length > 15);
  const readSet = useMemo(() => {
    const s = new Set<string>();
    for (const m of readMarks) s.add(m.filePath);
    return s;
  }, [readMarks]);

  if (useTree) {
    return (
      <TreeView
        files={files}
        selected={selected}
        readSet={readSet}
        annotationCounts={annotationCounts}
        onSelect={onSelect}
      />
    );
  }
  return (
    <ul className="file-list">
      {files.map((f) => (
        <FileRow
          key={f.path}
          file={f}
          selected={f.path === selected}
          read={readSet.has(f.path)}
          annotations={annotationCounts.get(f.path) ?? 0}
          onClick={() => onSelect(f.path)}
        />
      ))}
    </ul>
  );
}

function FileRow({
  file,
  selected,
  read,
  annotations,
  onClick,
  indent = 0,
}: {
  file: FileChange;
  selected: boolean;
  read: boolean;
  annotations: number;
  onClick: () => void;
  indent?: number;
}) {
  const display = file.path.split('/').pop() ?? file.path;
  const dir = file.path.includes('/')
    ? file.path.slice(0, file.path.lastIndexOf('/'))
    : '';
  return (
    <li
      className={`file-row ${selected ? 'selected' : ''}`}
      onClick={onClick}
      style={{ paddingLeft: 8 + indent * 12 }}
      title={file.path}
    >
      <span className={`status-tag s-${file.status}`}>{statusLetter(file.status)}</span>
      <span className="file-name">
        {indent === 0 && dir && <span className="file-dir">{dir}/</span>}
        {display}
      </span>
      <span className="file-meta">
        {!read && <span className="unread-dot" title="unread" />}
        {annotations > 0 && (
          <span className="ann-count" title={`${annotations} annotation(s)`}>
            {annotations}
          </span>
        )}
        {!file.binary && (file.additions > 0 || file.deletions > 0) && (
          <>
            {file.additions > 0 && <span className="add">+{file.additions}</span>}
            {file.deletions > 0 && <span className="del">−{file.deletions}</span>}
          </>
        )}
      </span>
    </li>
  );
}

function statusLetter(s: FileChange['status']): string {
  switch (s) {
    case 'added': return 'A';
    case 'modified': return 'M';
    case 'deleted': return 'D';
    case 'renamed': return 'R';
    case 'untracked': return 'U';
    case 'submodule': return 'S';
    default: return '?';
  }
}

// ---------- Tree view ----------

interface TreeNode {
  name: string;
  path: string;
  children: Map<string, TreeNode>;
  file?: FileChange;
}

function buildTree(files: FileChange[]): TreeNode {
  const root: TreeNode = { name: '', path: '', children: new Map() };
  for (const f of files) {
    const parts = f.path.split('/');
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLeaf = i === parts.length - 1;
      let next = cur.children.get(part);
      if (!next) {
        next = {
          name: part,
          path: parts.slice(0, i + 1).join('/'),
          children: new Map(),
        };
        cur.children.set(part, next);
      }
      if (isLeaf) next.file = f;
      cur = next;
    }
  }
  return root;
}

function TreeView({
  files,
  selected,
  readSet,
  annotationCounts,
  onSelect,
}: {
  files: FileChange[];
  selected: string | undefined;
  readSet: Set<string>;
  annotationCounts: Map<string, number>;
  onSelect: (path: string) => void;
}) {
  const root = useMemo(() => buildTree(files), [files]);
  return (
    <ul className="file-tree">
      {[...root.children.values()].map((n) => (
        <TreeBranch
          key={n.path}
          node={n}
          depth={0}
          selected={selected}
          readSet={readSet}
          annotationCounts={annotationCounts}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
}

function TreeBranch({
  node,
  depth,
  selected,
  readSet,
  annotationCounts,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selected: string | undefined;
  readSet: Set<string>;
  annotationCounts: Map<string, number>;
  onSelect: (path: string) => void;
}) {
  if (node.file) {
    return (
      <FileRow
        file={node.file}
        selected={node.file.path === selected}
        read={readSet.has(node.file.path)}
        annotations={annotationCounts.get(node.file.path) ?? 0}
        onClick={() => onSelect(node.file!.path)}
        indent={depth}
      />
    );
  }
  return (
    <>
      <li
        className="tree-dir"
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        <span className="dir-name">{node.name}/</span>
      </li>
      {[...node.children.values()].map((c) => (
        <TreeBranch
          key={c.path}
          node={c}
          depth={depth + 1}
          selected={selected}
          readSet={readSet}
          annotationCounts={annotationCounts}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}
