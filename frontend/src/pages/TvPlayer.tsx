import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { assetUrl } from "../api/client";
import {
  connectTv,
  fetchItemEmbed,
  fetchPlaylist,
  forgetTvToken,
  linkExists,
  savedTvToken,
  type PlayerItem,
  type Playlist,
} from "../api/tvPlayer";
import ReportEmbed from "../components/ReportEmbed";
import SlideshowProgress from "../components/SlideshowProgress";
import { NoWorkspaceProvider } from "../context/WorkspaceContext";

const PLAYLIST_REFRESH_MS = 3 * 60 * 1000;

type Phase = "checking" | "notfound" | "code" | "playing";

/** Mesma lista? Compara so o que muda o que passa na tela, para a recarga periodica nao reiniciar a rotacao a toa. */
function sameItems(a: PlayerItem[], b: PlayerItem[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** A pagina da propria TV: abre pelo link secreto, pede o codigo (que aparece no cadastro da TV) e passa a programacao
 * em tela cheia. Nao tem login: a conexao e um token guardado neste aparelho, que o servidor corta quando a TV e
 * desconectada ou o tempo configurado acaba. */
export default function TvPlayer() {
  const { secret = "" } = useParams();
  const [phase, setPhase] = useState<Phase>("checking");
  const [token, setToken] = useState<string | null>(null);
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const askForCode = useCallback((message: string | null) => {
    forgetTvToken(secret);
    setToken(null);
    setPlaylist(null);
    setNotice(message);
    setPhase("code");
  }, [secret]);

  // Ao abrir: com um token guardado, tenta voltar direto; sem ele (ou se o servidor recusar), pede o codigo
  useEffect(() => {
    let cancelled = false;
    async function start() {
      const saved = savedTvToken(secret);
      if (saved) {
        try {
          const list = await fetchPlaylist(saved);
          if (cancelled) return;
          setToken(saved);
          setPlaylist(list);
          setPhase("playing");
          return;
        } catch (err: any) {
          if (cancelled) return;
          if (err?.response?.status === 401) {
            askForCode("A conexão desta TV acabou. Digite o código para conectar de novo.");
            return;
          }
          // Sem rede agora: continua tentando em vez de pedir o codigo a toa
          setToken(saved);
          setPlaylist({ name: "", items: [] });
          setPhase("playing");
          return;
        }
      }
      const exists = await linkExists(secret);
      if (!cancelled) setPhase(exists ? "code" : "notfound");
    }
    start();
    return () => {
      cancelled = true;
    };
  }, [secret, askForCode]);

  // Uma TV fica ligada por dias: confere a lista de tempos em tempos, sem mexer na tela se nada mudou
  useEffect(() => {
    if (phase !== "playing" || !token) return;
    const timer = setInterval(async () => {
      try {
        const list = await fetchPlaylist(token);
        setPlaylist((current) => (current && current.name === list.name && sameItems(current.items, list.items) ? current : list));
      } catch (err: any) {
        if (err?.response?.status === 401) askForCode("A conexão desta TV foi encerrada. Digite o código para conectar de novo.");
        // Outra falha (rede): segue mostrando o que ja tem
      }
    }, PLAYLIST_REFRESH_MS);
    return () => clearInterval(timer);
  }, [phase, token, askForCode]);

  if (phase === "checking") return <div className="tv-player tv-player-center">Carregando...</div>;
  if (phase === "notfound") {
    return (
      <div className="tv-player tv-player-center">
        <h1>Link não encontrado</h1>
        <p>Este link de TV não existe mais ou foi trocado. Peça o link novo a quem cuida do Modo TV.</p>
      </div>
    );
  }
  if (phase === "code" || !token || !playlist) {
    return (
      <CodeScreen
        secret={secret}
        notice={notice}
        onConnected={async (newToken) => {
          try {
            const list = await fetchPlaylist(newToken);
            setToken(newToken);
            setPlaylist(list);
            setNotice(null);
            setPhase("playing");
          } catch {
            askForCode("Nao foi possivel carregar a programacao. Tente de novo.");
          }
        }}
      />
    );
  }

  return (
    <NoWorkspaceProvider>
      <Rotation token={token} items={playlist.items} onExpired={() => askForCode("A conexão desta TV foi encerrada. Digite o código para conectar de novo.")} />
    </NoWorkspaceProvider>
  );
}

function CodeScreen({
  secret,
  notice,
  onConnected,
}: {
  secret: string;
  notice: string | null;
  onConnected: (token: string) => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      onConnected(await connectTv(secret, code));
    } catch (err: any) {
      const status = err?.response?.status;
      setError(
        status === 429
          ? "Muitas tentativas erradas. Espere alguns minutos e tente de novo."
          : status === 403
            ? "Código incorreto. Confira o código atual no cadastro desta TV, ele muda com o tempo."
            : "Nao foi possivel conectar. Confira a internet da TV e tente de novo.",
      );
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tv-player tv-player-center">
      <form className="tv-player-code" onSubmit={submit}>
        <span className="material-symbols-outlined tv-player-icon" aria-hidden="true">
          tv
        </span>
        <h1>Conectar esta TV</h1>
        <p>Digite o código de acesso que aparece no módulo Modo TV, no cadastro desta TV.</p>
        {notice && <p className="tv-player-notice">{notice}</p>}
        <input
          className="tv-player-input"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          placeholder="000000"
          aria-label="Código de acesso"
        />
        {error && (
          <p className="tv-player-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="tv-player-button" disabled={busy || code.length < 6}>
          {busy ? "Conectando..." : "Conectar"}
        </button>
      </form>
    </div>
  );
}

/** Passa os itens um a um, cada um pelo seu tempo, e volta ao primeiro no fim. As setas trocam de item e o espaco pausa. */
function Rotation({ token, items, onExpired }: { token: string; items: PlayerItem[]; onExpired: () => void }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const count = items.length;
  const current = count > 0 ? items[index % count] : null;
  const onExpiredRef = useRef(onExpired);
  onExpiredRef.current = onExpired;

  // Se a lista encolheu, volta ao primeiro
  useEffect(() => {
    if (index >= count && count > 0) {
      setIndex(0);
      setEpoch((e) => e + 1);
    }
  }, [count, index]);

  const step = useCallback(
    (delta: 1 | -1) => {
      if (count < 2) return;
      setIndex((i) => (i + delta + count) % count);
      setEpoch((e) => e + 1);
    },
    [count],
  );

  // Cada item tem o proprio tempo: o temporizador recomeca a cada item e a cada retomada
  useEffect(() => {
    if (!current || paused || count < 2) return;
    const timer = setTimeout(() => step(1), current.seconds * 1000);
    return () => clearTimeout(timer);
  }, [current, paused, count, step, epoch]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "ArrowRight") step(1);
      else if (event.key === "ArrowLeft") step(-1);
      else if (event.key === " ") {
        event.preventDefault();
        setPaused((p) => !p);
        setEpoch((e) => e + 1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  if (!current) {
    return (
      <div className="tv-player tv-player-center">
        <h1>Nada para mostrar ainda</h1>
        <p>Esta TV ainda não tem itens. Monte a programação no módulo Modo TV.</p>
      </div>
    );
  }

  return (
    <div className="tv-player">
      {count > 1 && <SlideshowProgress countdown={{ key: epoch, durationMs: current.seconds * 1000, from: 0 }} paused={paused} />}
      <div className="tv-player-stage">
        <ItemView key={`${current.id}-${epoch}`} token={token} item={current} onExpired={() => onExpiredRef.current()} />
      </div>
    </div>
  );
}

function ItemView({ token, item, onExpired }: { token: string; item: PlayerItem; onExpired: () => void }) {
  const loadConfig = useCallback(
    () =>
      fetchItemEmbed(token, item.id).catch((err) => {
        // Conexao encerrada no meio do caminho: volta para a tela do codigo
        if (err?.response?.status === 401) onExpired();
        throw err;
      }),
    [token, item.id, onExpired],
  );

  if (item.kind === "image" && item.image_url) {
    return <img className="tv-player-image" src={assetUrl(item.image_url)} alt="" />;
  }
  if (item.kind === "youtube" && item.video_id) {
    const id = item.video_id;
    const params = `autoplay=1&mute=${item.sound ? 0 : 1}&controls=0&rel=0&modestbranding=1&playsinline=1&loop=1&playlist=${id}`;
    return (
      <iframe
        className="tv-player-video"
        src={`https://www.youtube-nocookie.com/embed/${id}?${params}`}
        title="Vídeo do YouTube"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
      />
    );
  }
  if (item.kind === "report_page" && item.page_name) {
    return <ReportEmbed reportId={item.id} height="100%" loadConfig={loadConfig} forcePage={item.page_name} />;
  }
  return null;
}
