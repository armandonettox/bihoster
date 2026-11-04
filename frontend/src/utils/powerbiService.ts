import * as pbi from "powerbi-client";

let service: pbi.service.Service | null = null;

/** Um unico servico do SDK do Power BI para todos os embeds da pagina. Antes cada relatorio criava o
 * proprio, o que repetia a inicializacao e os ouvintes de mensagem do SDK a cada embed. */
export function getPowerBiService(): pbi.service.Service {
  if (!service) {
    service = new pbi.service.Service(
      pbi.factories.hpmFactory,
      pbi.factories.wpmpFactory,
      pbi.factories.routerFactory,
    );
  }
  return service;
}

// Endereco generico do Power BI (nuvem comercial): serve so pra baixar os recursos estaticos do
// aplicativo, que sao os mesmos de qualquer relatorio.
const PRELOAD_URL = "https://app.powerbi.com/reportEmbed";
// Depois de carregar, o iframe de pre-carga ainda espera um pouco (os recursos do aplicativo chegam
// em seguida) e e removido; o limite garante que ele nunca fique na pagina.
const PRELOAD_LINGER_MS = 5000;
const PRELOAD_MAX_MS = 20000;

let preloaded = false;

/** Baixa antecipadamente os recursos do Power BI pro primeiro relatorio abrir mais rapido: eles ficam
 * no cache do navegador. O SDK so cria um iframe escondido (nenhum embed o reaproveita), entao ele e
 * removido logo que a pre-carga termina, pra nao ficar um aplicativo do Power BI vivo na memoria.
 * Roda uma vez por carregamento da pagina. Devolve true se iniciou a pre-carga. */
export function preloadPowerBi(): boolean {
  if (preloaded) return false;
  preloaded = true;
  try {
    const frame = getPowerBiService().preload({ type: "report", embedUrl: PRELOAD_URL });
    const remove = () => frame.remove();
    frame.addEventListener("preloaded", () => window.setTimeout(remove, PRELOAD_LINGER_MS));
    window.setTimeout(remove, PRELOAD_MAX_MS);
    return true;
  } catch {
    // Sem pre-carga o relatorio so abre um pouco mais devagar na primeira vez; nada mais muda.
    return false;
  }
}

/** A pre-carga ja foi iniciada nesta pagina? (a medicao registra isso junto com os tempos) */
export function isPreloadStarted(): boolean {
  return preloaded;
}

/** So para os testes: volta ao estado inicial do modulo. */
export function resetPowerBiServiceForTests(): void {
  service = null;
  preloaded = false;
}
