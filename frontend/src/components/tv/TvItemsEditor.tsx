import { useEffect, useMemo, useRef, useState } from "react";
import { assetUrl, extractErrorMessage } from "../../api/client";
import {
  getReportRls,
  listTvReportPages,
  listTvReports,
  uploadTvImage,
  type ReportRlsInfo,
  type TvItem,
  type TvItemInput,
  type TvPageChoice,
  type TvReportChoice,
} from "../../api/tvs";
import { useToast } from "../../context/ToastContext";
import { formatDuration } from "../../utils/tvTime";
import MenuIcon from "../MenuIcon";

const DEFAULT_SECONDS = 30;
const MIN_SECONDS = 3;
const MAX_SECONDS = 3600;

/** Um item da lista em edicao: o que vai ser salvo, mais o que a tela mostra (nomes, miniatura). */
export interface DraftItem {
  key: string;
  kind: TvItem["kind"];
  seconds: number;
  report_id: number | null;
  page_name: string | null;
  image_url: string | null;
  video_id: string | null;
  sound: boolean;
  /** Relatorio com RLS: a funcao de seguranca que a TV usa */
  rls_role?: string | null;
  /** Texto para a pessoa reconhecer o item */
  title: string;
  subtitle: string;
}

let nextKey = 1;
const newKey = () => `item-${nextKey++}`;

export function draftsFromItems(items: TvItem[]): DraftItem[] {
  return items.map((item) => ({
    key: newKey(),
    kind: item.kind,
    seconds: item.seconds,
    report_id: item.report_id,
    page_name: item.page_name,
    image_url: item.image_url,
    video_id: item.video_id,
    sound: item.sound,
    rls_role: item.rls_role ?? null,
    title:
      item.kind === "report_page"
        ? item.report_name || "Relatório"
        : item.kind === "image"
          ? "Imagem"
          : "Vídeo do YouTube",
    subtitle:
      item.kind === "report_page"
        ? `${item.collection_name ?? ""}${item.collection_name ? " · " : ""}página ${item.page_name ?? ""}${item.rls_role ? ` · função ${item.rls_role}` : ""}`
        : item.kind === "youtube"
          ? `youtube.com/watch?v=${item.video_id}`
          : "",
  }));
}

export function inputsFromDrafts(drafts: DraftItem[]): TvItemInput[] {
  return drafts.map((d) => ({
    kind: d.kind,
    seconds: d.seconds,
    report_id: d.report_id,
    page_name: d.page_name,
    image_url: d.image_url,
    video_url: d.kind === "youtube" ? `https://youtu.be/${d.video_id}` : null,
    sound: d.sound,
    rls_role: d.rls_role ?? null,
  }));
}

function clampSeconds(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SECONDS;
  return Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Math.round(value)));
}

type Adding = "report" | "image" | "youtube" | null;

/** A programacao da TV: a lista de itens, cada um com o seu tempo, e as tres formas de acrescentar (pagina de relatorio,
 * imagem e video do YouTube). So edita quem pode modificar; os outros veem a lista em leitura. */
export default function TvItemsEditor({
  tvId,
  items,
  onChange,
  readOnly,
}: {
  tvId: number;
  items: DraftItem[];
  onChange: (next: DraftItem[]) => void;
  readOnly: boolean;
}) {
  const [adding, setAdding] = useState<Adding>(null);

  function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  function update(index: number, patch: Partial<DraftItem>) {
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  const total = items.reduce((sum, item) => sum + item.seconds, 0);

  return (
    <div className="tv-items">
      {items.length === 0 ? (
        <p className="tv-muted">Nenhum item ainda. Adicione páginas de relatórios, imagens ou vídeos do YouTube.</p>
      ) : (
        <>
          <ol className="tv-item-list">
            {items.map((item, index) => (
              <li key={item.key} className="tv-item">
                <span className="tv-item-position">{index + 1}</span>
                <span className="tv-item-thumb" aria-hidden="true">
                  {item.kind === "image" && item.image_url ? (
                    <img src={assetUrl(item.image_url)} alt="" />
                  ) : (
                    <span className="material-symbols-outlined">
                      {item.kind === "report_page" ? "bar_chart" : "smart_display"}
                    </span>
                  )}
                </span>
                <span className="tv-item-text">
                  <strong>{item.title}</strong>
                  {item.subtitle && <small>{item.subtitle}</small>}
                  {item.kind === "youtube" && (
                    <label className="tv-item-sound">
                      <input
                        type="checkbox"
                        checked={item.sound}
                        disabled={readOnly}
                        onChange={(e) => update(index, { sound: e.target.checked })}
                      />
                      Tocar com som
                    </label>
                  )}
                </span>
                <label className="tv-item-seconds">
                  <input
                    type="number"
                    className="input"
                    min={MIN_SECONDS}
                    max={MAX_SECONDS}
                    value={item.seconds}
                    disabled={readOnly}
                    aria-label={`Segundos do item ${index + 1}`}
                    onChange={(e) => update(index, { seconds: Number(e.target.value) })}
                    onBlur={(e) => update(index, { seconds: clampSeconds(Number(e.target.value)) })}
                  />
                  <span>s</span>
                </label>
                {!readOnly && (
                  <span className="tv-item-actions">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Subir o item ${index + 1}`}>
                      <MenuIcon name="arrow_upward" />
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => move(index, 1)} disabled={index === items.length - 1} aria-label={`Descer o item ${index + 1}`}>
                      <MenuIcon name="arrow_downward" />
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(items.filter((_, i) => i !== index))} aria-label={`Remover o item ${index + 1}`}>
                      <MenuIcon name="delete" />
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ol>
          <p className="tv-muted">
            {items.length} {items.length === 1 ? "item" : "itens"}, {formatDuration(total)} para dar a volta completa.
          </p>
        </>
      )}

      {!readOnly && (
        <div className="tv-add">
          <div className="tv-add-buttons">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAdding(adding === "report" ? null : "report")}>
              <MenuIcon name="bar_chart" /> Página de relatório
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAdding(adding === "image" ? null : "image")}>
              <MenuIcon name="image" /> Imagem
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAdding(adding === "youtube" ? null : "youtube")}>
              <MenuIcon name="smart_display" /> Vídeo do YouTube
            </button>
          </div>
          {adding === "report" && (
            <AddReport
              onAdd={(draft) => {
                onChange([...items, draft]);
                setAdding(null);
              }}
            />
          )}
          {adding === "image" && (
            <AddImage
              tvId={tvId}
              onAdd={(draft) => {
                onChange([...items, draft]);
                setAdding(null);
              }}
            />
          )}
          {adding === "youtube" && (
            <AddYoutube
              onAdd={(draft) => {
                onChange([...items, draft]);
                setAdding(null);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function SecondsField({ value, onChange }: { value: number; onChange: (next: number) => void }) {
  return (
    <label className="tv-add-field">
      Tempo na tela (segundos)
      <input
        type="number"
        className="input"
        min={MIN_SECONDS}
        max={MAX_SECONDS}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onBlur={(e) => onChange(clampSeconds(Number(e.target.value)))}
      />
    </label>
  );
}

function AddReport({ onAdd }: { onAdd: (draft: DraftItem) => void }) {
  const { showToast } = useToast();
  const [reports, setReports] = useState<TvReportChoice[] | null>(null);
  const [reportId, setReportId] = useState("");
  const [pages, setPages] = useState<TvPageChoice[] | null>(null);
  const [pageName, setPageName] = useState("");
  const [seconds, setSeconds] = useState(DEFAULT_SECONDS);
  const [error, setError] = useState<string | null>(null);
  // Relatorio com RLS: a funcao que a TV usa (so as que a pessoa tem) e se a chave geral esta ligada
  const [rlsInfo, setRlsInfo] = useState<ReportRlsInfo | null>(null);
  const [role, setRole] = useState("");

  useEffect(() => {
    listTvReports()
      .then(setReports)
      .catch((err) => setError(extractErrorMessage(err) || "Nao foi possivel listar os relatorios."));
  }, []);

  useEffect(() => {
    setRlsInfo(null);
    setRole("");
    if (!reportId) return;
    let cancelled = false;
    getReportRls(Number(reportId))
      .then((info) => {
        if (cancelled) return;
        setRlsInfo(info);
        if (info.rls && info.roles.length === 1) setRole(info.roles[0]);
      })
      .catch(() => !cancelled && setRlsInfo(null));
    return () => {
      cancelled = true;
    };
  }, [reportId]);

  useEffect(() => {
    setPages(null);
    setPageName("");
    if (!reportId) return;
    let cancelled = false;
    listTvReportPages(Number(reportId))
      .then((list) => {
        if (cancelled) return;
        setPages(list);
        if (list.length === 1) setPageName(list[0].name);
      })
      .catch((err) => {
        if (!cancelled) {
          setPages([]);
          setError(extractErrorMessage(err) || "Nao foi possivel listar as paginas do relatorio.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reportId]);

  const grouped = useMemo(() => {
    const byCollection = new Map<string, TvReportChoice[]>();
    for (const report of reports ?? []) {
      byCollection.set(report.collection_name, [...(byCollection.get(report.collection_name) ?? []), report]);
    }
    return [...byCollection.entries()];
  }, [reports]);

  function add() {
    const report = reports?.find((r) => String(r.id) === reportId);
    const page = pages?.find((p) => p.name === pageName);
    if (!report || !page) {
      showToast("Escolha o relatório e a página.", "error");
      return;
    }
    if (rlsInfo?.rls && !role) {
      showToast("Escolha a função de segurança que a TV usa.", "error");
      return;
    }
    onAdd({
      key: newKey(),
      kind: "report_page",
      seconds: clampSeconds(seconds),
      report_id: report.id,
      page_name: page.name,
      image_url: null,
      video_id: null,
      sound: false,
      rls_role: rlsInfo?.rls ? role : null,
      title: report.name,
      subtitle: `${report.collection_name} · ${page.title}${rlsInfo?.rls ? ` · função ${role}` : ""}`,
    });
  }

  return (
    <div className="tv-add-form">
      {error && <p className="auth-error">{error}</p>}
      <label className="tv-add-field">
        Relatório
        <select className="input" value={reportId} onChange={(e) => setReportId(e.target.value)} disabled={reports === null}>
          <option value="">{reports === null ? "Carregando..." : "Escolha um relatório"}</option>
          {grouped.map(([collection, list]) => (
            <optgroup key={collection} label={collection}>
              {list.map((report) => (
                <option key={report.id} value={report.id}>
                  {report.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      {reportId && (
        <label className="tv-add-field">
          Página
          <select className="input" value={pageName} onChange={(e) => setPageName(e.target.value)} disabled={pages === null}>
            <option value="">{pages === null ? "Carregando as páginas..." : "Escolha uma página"}</option>
            {(pages ?? []).map((page) => (
              <option key={page.name} value={page.name}>
                {page.title}
              </option>
            ))}
          </select>
        </label>
      )}
      {rlsInfo?.rls && (
        <div className="tv-add-field" role="group" aria-label="Segurança por linha">
          {!rlsInfo.switch_on ? (
            <p className="auth-error" role="alert">
              Este relatório tem segurança por linha (RLS). Peça a um administrador para permitir a saída de relatório com RLS em Administração, aba Geral.
            </p>
          ) : rlsInfo.roles.length === 0 ? (
            <p className="auth-error" role="alert">
              Este relatório tem segurança por linha (RLS) e você não tem função de segurança nele, então não pode colocá-lo na TV.
            </p>
          ) : (
            <label>
              Função de segurança da TV
              <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="">Escolha a função</option>
                {rlsInfo.roles.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <span className="field-hint">A TV mostra só o que essa função enxerga, para quem estiver olhando. Só entram as funções que você tem.</span>
            </label>
          )}
        </div>
      )}
      <SecondsField value={seconds} onChange={setSeconds} />
      <button
        type="button"
        className="btn btn-primary btn-sm"
        onClick={add}
        disabled={!reportId || !pageName || Boolean(rlsInfo?.rls && (!rlsInfo.switch_on || !role))}
      >
        Adicionar à lista
      </button>
    </div>
  );
}

function AddImage({ tvId, onAdd }: { tvId: number; onAdd: (draft: DraftItem) => void }) {
  const [seconds, setSeconds] = useState(DEFAULT_SECONDS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const url = await uploadTvImage(tvId, file);
      onAdd({
        key: newKey(),
        kind: "image",
        seconds: clampSeconds(seconds),
        report_id: null,
        page_name: null,
        image_url: url,
        video_id: null,
        sound: false,
        title: file.name || "Imagem",
        subtitle: "",
      });
    } catch (err) {
      setError(extractErrorMessage(err) || "Nao foi possivel enviar a imagem.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="tv-add-form">
      {error && <p className="auth-error">{error}</p>}
      <SecondsField value={seconds} onChange={setSeconds} />
      <label className="tv-add-field">
        Imagem (PNG, JPG, GIF ou WebP, até 10 MB)
        <input
          ref={inputRef}
          type="file"
          className="input"
          accept="image/png,image/jpeg,image/gif,image/webp"
          disabled={busy}
          onChange={(e) => pick(e.target.files?.[0])}
        />
      </label>
      {busy && <p className="tv-muted">Enviando a imagem...</p>}
    </div>
  );
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/** O id do video de um link do YouTube, ou null. A conferencia final e do servidor; aqui so evita enviar lixo. */
export function youtubeIdFromLink(link: string): string | null {
  try {
    const url = new URL(link.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.replace(/^(www|m)\./, "");
    let candidate: string | null = null;
    if (host === "youtu.be") candidate = url.pathname.split("/").filter(Boolean)[0] ?? null;
    else if (host === "youtube.com" || host === "music.youtube.com" || host === "youtube-nocookie.com") {
      const parts = url.pathname.split("/").filter(Boolean);
      if (url.pathname.startsWith("/watch")) candidate = url.searchParams.get("v");
      else if (parts.length >= 2 && ["embed", "shorts", "live", "v"].includes(parts[0])) candidate = parts[1];
    }
    return candidate && YOUTUBE_ID.test(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

function AddYoutube({ onAdd }: { onAdd: (draft: DraftItem) => void }) {
  const [link, setLink] = useState("");
  const [seconds, setSeconds] = useState(60);
  const [sound, setSound] = useState(false);
  const videoId = youtubeIdFromLink(link);

  function add() {
    if (!videoId) return;
    onAdd({
      key: newKey(),
      kind: "youtube",
      seconds: clampSeconds(seconds),
      report_id: null,
      page_name: null,
      image_url: null,
      video_id: videoId,
      sound,
      title: "Vídeo do YouTube",
      subtitle: `youtube.com/watch?v=${videoId}`,
    });
  }

  return (
    <div className="tv-add-form">
      <label className="tv-add-field">
        Link do vídeo
        <input className="input" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://www.youtube.com/watch?v=..." />
      </label>
      {link.trim() !== "" && !videoId && <p className="auth-error">Esse link não parece ser de um vídeo do YouTube.</p>}
      <SecondsField value={seconds} onChange={setSeconds} />
      <label className="tv-item-sound">
        <input type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} />
        Tocar com som
      </label>
      <button type="button" className="btn btn-primary btn-sm" onClick={add} disabled={!videoId}>
        Adicionar à lista
      </button>
    </div>
  );
}
