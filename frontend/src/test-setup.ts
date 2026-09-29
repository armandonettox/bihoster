import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Sem `globals`, o Testing Library nao desmonta os componentes sozinho entre testes. Um hook que
// registra listener no document (ex: atalhos de teclado) continuaria vivo no teste seguinte e
// interceptaria eventos que nao sao dele.
afterEach(() => cleanup());
