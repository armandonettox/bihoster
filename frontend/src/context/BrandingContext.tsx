import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import * as settingsApi from "../api/settings";
import type { AppSettings } from "../api/settings";
import { assetUrl } from "../api/client";

interface BrandingContextValue {
  settings: AppSettings | null;
  reload: () => Promise<void>;
}

const BrandingContext = createContext<BrandingContextValue | undefined>(undefined);

function applyFavicon(faviconUrl: string | null) {
  const href = faviconUrl ? assetUrl(faviconUrl) : "/favicon.svg";
  const existingLinks = document.querySelectorAll<HTMLLinkElement>("link[rel~='icon']");
  existingLinks.forEach((link) => link.remove());

  const link = document.createElement("link");
  link.rel = "icon";
  link.href = href;
  document.head.appendChild(link);
}

function applyToDocument(settings: AppSettings) {
  document.documentElement.style.setProperty("--color-primary", settings.primary_color);
  document.documentElement.style.setProperty("--color-secondary", settings.secondary_color);
  document.title = settings.company_name;
  applyFavicon(settings.favicon_url);
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);

  async function reload() {
    try {
      const data = await settingsApi.getSettings();
      setSettings(data);
      applyToDocument(data);
    } catch {
      // Se o backend nao estiver disponivel ainda, mantem a paleta padrao do CSS
    }
  }

  useEffect(() => {
    reload();
  }, []);

  return <BrandingContext.Provider value={{ settings, reload }}>{children}</BrandingContext.Provider>;
}

export function useBranding(): BrandingContextValue {
  const context = useContext(BrandingContext);
  if (!context) {
    throw new Error("useBranding precisa ser usado dentro de um BrandingProvider");
  }
  return context;
}
