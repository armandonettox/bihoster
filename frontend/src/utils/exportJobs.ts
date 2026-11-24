import { useSyncExternalStore } from "react";
import { extractErrorMessage } from "../api/client";

export type ExportJobState = "running" | "done" | "error";

export interface ExportJob {
  id: number;
  /** Nome do formato, ex.: "PDF" */
  label: string;
  message: string;
  /** 0 a 100 quando o Power BI informa; null quando ainda nao ha andamento (a barra anda sozinha) */
  progress: number | null;
  state: ExportJobState;
}

type ProgressUpdate = (patch: Partial<Pick<ExportJob, "message" | "progress">>) => void;

// Quanto tempo o aviso de "pronto" fica na tela antes de sumir sozinho
const DONE_VISIBLE_MS = 4000;

// As exportacoes moram aqui, fora de qualquer tela: a pessoa pode fechar a janela do Exportar (ou ate sair do
// relatorio) e o arquivo continua sendo gerado e baixado.
let jobs: ExportJob[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function setJobs(next: ExportJob[]) {
  jobs = next;
  listeners.forEach((listener) => listener());
}

function patchJob(id: number, patch: Partial<ExportJob>) {
  setJobs(jobs.map((job) => (job.id === id ? { ...job, ...patch } : job)));
}

export function dismissExportJob(id: number) {
  setJobs(jobs.filter((job) => job.id !== id));
}

/** Comeca uma exportacao em segundo plano e devolve na hora. `run` faz o trabalho e avisa o andamento por `update`;
 * ao terminar bem, o aviso some sozinho; se falhar, fica na tela com o motivo ate a pessoa fechar. */
export function startExportJob(label: string, run: (update: ProgressUpdate) => Promise<void>): number {
  const id = nextId++;
  setJobs([...jobs, { id, label, message: "Preparando a exportação...", progress: null, state: "running" }]);
  run((patch) => patchJob(id, patch)).then(
    () => {
      patchJob(id, { state: "done", message: "Pronto. O arquivo foi baixado.", progress: 100 });
      setTimeout(() => dismissExportJob(id), DONE_VISIBLE_MS);
    },
    (err: unknown) => {
      const message = extractErrorMessage(err) || (err instanceof Error && err.message) || "Nao foi possivel exportar.";
      patchJob(id, { state: "error", message, progress: null });
    },
  );
  return id;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useExportJobs(): ExportJob[] {
  return useSyncExternalStore(subscribe, () => jobs);
}

/** So para os testes: esvazia a lista entre um teste e outro */
export function resetExportJobs() {
  setJobs([]);
}
