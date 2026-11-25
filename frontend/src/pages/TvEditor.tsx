import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { extractErrorMessage } from "../api/client";
import {
  deleteTv,
  disconnectTv,
  getTv,
  regenerateTvLink,
  replaceTvItems,
  tvLinkUrl,
  updateTv,
  type TvDetail,
} from "../api/tvs";
import ConfirmDialog from "../components/ConfirmDialog";
import MenuIcon from "../components/MenuIcon";
import PageLoading from "../components/PageLoading";
import TvCodePanel from "../components/tv/TvCodePanel";
import TvGrantsEditor from "../components/tv/TvGrantsEditor";
import TvItemsEditor, { draftsFromItems, inputsFromDrafts, type DraftItem } from "../components/tv/TvItemsEditor";
import { useToast } from "../context/ToastContext";
import { copyText } from "../utils/clipboard";
import { REFRESH_OPTIONS, refreshLabel, SESSION_OPTIONS, sessionLabel } from "../utils/tvTime";

type Confirm = "disconnect" | "regenerate" | "delete" | null;

/** Uma TV: o acesso (link secreto, codigo e tempo de conexao), a programacao e quem pode acessar. Quem so pode ver a TV
 * enxerga tudo em leitura, e ainda abre o link, ve o codigo e desconecta a TV. */
export default function TvEditor() {
  const { tvId } = useParams();
  const id = Number(tvId);
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [tv, setTv] = useState<TvDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [savedItems, setSavedItems] = useState("");
  const [savingItems, setSavingItems] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);

  const apply = useCallback((detail: TvDetail) => {
    setTv(detail);
    setName(detail.name);
    const fresh = draftsFromItems(detail.items);
    setDrafts(fresh);
    setSavedItems(JSON.stringify(inputsFromDrafts(fresh)));
  }, []);

  useEffect(() => {
    if (!Number.isFinite(id)) {
      setError("TV nao encontrada ou voce nao tem acesso a ela.");
      return;
    }
    getTv(id)
      .then(apply)
      .catch((err) => setError(extractErrorMessage(err) || "TV nao encontrada ou voce nao tem acesso a ela."));
  }, [id, apply]);

  const itemsDirty = useMemo(() => JSON.stringify(inputsFromDrafts(drafts)) !== savedItems, [drafts, savedItems]);

  if (error) {
    return (
      <div className="settings-page">
        <p className="auth-error">{error}</p>
        <Link to="/tv">Voltar ao Modo TV</Link>
      </div>
    );
  }
  if (!tv) return <PageLoading />;

  const canEdit = tv.level === "modificar";
  const link = tvLinkUrl(tv.link_secret);

  async function saveName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === tv!.name) {
      setName(tv!.name);
      return;
    }
    try {
      const detail = await updateTv(id, { name: trimmed });
      setTv((current) => (current ? { ...current, name: detail.name } : current));
      setName(detail.name);
      showToast("Nome da TV salvo.");
    } catch (err) {
      setName(tv!.name);
      showToast(extractErrorMessage(err) || "Nao foi possivel salvar o nome.", "error");
    }
  }

  async function changeRefresh(value: string) {
    const minutes = value === "never" ? null : Number(value);
    try {
      const detail = await updateTv(id, { refresh_minutes: minutes });
      setTv((current) => (current ? { ...current, refresh_minutes: detail.refresh_minutes } : current));
      showToast("Atualização dos dados salva.");
    } catch (err) {
      showToast(extractErrorMessage(err) || "Nao foi possivel salvar a atualizacao dos dados.", "error");
    }
  }

  async function changeSession(value: string) {
    const hours = value === "forever" ? null : Number(value);
    try {
      const detail = await updateTv(id, { session_hours: hours });
      setTv((current) => (current ? { ...current, session_hours: detail.session_hours } : current));
      showToast("Tempo de conexão salvo.");
    } catch (err) {
      showToast(extractErrorMessage(err) || "Nao foi possivel salvar o tempo de conexao.", "error");
    }
  }

  async function copyLink() {
    try {
      await copyText(link);
      showToast("Link da TV copiado.");
    } catch {
      showToast("Nao foi possivel copiar. Selecione o link e copie na mao.", "error");
    }
  }

  async function saveItems() {
    setSavingItems(true);
    try {
      apply(await replaceTvItems(id, inputsFromDrafts(drafts)));
      showToast("Programação da TV salva.");
    } catch (err) {
      showToast(extractErrorMessage(err) || "Nao foi possivel salvar a programacao.", "error");
    } finally {
      setSavingItems(false);
    }
  }

  async function runConfirmed() {
    const action = confirm;
    setConfirm(null);
    try {
      if (action === "disconnect") {
        await disconnectTv(id);
        showToast("TV desconectada. Para voltar, ela precisa do código.");
        setTv((current) => (current ? { ...current, online: false } : current));
      } else if (action === "regenerate") {
        const detail = await regenerateTvLink(id);
        setTv((current) => (current ? { ...current, link_secret: detail.link_secret, online: false } : current));
        showToast("Link trocado. O link antigo parou de funcionar e a TV foi desconectada.");
      } else if (action === "delete") {
        await deleteTv(id);
        showToast("TV excluída.");
        navigate("/tv");
      }
    } catch (err) {
      showToast(extractErrorMessage(err) || "Nao foi possivel concluir a acao.", "error");
    }
  }

  const confirmTexts: Record<Exclude<Confirm, null>, { title: string; message: string; label: string }> = {
    disconnect: {
      title: "Desconectar a TV",
      message: "A TV sai do ar agora e, para voltar, precisa abrir o link e digitar o código de novo. Continuar?",
      label: "Desconectar",
    },
    regenerate: {
      title: "Trocar o link",
      message: "O link atual para de funcionar e a TV é desconectada. Será preciso abrir o link novo na TV e digitar o código. Continuar?",
      label: "Trocar o link",
    },
    delete: {
      title: "Excluir a TV",
      message: `Excluir a TV "${tv.name}"? A programação e as permissões dela somem e a TV desconecta. Isso não pode ser desfeito.`,
      label: "Excluir",
    },
  };

  return (
    <div className="settings-page tv-editor">
      <div className="settings-header">
        <Link to="/tv" className="tv-back">
          <MenuIcon name="arrow_back" /> Modo TV
        </Link>
        {canEdit ? (
          <input
            className="input tv-name-input"
            value={name}
            maxLength={120}
            aria-label="Nome da TV"
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          <h1>{tv.name}</h1>
        )}
        <p className={tv.online ? "tv-status tv-status-on" : "tv-status"}>{tv.online ? "Ligada agora" : "Desligada ou sem conexão"}</p>
      </div>

      <section className="card tv-section">
        <h2>Acesso da TV</h2>
        <p className="tv-muted">
          Abra o link na TV (ou no navegador dela) e digite o código que aparece aqui. O código muda com o tempo. Depois de digitado, a TV fica conectada pelo tempo
          escolhido abaixo.
        </p>
        <div className="tv-link-row">
          <input className="input" readOnly value={link} aria-label="Link da TV" onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="btn btn-secondary btn-sm" onClick={copyLink}>
            <MenuIcon name="content_copy" /> Copiar
          </button>
          <a className="btn btn-secondary btn-sm" href={link} target="_blank" rel="noopener noreferrer">
            <MenuIcon name="open_in_new" /> Abrir em outra aba
          </a>
        </div>
        <div className="tv-access-grid">
          <div>
            <span className="tv-label">Código de acesso</span>
            <TvCodePanel tvId={id} />
          </div>
          <label className="tv-field">
            <span className="tv-label">Tempo de conexão</span>
            <select
              className="input"
              value={tv.session_hours === null ? "forever" : String(tv.session_hours)}
              disabled={!canEdit}
              onChange={(e) => changeSession(e.target.value)}
            >
              {SESSION_OPTIONS.map((option) => (
                <option key={option.label} value={option.hours === null ? "forever" : String(option.hours)}>
                  {option.label}
                </option>
              ))}
              {tv.session_hours !== null && !SESSION_OPTIONS.some((o) => o.hours === tv.session_hours) && (
                <option value={String(tv.session_hours)}>{sessionLabel(tv.session_hours)}</option>
              )}
            </select>
            <small className="tv-muted">Depois desse tempo a TV pede o código de novo. Toda nova conexão sempre pede o código.</small>
          </label>
          <label className="tv-field">
            <span className="tv-label">Atualizar os dados</span>
            <select
              className="input"
              value={tv.refresh_minutes === null ? "never" : String(tv.refresh_minutes)}
              disabled={!canEdit}
              onChange={(e) => changeRefresh(e.target.value)}
            >
              {REFRESH_OPTIONS.map((option) => (
                <option key={option.label} value={option.minutes === null ? "never" : String(option.minutes)}>
                  {option.label}
                </option>
              ))}
              {tv.refresh_minutes !== null && !REFRESH_OPTIONS.some((o) => o.minutes === tv.refresh_minutes) && (
                <option value={String(tv.refresh_minutes)}>{refreshLabel(tv.refresh_minutes)}</option>
              )}
            </select>
            <small className="tv-muted">De quanto em quanto tempo os relatórios buscam os dados novos, sem recarregar a página.</small>
          </label>
        </div>
        <div className="tv-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirm("disconnect")}>
            <MenuIcon name="link_off" /> Desconectar a TV
          </button>
          {canEdit && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirm("regenerate")}>
              <MenuIcon name="autorenew" /> Trocar o link
            </button>
          )}
        </div>
      </section>

      <section className="card tv-section">
        <h2>Programação</h2>
        <p className="tv-muted">A TV passa os itens nesta ordem, cada um pelo tempo definido, e volta ao primeiro no fim. A TV confere mudanças a cada poucos minutos.</p>
        <TvItemsEditor tvId={id} items={drafts} onChange={setDrafts} readOnly={!canEdit} />
        {canEdit && (
          <div className="tv-actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={saveItems} disabled={!itemsDirty || savingItems}>
              {savingItems ? "Salvando..." : "Salvar programação"}
            </button>
            {itemsDirty && <span className="tv-muted">Há mudanças ainda não salvas.</span>}
          </div>
        )}
      </section>

      {canEdit && (
        <section className="card tv-section">
          <h2>Quem pode acessar</h2>
          <TvGrantsEditor tvId={id} />
        </section>
      )}

      {canEdit && (
        <section className="card tv-section">
          <h2>Excluir a TV</h2>
          <p className="tv-muted">Apaga a TV, a programação e as permissões, e desconecta a TV.</p>
          <button type="button" className="btn btn-danger btn-sm" onClick={() => setConfirm("delete")}>
            <MenuIcon name="delete" /> Excluir a TV
          </button>
        </section>
      )}

      {confirm && (
        <ConfirmDialog
          title={confirmTexts[confirm].title}
          message={confirmTexts[confirm].message}
          confirmLabel={confirmTexts[confirm].label}
          onConfirm={runConfirmed}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
