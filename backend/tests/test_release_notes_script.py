"""O script da CI que monta o texto da Release do GitHub a partir do histórico de versões."""

import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / ".github" / "scripts" / "release_notes.py"

TEXTO = """<!-- comentário -->
## 1.2.0 - 2026-02-01 - Segunda
- um
![tela](img/tela.png)

## 1.1.0 - 2026-01-01 - Primeira
- antes
"""


@pytest.fixture(scope="module")
def release_notes():
    spec = importlib.util.spec_from_file_location("release_notes", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_pega_so_a_secao_da_versao_pedida(release_notes):
    title, body = release_notes.section_for(TEXTO, "1.2.0")

    assert title == "Segunda"
    assert "- um" in body
    assert "antes" not in body


def test_pega_a_ultima_secao_do_arquivo(release_notes):
    assert release_notes.section_for(TEXTO, "1.1.0") == ("Primeira", "- antes")


def test_versao_que_nao_esta_no_arquivo_devolve_nada(release_notes):
    assert release_notes.section_for(TEXTO, "9.9.9") is None


def test_imagem_do_historico_vira_endereco_do_repositorio_na_tag(release_notes):
    body = release_notes.with_absolute_images("![tela](img/tela.png)", "v1.2.0")

    assert body == (
        "![tela](https://raw.githubusercontent.com/armandonettox/bihoster/v1.2.0/backend/app/changelog/img/tela.png)"
    )


def test_o_historico_de_verdade_tem_a_versao_mais_nova(release_notes):
    text = release_notes.CHANGELOG.read_text(encoding="utf-8")

    assert release_notes.section_for(text, "1.0.0") is not None


def test_sem_a_versao_o_script_sai_com_erro(release_notes, capsys):
    assert release_notes.main(["release_notes.py", "9.9.9"]) == 1
    assert "nao esta em" in capsys.readouterr().err
