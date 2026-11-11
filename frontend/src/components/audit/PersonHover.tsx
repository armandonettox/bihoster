import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AuditPerson } from "../../api/audit";
import { formatDateTime } from "../../utils/datetime";
import UserAvatar from "../UserAvatar";

interface Props {
  name: string | null;
  email: string | null;
  /** Detalhes da pessoa; ausente quando ela foi removida */
  person?: AuditPerson;
  timezone?: string;
  /** Filtra a tabela so por essa pessoa */
  onFilter?: (userId: number) => void;
}

const CARD_WIDTH = 320;
const CLOSE_DELAY_MS = 150;

function memberSince(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString("pt-BR", { dateStyle: "long" });
}

/** Nome da pessoa na tabela; ao passar o cursor (ou focar pelo teclado) abre um cartao com os
 * detalhes dela. O cartao sai do fluxo da tabela (portal) para nao ser cortado pela rolagem. */
export default function PersonHover({ name, email, person, timezone, onFilter }: Props) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);

  const label = name || email;

  function cancelClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }

  function open() {
    cancelClose();
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Mantem o cartao dentro da janela, mesmo para nomes perto da borda direita
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - CARD_WIDTH - 8));
    setAnchor({ top: rect.bottom + 6, left });
  }

  function scheduleClose() {
    cancelClose();
    closeTimer.current = setTimeout(() => setAnchor(null), CLOSE_DELAY_MS);
  }

  // Esc fecha o cartao; some tambem ao rolar, porque ele nao acompanha a tabela
  useEffect(() => {
    if (!anchor) return;
    const close = () => setAnchor(null);
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
    };
  }, [anchor]);

  useEffect(() => cancelClose, []);

  // Sem nome e sem email e uma acao do sistema: nao ha ninguem para mostrar (depois dos hooks)
  if (!label) return <>Sistema</>;

  const since = memberSince(person?.created_at ?? null);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="person-trigger"
        aria-haspopup="true"
        aria-expanded={anchor !== null}
        onMouseEnter={open}
        onMouseLeave={scheduleClose}
        onFocus={open}
        onBlur={scheduleClose}
        onClick={() => (anchor ? setAnchor(null) : open())}
      >
        {label}
      </button>

      {anchor &&
        createPortal(
          <div
            className="person-card"
            role="group"
            aria-label={`Detalhes de ${label}`}
            style={{ top: anchor.top, left: anchor.left, width: CARD_WIDTH }}
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
            onFocus={cancelClose}
            onBlur={scheduleClose}
          >
            <div className="person-card-head">
              <UserAvatar name={name ?? email ?? undefined} pictureUrl={person?.picture_url} large />
              <div className="person-card-id">
                <strong>{name ?? "Usuario removido"}</strong>
                {email && <span className="person-card-email">{email}</span>}
              </div>
            </div>

            {person ? (
              <>
                <div className="person-card-tags">
                  <span className="person-tag">{person.is_platform_admin ? "Administrador da plataforma" : "Usuario"}</span>
                  {person.login_provider === "google" && <span className="person-tag">Login pelo Google</span>}
                </div>
                <dl className="person-card-rows">
                  {person.groups.length > 0 && (
                    <div>
                      <dt>Grupos</dt>
                      <dd>{person.groups.join(", ")}</dd>
                    </div>
                  )}
                  {since && (
                    <div>
                      <dt>Membro desde</dt>
                      <dd>{since}</dd>
                    </div>
                  )}
                  <div>
                    <dt>Ultimo login</dt>
                    <dd>{person.last_login_at ? formatDateTime(person.last_login_at, timezone) : "Sem login registrado"}</dd>
                  </div>
                </dl>
                {onFilter && (
                  <button
                    type="button"
                    className="btn btn-ghost person-card-filter"
                    onClick={() => {
                      onFilter(person.id);
                      setAnchor(null);
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden="true">filter_alt</span>
                    Filtrar por esta pessoa
                  </button>
                )}
              </>
            ) : (
              <p className="person-card-note">Esta conta foi removida; so o email ficou registrado.</p>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
