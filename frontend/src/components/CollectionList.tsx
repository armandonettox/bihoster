import { useNavigate } from "react-router-dom";
import { useWorkspace } from "../context/WorkspaceContext";
import CollectionIcon from "./CollectionIcon";

export default function CollectionList() {
  const { workspaces, currentWorkspace, selectWorkspace } = useWorkspace();
  const navigate = useNavigate();

  function handleSelect(id: number) {
    selectWorkspace(id);
    navigate("/collection");
  }

  if (workspaces.length === 0) {
    return <p className="sidebar-loading">Nenhuma colecao disponivel.</p>;
  }

  return (
    <div className="collection-list">
      {workspaces.map((w) => (
        <button
          key={w.id}
          className={`collection-list-item ${currentWorkspace?.id === w.id ? "collection-list-item-active" : ""}`}
          onClick={() => handleSelect(w.id)}
        >
          <CollectionIcon name={w.name} icon={w.icon} color={w.color} size={22} />
          <span className="collection-list-name">{w.name}</span>
        </button>
      ))}
    </div>
  );
}
