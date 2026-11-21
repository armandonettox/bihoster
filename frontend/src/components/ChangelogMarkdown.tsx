import type { ReactNode } from "react";
import { assetUrl } from "../api/client";

/** O texto de uma versão do histórico (Markdown simples): parágrafos, listas com "- ", títulos "### ", **negrito**,
 * `código`, links http(s) e imagens do próprio histórico (`![descrição](img/arquivo.png)`).
 *
 * Nada de HTML cru: o texto é sempre escapado pelo React. Imagem só vale se vier de `img/<arquivo>`, que o sistema serve
 * em /static/changelog; qualquer outro endereço de imagem vira só a descrição, sem carregar nada de fora. Link só vale
 * com http ou https. */

const SAFE_IMAGE = /^img\/([A-Za-z0-9][A-Za-z0-9._-]*)$/;
const SAFE_LINK = /^https?:\/\/[^\s<>"']+$/i;
// Um pedaço de texto com marcação: imagem, link, negrito ou código (o que vier primeiro)
const INLINE = /!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/;

function imageFor(alt: string, src: string, key: string): ReactNode {
  const match = SAFE_IMAGE.exec(src);
  if (!match) return alt || null;
  const url = assetUrl(`/static/changelog/${match[1]}`);
  return (
    <a key={key} className="changelog-image-link" href={url} target="_blank" rel="noopener noreferrer">
      <img className="changelog-image" src={url} alt={alt} loading="lazy" />
    </a>
  );
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let rest = text;
  let index = 0;
  while (rest) {
    const match = INLINE.exec(rest);
    if (!match) {
      nodes.push(rest);
      break;
    }
    if (match.index > 0) nodes.push(rest.slice(0, match.index));
    const key = `${keyPrefix}-${index++}`;
    if (match[2] !== undefined) {
      nodes.push(imageFor(match[1], match[2], key));
    } else if (match[4] !== undefined) {
      nodes.push(
        SAFE_LINK.test(match[4]) ? (
          <a key={key} href={match[4]} target="_blank" rel="noopener noreferrer">
            {match[3]}
          </a>
        ) : (
          match[3]
        ),
      );
    } else if (match[5] !== undefined) {
      nodes.push(<strong key={key}>{match[5]}</strong>);
    } else {
      nodes.push(<code key={key}>{match[6]}</code>);
    }
    rest = rest.slice(match.index + match[0].length);
  }
  return nodes;
}

export default function ChangelogMarkdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      const key = `p${blocks.length}`;
      blocks.push(<p key={key}>{renderInline(paragraph.join(" "), key)}</p>);
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list.length) {
      const key = `l${blocks.length}`;
      blocks.push(
        <ul key={key}>
          {list.map((item, i) => (
            <li key={i}>{renderInline(item, `${key}-${i}`)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushParagraph();
      flushList();
    } else if (line.startsWith("### ")) {
      flushParagraph();
      flushList();
      const key = `h${blocks.length}`;
      blocks.push(<h4 key={key}>{renderInline(line.slice(4), key)}</h4>);
    } else if (line.startsWith("- ")) {
      flushParagraph();
      list.push(line.slice(2));
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();

  return <div className="changelog">{blocks}</div>;
}
