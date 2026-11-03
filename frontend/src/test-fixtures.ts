import type { Report } from "./api/reports";
import type { Workspace } from "./api/workspaces";

/** Relatorio de mentira, com os campos obrigatorios preenchidos. */
export function makeReport(id: number, extra: Partial<Report> = {}): Report {
  return {
    id,
    collection_id: 1,
    name: `Relatorio ${id}`,
    powerbi_connection_id: 1,
    pbi_workspace_id: "ws",
    pbi_report_id: "rp",
    pbi_dataset_id: null,
    pbi_page_name: null,
    pbi_page_names: [],
    display_type: "relatorio",
    show_filter_pane: false,
    show_page_nav: false,
    ...extra,
  };
}

/** Colecao de mentira, com permissao de administrador por padrao. */
export function makeWorkspace(extra: Partial<Workspace> = {}): Workspace {
  return {
    id: 1,
    name: "Colecao Teste",
    slug: "colecao-teste",
    description: null,
    icon: null,
    color: null,
    tv_interval_seconds: 15,
    role: "admin",
    ...extra,
  };
}

/** Promessa que o teste resolve ou rejeita na hora certa, pra simular resposta atrasada. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
