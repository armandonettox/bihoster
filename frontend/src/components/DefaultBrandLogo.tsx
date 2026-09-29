import brandIcon from "../assets/brand/brand-icon.png";
import brandLogo from "../assets/brand/brand-logo.png";
import brandLogoDark from "../assets/brand/brand-logo-dark.png";

interface DefaultBrandLogoProps {
  /** "icon" so o cubo; "full" cubo + nome, com variante clara e escura conforme o tema. */
  variant?: "icon" | "full";
  className?: string;
}

/** Logo padrao do BIHoster, usada quando nenhuma logo foi enviada em Configuracoes > Marca. */
export default function DefaultBrandLogo({ variant = "full", className = "" }: DefaultBrandLogoProps) {
  if (variant === "icon") {
    return <img src={brandIcon} alt="BIHoster" className={className} />;
  }
  return (
    <>
      <img src={brandLogo} alt="BIHoster" className={`${className} brand-logo-light`} />
      <img src={brandLogoDark} alt="" aria-hidden="true" className={`${className} brand-logo-dark`} />
    </>
  );
}
