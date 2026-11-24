import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { extractErrorMessage } from "../api/client";
import { createTv, deleteTv, getTv, listTvs, tvLinkUrl, type TvSummary } from "../api/tvs";
import ConfirmDialog from "../components/ConfirmDialog";
import KebabMenu from "../components/KebabMenu";
import MenuIcon from "../components/MenuIcon";
import PageLoading from "../components/PageLoading";
import { useAccess } from "../context/AccessContext";
import { useToast } from "../context/ToastContext";
import { copyText } from "../utils/clipboard";
import { formatDuration } from "../utils/tvTime";

/** Modo TV: as TVs cadastradas. Cada TV tem a propria programacao (paginas de relatorios, imagens e videos do YouTube),
 * o link secreto e quem pode acessar. Pagina propria, fora das colecoes. */
export default function Tvs() {
  const access = useAccess();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [tvs, setTvs] = useState<TvSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<TvSummary | null>(null);
  const canCreate = access.can("tv.criar");

  const load = useCallback(async () => {
    try {
      setTvs(await listTvs());
      setError(null);
    } catch (err) {
      setError(extractErrorMessage(err) || "Nao foi possivel carregar as TVs.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (access.loading) return <PageLoading />;
  if (!access.hasTvAccess) return <Navigate to="/" replace />;

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      const tv = await createTv(name.trim());
      navigate(`/tv/${tv.id}`);
    } catch (err) {
      showToast(extractErrorMessage(err) || "Nao foi possivel criar a TV.", "error");
      setCreating(false);
    }
  }

  async function copyLink(tv: TvSummary, close: () => void) {
    close();
    try {
      const detail = await getTv(tv.id);
      await copyText(tvLinkUrl(detail.link_secret));
      showToast("Link da TV copiado.");
    } catch (err) {
      showToast(extractErrorMessage(err) || "Nao foi possivel copiar o link.", "error");
    }
  }

  async function openLink(tv: TvSummary, close: () => void) {
    close();
    try {
      const detail = await getTv(tv.id);
      window.open(tvLinkUrl(detail.link_secret), "_blank", "noopener");
    } catch (err) {
      showToast(extractErrorMessage(err) || "Nao foi possivel abrir a TV.", "error");
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    const tv = deleting;
    setDeleting(null);
    try {
      await deleteTv(tv.id);
      showToast("TV excluída.");
      load();
    } catch (err) {
      showToast(extractErrorMessage(err) || "Nao foi possivel excluir a TV.", "error");
    }
  }

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h1>Modo TV</h1>
        <p>Cadastre as TVs e monte o que passa em cada uma: páginas de relatórios, imagens e vídeos do YouTube, cada um com o seu tempo.</p>
      </div>

      {canCreate && (
        <form className="tv-create" onSubmit={handleCreate}>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome da nova TV, ex.: TV da recepção"
            aria-label="Nome da nova TV"
            maxLength={120}
          />
          <button type="submit" className="btn btn-primary" disabled={!name.trim() || creating}>
            {creating ? "Criando..." : "Criar TV"}
          </button>
        </form>
      )}

      {error && <p className="auth-error">{error}</p>}
      {tvs === null && !error && <PageLoading />}
      {tvs !== null && tvs.length === 0 && (
        <p className="tv-muted">
          {canCreate ? "Nenhuma TV ainda. Crie a primeira acima." : "Você ainda não tem acesso a nenhuma TV."}
        </p>
      )}

      {tvs !== null && tvs.length > 0 && (
        <ul className="tv-grid">
          {tvs.map((tv) => (
            <li key={tv.id} className="card tv-card">
              <span className="tv-card-icon" aria-hidden="true">
                <span className="material-symbols-outlined">tv</span>
              </span>
              <Link to={`/tv/${tv.id}`} className="tv-card-text">
                <strong>{tv.name}</strong>
                <small>
                  {tv.items_count} {tv.items_count === 1 ? "item" : "itens"}
                  {tv.items_count > 0 ? `, volta completa em ${formatDuration(tv.total_seconds)}` : ""}
                </small>
                <small className={tv.online ? "tv-status tv-status-on" : "tv-status"}>
                  {tv.online ? "Ligada agora" : "Desligada ou sem conexão"}
                </small>
              </Link>
              <KebabMenu floating>
                {(close) => (
                  <>
                    <button className="kebab-menu-item kebab-menu-item-with-icon" onClick={() => openLink(tv, close)}>
                      <MenuIcon name="open_in_new" />
                      Abrir a TV
                    </button>
                    <button className="kebab-menu-item kebab-menu-item-with-icon" onClick={() => copyLink(tv, close)}>
                      <MenuIcon name="link" />
                      Copiar o link
                    </button>
                    <button
                      className="kebab-menu-item kebab-menu-item-with-icon"
                      onClick={() => {
                        close();
                        navigate(`/tv/${tv.id}`);
                      }}
                    >
                      <MenuIcon name={tv.level === "modificar" ? "edit" : "visibility"} />
                      {tv.level === "modificar" ? "Editar" : "Ver detalhes"}
                    </button>
                    {tv.level === "modificar" && (
                      <button
                        className="kebab-menu-item kebab-menu-item-with-icon kebab-menu-item-danger"
                        onClick={() => {
                          close();
                          setDeleting(tv);
                        }}
                      >
                        <MenuIcon name="delete" />
                        Excluir
                      </button>
                    )}
                  </>
                )}
              </KebabMenu>
            </li>
          ))}
        </ul>
      )}

      {deleting && (
        <ConfirmDialog
          title="Excluir a TV"
          message={`Excluir a TV "${deleting.name}"? A programação e as permissões dela somem e a TV desconecta. Isso não pode ser desfeito.`}
          confirmLabel="Excluir"
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
