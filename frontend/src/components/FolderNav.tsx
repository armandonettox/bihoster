import { useEffect, useState } from "react";
import * as workspacesApi from "../api/workspaces";
import type { TreeNode } from "../api/workspaces";
import { useWorkspace } from "../context/WorkspaceContext";
import { childrenOf, pathTo } from "../utils/folders";
import CollectionIcon from "./CollectionIcon";

/** Dentro de uma coleção: o caminho até ela (as pastas de cima aparecem só como nome, e só se a pessoa não acessa) e as
 * subpastas que ela acessa. Não mostra nada numa coleção solta, sem pai nem filhas. */
export default function FolderNav() {
  const { workspaces, currentWorkspace, selectWorkspace } = useWorkspace();
  const [tree, setTree] = useState<TreeNode[]>([]);
  const currentId = currentWorkspace?.id;

  useEffect(() => {
    if (currentId == null) return;
    let cancelled = false;
    workspacesApi
      .getWorkspaceTree()
      .then((nodes) => {
        if (!cancelled) setTree(Array.isArray(nodes) ? nodes : []);
      })
      .catch(() => {
        if (!cancelled) setTree([]);
      });
    return () => {
      cancelled = true;
    };
  }, [currentId]);

  if (currentId == null) return null;
  const path = pathTo(tree, currentId);
  const children = childrenOf(workspaces, currentId);
  if (path.length <= 1 && children.length === 0) return null;

  return (
    <div className="folder-nav" style={{ marginBottom: 16 }}>
      {path.length > 1 && (
        <nav aria-label="Caminho das pastas" style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", fontSize: 14, marginBottom: 8 }}>
          {path.map((node, index) => {
            const last = index === path.length - 1;
            return (
              <span key={node.id} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                {last || !node.accessible ? (
                  <span aria-current={last ? "page" : undefined} style={{ fontWeight: last ? 700 : 400, color: last ? undefined : "var(--color-text-muted)" }}>
                    {node.name}
                  </span>
                ) : (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => selectWorkspace(node.id)}>
                    {node.name}
                  </button>
                )}
                {!last && <span aria-hidden="true">/</span>}
              </span>
            );
          })}
        </nav>
      )}
      {children.length > 0 && (
        <div>
          <div style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 6 }}>Pastas dentro desta</div>
          <div className="settings-grid">
            {children.map((child) => (
              <button key={child.id} type="button" className="card home-collection-item" onClick={() => selectWorkspace(child.id)}>
                <CollectionIcon name={child.name} icon={child.icon} color={child.color} size={32} />
                <div style={{ flex: 1, minWidth: 0, textAlign: "left", fontWeight: 700 }}>{child.name}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
