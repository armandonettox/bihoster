import { useEffect, useState } from "react";
import DefaultBrandLogo from "./DefaultBrandLogo";

/** A logo da marca, ou a logo padrão do BIHoster quando não há logo enviada ou quando a imagem não carrega. Serve para as
 * telas que podem aparecer com algo quebrado (erro inesperado, fora do horário): se a logo da marca falhar, a tela
 * continua com um desenho. */
export default function BrandLogo({ logoUrl, className }: { logoUrl: string | null | undefined; className: string }) {
  const [failed, setFailed] = useState(false);

  // Uma logo nova (outro endereco) merece outra chance
  useEffect(() => {
    setFailed(false);
  }, [logoUrl]);

  if (!logoUrl || failed) return <DefaultBrandLogo className={className} />;
  return <img src={logoUrl} alt="Logo" className={className} onError={() => setFailed(true)} />;
}
