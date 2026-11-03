import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import * as homeApi from "../api/home";
import type { HomeCollectionEntry } from "../api/home";
import type { Report } from "../api/reports";
import { useWorkspace } from "../context/WorkspaceContext";
import CollectionCard from "../components/CollectionCard";
import CollectionEntryList from "../components/CollectionEntryList";
import FavoriteReportList from "../components/FavoriteReportList";
import NewCollectionModal from "../components/NewCollectionModal";
import ViewModeToggle, { type ViewMode } from "../components/ViewModeToggle";
import { SkeletonList } from "../components/Skeleton";
import { useToast } from "../context/ToastContext";
import { useFavorites } from "../context/FavoritesContext";
import { useUrlTab } from "../hooks/useUrlTab";
import ListFilter from "../components/ListFilter";
import { filterByName } from "../utils/filterByName";
import { safeStorage } from "../utils/safeStorage";

type Tab = "collections" | "recommended" | "recent" | "favorites";
const HOME_VIEW_MODE_KEY = "home_view_mode";

const TABS: { key: Tab; label: string }[] = [
  { key: "collections", label: "Colecoes" },
  { key: "recommended", label: "Recomendado" },
  { key: "recent", label: "Recentes" },
  { key: "favorites", label: "Favoritos" },
];

const TAB_KEYS = TABS.map((t) => t.key);

export default function HomeDashboard() {
  // Aba na URL (?tab=), lembrando a ultima aberta
  const [tab, setTab] = useUrlTab<Tab>(TAB_KEYS, "collections", { storageKey: "home_tab" });
  const [viewMode, setViewMode] = useState<ViewMode>(
    () => (safeStorage.getItem(HOME_VIEW_MODE_KEY) as ViewMode) || "icon"
  );
  const { workspaces, selectWorkspace, currentWorkspace, reloadAndSelect } = useWorkspace();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [recommended, setRecommended] = useState<HomeCollectionEntry[]>([]);
  const [recent, setRecent] = useState<HomeCollectionEntry[]>([]);
  // Lista compartilhada com a barra lateral: favoritar/desfavoritar em qualquer lugar atualiza aqui
  const { favorites } = useFavorites();
  const [loading, setLoading] = useState(true);

  const [collectionFilter, setCollectionFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const isAnyAdmin = workspaces.some((w) => w.role === "admin");
  const visibleWorkspaces = filterByName(workspaces, collectionFilter, (w) => w.name);
  const { showToast } = useToast();

  function changeViewMode(mode: ViewMode) {
    setViewMode(mode);
    safeStorage.setItem(HOME_VIEW_MODE_KEY, mode);
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([homeApi.listRecommendedCollections(), homeApi.listRecentCollections()])
      .then(([rec, recentList]) => {
        if (cancelled) return;
        setRecommended(rec);
        setRecent(recentList);
      })
      .catch(() => {
        if (!cancelled) showToast("Nao foi possivel carregar os dados da pagina inicial.", "error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (searchParams.get("new") === "collection") {
      setCreating(true);
      // Limpa o ?new= e ja fixa a aba de colecoes numa unica troca de URL (limpar tudo apagaria
      // tambem o ?tab= e a tela voltaria pra aba lembrada)
      setSearchParams({ tab: "collections" }, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  function openCollection(entry: { id: number }) {
    if (currentWorkspace?.id !== entry.id) {
      selectWorkspace(entry.id);
    }
    navigate("/collection");
  }

  function openReportCollection(report: Report) {
    if (currentWorkspace?.id !== report.collection_id) {
      selectWorkspace(report.collection_id);
    }
    navigate("/collection");
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div className="settings-tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`settings-tab ${tab === t.key ? "settings-tab-active" : ""}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <ViewModeToggle viewMode={viewMode} onChange={changeViewMode} />
      </div>

      {loading ? (
        <SkeletonList count={4} />
      ) : (
        <>
          {tab === "collections" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <p style={{ color: "var(--color-text-muted)", fontSize: 14, margin: 0 }}>Colecoes que voce tem acesso.</p>
                {isAnyAdmin && !creating && (
                  <button className="btn btn-secondary btn-sm" onClick={() => setCreating(true)}>
                    + Nova colecao
                  </button>
                )}
              </div>

              {creating && <NewCollectionModal onClose={() => setCreating(false)} />}

              {workspaces.length === 0 ? (
                <p style={{ color: "var(--color-text-muted)" }}>Nenhuma colecao disponivel.</p>
              ) : visibleWorkspaces.length === 0 ? (
                <>
                  <ListFilter value={collectionFilter} onChange={setCollectionFilter} total={workspaces.length} resultCount={0} />
                  <p style={{ color: "var(--color-text-muted)" }}>Nenhuma colecao encontrada para "{collectionFilter.trim()}".</p>
                </>
              ) : (
                <>
                  <ListFilter
                    value={collectionFilter}
                    onChange={setCollectionFilter}
                    total={workspaces.length}
                    resultCount={visibleWorkspaces.length}
                  />
                  <div
                    key={viewMode}
                    className={`view-mode-fade ${viewMode === "icon" ? "settings-grid" : ""}`}
                    style={viewMode === "list" ? { display: "flex", flexDirection: "column", gap: 8 } : undefined}
                  >
                    {visibleWorkspaces.map((w) => (
                      <CollectionCard
                        key={w.id}
                        workspace={w}
                        viewMode={viewMode}
                        onOpen={() => {
                          selectWorkspace(w.id);
                          navigate("/collection");
                        }}
                        onChanged={() => reloadAndSelect(currentWorkspace?.id ?? w.id)}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {tab === "recommended" && (
            <CollectionEntryList
              entries={recommended}
              emptyMessage="Nenhuma recomendacao no momento."
              viewMode={viewMode}
              onOpen={openCollection}
            />
          )}

          {tab === "recent" && (
            <CollectionEntryList
              entries={recent}
              emptyMessage="Voce ainda nao visitou nenhuma colecao."
              viewMode={viewMode}
              onOpen={openCollection}
            />
          )}

          {tab === "favorites" && (
            <FavoriteReportList
              reports={favorites}
              workspaces={workspaces}
              emptyMessage="Voce ainda nao favoritou nenhum relatorio."
              viewMode={viewMode}
              onOpen={openReportCollection}
            />
          )}
        </>
      )}
    </div>
  );
}
