"""Monta o texto da Release do GitHub a partir do histórico de versões do sistema.

Uso: python release_notes.py <versao> [<tag>] [titulo] > saida

Lê backend/app/changelog/CHANGELOG.md, pega a seção da versão e escreve o corpo em Markdown na saída (ou só o título da
versão, se o terceiro argumento for "titulo"). As imagens do
histórico (`img/arquivo.png`) são trocadas pelo endereço delas no repositório, na tag da Release, porque o GitHub não
enxerga caminhos relativos ao arquivo. Se a versão não estiver no arquivo, sai com código 1 e a CI cai para as notas
automáticas do GitHub."""

import re
import sys
from pathlib import Path

CHANGELOG = Path(__file__).resolve().parents[2] / "backend" / "app" / "changelog" / "CHANGELOG.md"
REPO = "armandonettox/bihoster"
IMAGES_PATH = "backend/app/changelog/img"
_HEADING = re.compile(r"^## (\d+\.\d+\.\d+) - (\d{4}-\d{2}-\d{2}) - (.+?)\s*$")
_COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)
_IMAGE = re.compile(r"(!\[[^\]]*\]\()img/([^)\s]+)\)")


def section_for(text: str, version: str) -> tuple[str, str] | None:
    """(título, corpo) da versão pedida, ou None se ela não está no arquivo."""
    found = False
    title = ""
    lines: list[str] = []
    for line in _COMMENT.sub("", text).splitlines():
        match = _HEADING.match(line)
        if match:
            if found:
                break
            if match.group(1) == version:
                found, title = True, match.group(3)
            continue
        if found:
            lines.append(line)
    return (title, "\n".join(lines).strip()) if found else None


def with_absolute_images(body: str, tag: str) -> str:
    base = f"https://raw.githubusercontent.com/{REPO}/{tag}/{IMAGES_PATH}"
    return _IMAGE.sub(lambda m: f"{m.group(1)}{base}/{m.group(2)})", body)


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("uso: release_notes.py <versao> [<tag>] [titulo]", file=sys.stderr)
        return 2
    version = argv[1].lstrip("vV")
    tag = argv[2] if len(argv) > 2 else f"v{version}"
    section = section_for(CHANGELOG.read_text(encoding="utf-8"), version)
    if section is None:
        print(f"versao {version} nao esta em {CHANGELOG.name}", file=sys.stderr)
        return 1
    title, body = section
    # A saida sempre em UTF-8, mesmo num terminal que use outra codificacao
    sys.stdout.reconfigure(encoding="utf-8")
    print(title if len(argv) > 3 and argv[3] == "titulo" else with_absolute_images(body, tag))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
