import { Link } from "react-router-dom";
import { useBranding } from "../context/BrandingContext";
import { assetUrl } from "../api/client";
import DefaultBrandLogo from "../components/DefaultBrandLogo";
import ErrorScreen from "../components/ErrorScreen";
import { errorScreenTexts } from "../utils/errorScreens";

export default function NotFound() {
  const { settings } = useBranding();
  const texts = errorScreenTexts("notFound", settings);
  return (
    <ErrorScreen
      logo={
        settings?.logo_url ? (
          <img src={assetUrl(settings.logo_url)} alt="Logo" className="error-page-logo" />
        ) : (
          <DefaultBrandLogo className="error-page-logo" />
        )
      }
      code="404"
      title={texts.title}
      message={texts.message}
      action={
        <Link to="/" className="btn btn-primary">
          {texts.button}
        </Link>
      }
    />
  );
}
