import { useEffect, useId, useState } from "react";
import * as aiApi from "../api/aiSettings";
import { extractErrorMessage } from "../api/client";

const OTHER = "__outro__";
// Acima disso a lista suspensa fica comprida (o OpenRouter tem centenas), entao aparece um filtro
const FILTER_FROM = 15;

interface Props {
  provider: string;
  /** Sem chave salva nao ha como perguntar ao provedor quais modelos existem */
  keyConfigured: boolean;
  /** Placeholder do campo de texto, usado quando nao ha lista */
  example: string;
  value: string;
  onChange: (value: string) => void;
  /** Lista ja carregada deste provedor (guardada fora, para nao pedir de novo ao trocar de provedor) */
  models: string[] | undefined;
  onModelsLoaded: (provider: string, models: string[]) => void;
}

/** Escolha do modelo: lista suspensa com o que o provedor oferece para a chave salva. Sem chave, ou se
 * a consulta falhar, ou se o modelo desejado nao estiver na lista, cai para o campo de texto. */
export default function AiModelPicker({ provider, keyConfigured, example, value, onChange, models, onModelsLoaded }: Props) {
  const id = useId();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [filter, setFilter] = useState("");

  const hasModels = !!models;

  async function load() {
    setLoading(true);
    setError(null);
    try {
      onModelsLoaded(provider, await aiApi.listAIProviderModels(provider));
    } catch (err: any) {
      setError(extractErrorMessage(err) || "Nao foi possivel carregar a lista de modelos.");
    } finally {
      setLoading(false);
    }
  }

  // Carrega sozinho ao abrir o provedor com chave salva, e de novo quando a lista e descartada (chave trocada).
  // Falha nao entra em laco: o erro nao muda nenhuma das dependencias.
  useEffect(() => {
    if (!keyConfigured || hasModels) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    aiApi
      .listAIProviderModels(provider)
      .then((list) => {
        if (!cancelled) onModelsLoaded(provider, list);
      })
      .catch((err: any) => {
        if (!cancelled) setError(extractErrorMessage(err) || "Nao foi possivel carregar a lista de modelos.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, keyConfigured, hasModels]);

  const useList = keyConfigured && hasModels && !typing;
  const visible = (models ?? []).filter((name) => name.toLowerCase().includes(filter.trim().toLowerCase()));
  // O modelo escolhido nunca some da lista, mesmo que o filtro o esconda ou o provedor nao o liste mais
  const options = value && !visible.includes(value) ? [value, ...visible] : visible;

  return (
    <div className="field">
      <label htmlFor={id}>Modelo</label>

      {useList ? (
        <>
          {(models?.length ?? 0) > FILTER_FROM && (
            <input
              className="input"
              aria-label="Filtrar modelos"
              placeholder="Filtrar modelos"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{ marginBottom: 6 }}
            />
          )}
          <select
            id={id}
            className="input"
            value={value}
            onChange={(e) => (e.target.value === OTHER ? setTyping(true) : onChange(e.target.value))}
          >
            <option value="">Escolha um modelo</option>
            {options.map((name) => (
              <option key={name} value={name}>
                {models?.includes(name) ? name : `${name} (salvo, fora da lista)`}
              </option>
            ))}
            <option value={OTHER}>Outro (digitar o nome)</option>
          </select>
        </>
      ) : (
        <input id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)} placeholder={`Ex.: ${example}`} />
      )}

      <div className="settings-section-desc" style={{ margin: "6px 0 0" }}>
        {!keyConfigured && <span>Salve a chave para carregar a lista de modelos do provedor.</span>}
        {keyConfigured && loading && <span>Carregando modelos...</span>}
        {keyConfigured && !loading && error && (
          <span>
            <span className="auth-error">{error}</span> Digite o nome do modelo.{" "}
            <button type="button" className="btn btn-ghost" onClick={load}>
              Tentar de novo
            </button>
          </span>
        )}
        {keyConfigured && !loading && !error && hasModels && (
          <span>
            {models!.length === 1 ? "1 modelo disponivel." : `${models!.length} modelos disponiveis.`}{" "}
            <button type="button" className="btn btn-ghost" onClick={load}>
              Atualizar lista
            </button>
            {typing && (
              <button type="button" className="btn btn-ghost" onClick={() => setTyping(false)}>
                Voltar para a lista
              </button>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
