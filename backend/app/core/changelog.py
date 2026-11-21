"""Histórico de versões que vem junto com o sistema.

O texto fica em app/changelog/CHANGELOG.md e as imagens em app/changelog/img/. Os dois entram na imagem do Docker,
então o histórico sempre bate com a versão instalada e não depende do GitHub estar acessível.

Cada versão é uma seção `## 1.2.3 - 2026-01-31 - Título curto`, da mais recente para a mais antiga. O corpo é Markdown
simples (a tela entende listas, títulos, negrito, código, links e imagens)."""

import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Optional

CHANGELOG_DIR = Path(__file__).resolve().parent.parent / "changelog"
CHANGELOG_FILE = CHANGELOG_DIR / "CHANGELOG.md"
IMAGES_DIR = CHANGELOG_DIR / "img"

_HEADING = re.compile(r"^## (\d+\.\d+\.\d+) - (\d{4}-\d{2}-\d{2}) - (.+?)\s*$")
_COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)


@dataclass(frozen=True)
class ChangelogEntry:
    version: str
    date: str  # AAAA-MM-DD
    title: str
    body: str


def parse(text: str) -> list[ChangelogEntry]:
    """Lê o arquivo inteiro. Linhas antes da primeira versão (e comentários) são ignoradas; uma versão repetida vale só
    na primeira vez que aparece."""
    entries: list[ChangelogEntry] = []
    seen: set[str] = set()
    current: Optional[tuple[str, str, str]] = None
    lines: list[str] = []

    def close() -> None:
        if current and current[0] not in seen:
            seen.add(current[0])
            entries.append(ChangelogEntry(current[0], current[1], current[2], "\n".join(lines).strip()))

    for line in _COMMENT.sub("", text).splitlines():
        match = _HEADING.match(line)
        if match:
            close()
            current = (match.group(1), match.group(2), match.group(3))
            lines = []
        elif current is not None:
            lines.append(line)
    close()
    return entries


@lru_cache(maxsize=1)
def load_entries() -> tuple[ChangelogEntry, ...]:
    """As versões do arquivo que veio na imagem. O arquivo não muda com o sistema rodando, então lê uma vez só."""
    try:
        return tuple(parse(CHANGELOG_FILE.read_text(encoding="utf-8")))
    except FileNotFoundError:
        return ()


def entry_for(version: str) -> Optional[ChangelogEntry]:
    return next((entry for entry in load_entries() if entry.version == version), None)
