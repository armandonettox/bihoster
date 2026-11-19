import { useState } from "react";
import { assetUrl } from "../api/client";

interface Props {
  name?: string;
  pictureUrl?: string | null;
  large?: boolean;
  className?: string;
}

/** Foto da pessoa (guardada no servidor) ou, sem foto, as iniciais do nome. */
export default function UserAvatar({ name, pictureUrl, large = false, className = "" }: Props) {
  const [failed, setFailed] = useState(false);
  const sizeClass = (large ? " user-avatar-large" : "") + (className ? ` ${className}` : "");

  if (pictureUrl && !failed) {
    return (
      <img
        src={assetUrl(pictureUrl)}
        alt=""
        className={`user-avatar user-avatar-img${sizeClass}`}
        onError={() => setFailed(true)}
      />
    );
  }
  return <div className={`user-avatar${sizeClass}`}>{(name || "?").slice(0, 2).toUpperCase()}</div>;
}
