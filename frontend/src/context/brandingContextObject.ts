import { createContext } from "react";
import type { AppSettings } from "../api/settings";

export interface BrandingContextValue {
  settings: AppSettings | null;
  loaded: boolean;
  reload: () => Promise<void>;
}

/** O contexto fica num arquivo à parte para o ErrorBoundary poder lê-lo sem exigir o provedor (ele também roda fora
 * dele, e a tela de erro precisa conseguir aparecer mesmo assim). */
export const BrandingContext = createContext<BrandingContextValue | undefined>(undefined);
