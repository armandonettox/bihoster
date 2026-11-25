import { useEffect, useState } from "react";
import * as capacityApi from "../../api/cacheCapacity";
import type { CapacityConnection, CapacityRange } from "../../api/cacheCapacity";
import { extractErrorMessage } from "../../api/client";
import { useToast } from "../../context/ToastContext";
import { formatDateTime } from "../../utils/datetime";

const DAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const WORKDAYS: CapacityRange = { days: [0, 1, 2, 3, 4], start: "08:00", end: "18:00" };

function stateText(connection: CapacityConnection): string {
  if (!connection.state) return "sem registro";
  const text = connection.state === "running" ? "ligada" : "pausada";
  return connection.state_at ? `${text} desde ${formatDateTime(connection.state_at)}` : text;
}

function ConnectionCard({ connection, masterSwitch, onChanged }: { connection: CapacityConnection; masterSwitch: boolean; onChanged: (updated: CapacityConnection) => void }) {
  const { showToast } = useToast();
  const [subscription, setSubscription] = useState(connection.azure_subscription_id ?? "");
  const [group, setGroup] = useState(connection.azure_resource_group ?? "");
  const [name, setName] = useState(connection.azure_capacity_name ?? "");
  const [real, setReal] = useState(!connection.simulated);
  const [scheduleOn, setScheduleOn] = useState(connection.capacity_schedule_enabled);
  const [range, setRange] = useState<CapacityRange>(connection.schedule[0] ?? WORKDAYS);
  const [busy, setBusy] = useState(false);
  const [confirmReal, setConfirmReal] = useState(false);

  function toggleDay(day: number) {
    setRange((current) => ({ ...current, days: current.days.includes(day) ? current.days.filter((d) => d !== day) : [...current.days, day].sort() }));
  }

  async function save() {
    setBusy(true);
    try {
      const updated = await capacityApi.saveCapacity(connection.connection_id, {
        azure_subscription_id: subscription.trim() || null,
        azure_resource_group: group.trim() || null,
        azure_capacity_name: name.trim() || null,
        capacity_real_calls: real ? true : null,
        capacity_schedule_enabled: scheduleOn,
        schedule: scheduleOn || connection.schedule.length > 0 ? [range] : [],
      });
      onChanged(updated);
      showToast("Capacidade salva. Nada é ligado só por salvar.");
    } catch (err) {
      showToast(extractErrorMessage(err) || "Não foi possível salvar.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function act(action: "suspend" | "resume") {
    setBusy(true);
    try {
      const updated = await capacityApi.capacityAction(connection.connection_id, action);
      onChanged(updated);
      const verb = action === "suspend" ? "Pausa" : "Retomada";
      showToast(updated.mode === "simulated" ? `${verb} simulada (nada foi enviado ao Azure).` : `${verb} enviada ao Azure.`);
    } catch (err) {
      showToast(extractErrorMessage(err) || "Não foi possível executar.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" style={{ padding: 16, marginBottom: 12 }} aria-label={`Capacidade da conta ${connection.name}`}>
      <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>{connection.name}</h3>
      <p className="field-hint" style={{ marginTop: 0 }}>
        Estado: <strong>{stateText(connection)}</strong> · {connection.simulated ? "modo simulado" : "modo real"}
      </p>

      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        <label>
          <span className="field-hint">Assinatura (ID)</span>
          <input className="input" aria-label={`Assinatura do Azure de ${connection.name}`} value={subscription} onChange={(e) => setSubscription(e.target.value)} />
        </label>
        <label>
          <span className="field-hint">Grupo de recursos</span>
          <input className="input" aria-label={`Grupo de recursos de ${connection.name}`} value={group} onChange={(e) => setGroup(e.target.value)} />
        </label>
        <label>
          <span className="field-hint">Nome da capacidade</span>
          <input className="input" aria-label={`Nome da capacidade de ${connection.name}`} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
      </div>

      <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
        <input
          type="checkbox"
          checked={real}
          onChange={(e) => (e.target.checked ? setConfirmReal(true) : setReal(false))}
        />
        <span>Chamar o Azure de verdade (desmarcado = modo simulado, só registra)</span>
      </label>
      {confirmReal && (
        <div className="auth-error" role="alert" style={{ marginTop: 8 }}>
          Em modo real, pausar derruba a capacidade e os relatórios dela deixam de abrir. Confirma?{" "}
          <button type="button" className="btn btn-sm btn-danger" onClick={() => { setReal(true); setConfirmReal(false); }}>Sim, usar o Azure</button>{" "}
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirmReal(false)}>Cancelar</button>
        </div>
      )}

      <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
        <input type="checkbox" checked={scheduleOn} onChange={(e) => setScheduleOn(e.target.checked)} />
        <span>Seguir uma agenda: ligada nos dias e horas abaixo, pausada fora deles</span>
      </label>
      {scheduleOn && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 8 }} role="group" aria-label="Agenda da capacidade">
          {DAYS.map((label, day) => (
            <label key={label} style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <input type="checkbox" checked={range.days.includes(day)} onChange={() => toggleDay(day)} aria-label={`Ligada ${label}`} />
              {label}
            </label>
          ))}
          <input className="input" type="time" aria-label="Liga às" value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} style={{ maxWidth: 120 }} />
          <span>até</span>
          <input className="input" type="time" aria-label="Pausa às" value={range.end === "24:00" ? "23:59" : range.end} onChange={(e) => setRange({ ...range, end: e.target.value })} style={{ maxWidth: 120 }} />
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void save()}>Salvar</button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy || !masterSwitch || !connection.configured} onClick={() => void act("suspend")}>Pausar agora</button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy || !masterSwitch || !connection.configured} onClick={() => void act("resume")}>Retomar agora</button>
      </div>
      {(!masterSwitch || !connection.configured) && (
        <p className="field-hint" style={{ marginBottom: 0 }}>
          {!masterSwitch ? "Ligue a chave geral acima para usar os botões e a agenda." : "Preencha os três campos do Azure para usar os botões e a agenda."}
        </p>
      )}
    </section>
  );
}

/** A capacidade do Power BI: chave geral (desligada por padrão) e, por conta, os campos do Azure, o modo e a agenda. */
export default function CapacityBody({ masterSwitch, onMasterChange }: { masterSwitch: boolean; onMasterChange: (value: boolean) => Promise<void> }) {
  const [connections, setConnections] = useState<CapacityConnection[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    capacityApi.getCapacity().then((overview) => setConnections(overview.connections)).catch(() => setLoadError(true));
  }, []);

  return (
    <>
      <p className="field-hint" style={{ marginTop: 0 }}>
        Pausar a capacidade economiza quando ninguém usa, mas derruba os relatórios dela. Tudo vem desligado: precisa da chave geral, dos campos do
        Azure da conta e, para falar com o Azure de verdade, do modo real. Sem o modo real, só se registra o que seria feito.
      </p>
      <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
        <input type="checkbox" checked={masterSwitch} onChange={(e) => void onMasterChange(e.target.checked)} />
        <strong>Permitir controle da capacidade</strong>
      </label>
      {loadError && <p className="auth-error" role="alert">Não foi possível carregar as contas.</p>}
      {connections === null && !loadError && <p className="field-hint">Carregando...</p>}
      {connections?.length === 0 && <p className="field-hint">Nenhuma conta do Power BI cadastrada.</p>}
      {connections?.map((connection) => (
        <ConnectionCard
          key={connection.connection_id}
          connection={connection}
          masterSwitch={masterSwitch}
          onChanged={(updated) => setConnections((list) => (list ?? []).map((c) => (c.connection_id === updated.connection_id ? updated : c)))}
        />
      ))}
    </>
  );
}
