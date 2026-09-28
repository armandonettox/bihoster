import type { ReactNode } from "react";
import { useBranding } from "../context/BrandingContext";
import { assetUrl } from "../api/client";

export default function AuthLayout({ children }: { children: ReactNode }) {
  const { settings } = useBranding();
  const isSplit = settings?.login_layout === "split";

  if (isSplit) {
    return (
      <div className="auth-split">
        <div className="auth-split-left">
          <div className="auth-card auth-card-flat">{children}</div>
        </div>
        <div
          className="auth-split-right"
          style={
            settings?.login_image_url
              ? { backgroundImage: `url(${assetUrl(settings.login_image_url)})` }
              : undefined
          }
        >
          {!settings?.login_image_url && <div className="auth-split-right-fallback" />}
        </div>
      </div>
    );
  }

  return (
    <div className="auth-screen">
      <div className="auth-card card card-elevated">{children}</div>
    </div>
  );
}
