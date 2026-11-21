"""Histórico de versões que acompanha o sistema: leitura do arquivo, o arquivo de verdade bem formado, as imagens e a
consulta da versão mais nova pelas tags do GitHub (e não pelas Releases, que ficaram para trás)."""

import re
from unittest.mock import MagicMock, patch

import pytest

from app.core import changelog, system_update


@pytest.fixture(autouse=True)
def _limpa_cache():
    system_update.clear_release_cache()
    yield
    system_update.clear_release_cache()


def _headers(client) -> dict:
    client.post("/auth/register", json={"name": "Admin", "email": "admin@example.com", "password": "SenhaForte123"})
    token = client.post("/auth/login", json={"email": "admin@example.com", "password": "SenhaForte123"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _resposta(payload, status: int = 200):
    resp = MagicMock()
    resp.status_code = status
    resp.json.return_value = payload
    resp.raise_for_status.return_value = None
    return resp


class TestLeitura:
    def test_le_versao_data_titulo_e_corpo(self):
        entries = changelog.parse(
            "## 1.2.0 - 2026-02-01 - Segunda\n- um\n- dois\n\n## 1.1.0 - 2026-01-01 - Primeira\nTexto."
        )

        assert [(e.version, e.date, e.title) for e in entries] == [
            ("1.2.0", "2026-02-01", "Segunda"),
            ("1.1.0", "2026-01-01", "Primeira"),
        ]
        assert entries[0].body == "- um\n- dois"
        assert entries[1].body == "Texto."

    def test_ignora_comentario_e_o_que_vem_antes_da_primeira_versao(self):
        entries = changelog.parse("Introdução solta\n<!--\n## 9.9.9 - 2026-01-01 - Dentro do comentário\n-->\n## 1.0.0 - 2026-01-01 - Real\nCorpo")

        assert [e.version for e in entries] == ["1.0.0"]

    def test_versao_repetida_vale_so_a_primeira(self):
        entries = changelog.parse("## 1.0.0 - 2026-01-01 - A\nprimeira\n## 1.0.0 - 2026-01-02 - B\nsegunda")

        assert len(entries) == 1
        assert entries[0].title == "A"

    def test_titulo_fora_do_formato_nao_vira_versao(self):
        assert changelog.parse("## versão nova\ncorpo\n## 1.0 - 2026-01-01 - curta\ncorpo") == []


class TestArquivoDeVerdade:
    entries = changelog.parse(changelog.CHANGELOG_FILE.read_text(encoding="utf-8"))

    def test_tem_versoes(self):
        assert len(self.entries) > 0

    def test_nenhuma_versao_repetida(self):
        versions = [e.version for e in self.entries]
        assert len(versions) == len(set(versions))

    def test_da_mais_recente_para_a_mais_antiga(self):
        keys = [system_update._parse_version(e.version) for e in self.entries]
        assert keys == sorted(keys, reverse=True)

    def test_datas_nao_voltam_no_tempo(self):
        # Da mais recente para a mais antiga a data nunca aumenta
        dates = [e.date for e in self.entries]
        assert dates == sorted(dates, reverse=True)

    def test_toda_versao_tem_titulo_e_texto(self):
        for entry in self.entries:
            assert entry.title.strip(), entry.version
            assert entry.body.strip(), entry.version

    def test_toda_imagem_citada_existe(self):
        for entry in self.entries:
            for name in re.findall(r"!\[[^\]]*\]\(img/([^)\s]+)\)", entry.body):
                assert (changelog.IMAGES_DIR / name).is_file(), f"{entry.version}: falta img/{name}"

    def test_o_historico_chega_ate_a_primeira_versao(self):
        assert self.entries[-1].version == "1.0.0"


class TestRotas:
    def test_historico_vem_do_sistema_sem_consultar_o_github(self, client, monkeypatch):
        headers = _headers(client)
        monkeypatch.setattr(system_update.settings, "app_version", "1.0.0")

        with patch.object(system_update.httpx, "get", side_effect=AssertionError("nao deve ir ao GitHub")):
            resp = client.get("/system/version/history", headers=headers)

        assert resp.status_code == 200
        body = resp.json()
        assert len(body) == len(changelog.load_entries())
        assert body[0]["version"] == changelog.load_entries()[0].version
        assert {"version", "name", "changelog", "published_at", "is_current"} <= set(body[0])
        assert [r["version"] for r in body if r["is_current"]] == ["1.0.0"]

    def test_historico_exige_a_permissao_de_versao(self, client):
        assert client.get("/system/version/history").status_code == 401

    def test_verificar_agora_ignora_o_cache(self, client, monkeypatch):
        headers = _headers(client)
        monkeypatch.setattr(system_update.settings, "app_version", "1.0.0")
        release = system_update.ReleaseInfo(version="1.5.0", name="v1.5.0", changelog="", published_at=None)

        with patch.object(system_update, "fetch_latest_release", return_value=release) as fetch:
            client.get("/system/version", headers=headers)
            client.get("/system/version?refresh=true", headers=headers)

        assert [call.kwargs.get("force") for call in fetch.call_args_list] == [False, True]

    def test_imagem_do_historico_e_servida_pelo_sistema(self, client):
        arquivo = changelog.IMAGES_DIR / "teste-servir.png"
        arquivo.write_bytes(b"\x89PNG\r\n\x1a\n" + b"0" * 16)
        try:
            resp = client.get("/static/changelog/teste-servir.png")
        finally:
            arquivo.unlink(missing_ok=True)

        assert resp.status_code == 200
        assert resp.headers["content-type"] == "image/png"

    def test_imagem_inexistente_da_404(self, client):
        assert client.get("/static/changelog/nao-existe.png").status_code == 404


class TestVersaoMaisNova:
    def _github(self, tags, release=None, release_status=200):
        def fake_get(url, **kwargs):
            if url.endswith("/tags"):
                return _resposta([{"name": tag} for tag in tags])
            return _resposta(release or {}, status=release_status)

        return fake_get

    def test_escolhe_a_maior_versao_e_nao_a_ultima_da_lista(self):
        tags = ["v1.9.0", "v1.32.0", "v1.10.0", "v1.7.5"]
        release = {"tag_name": "v1.32.0", "name": "v1.32.0", "body": "notas", "published_at": "2026-11-21T00:00:00Z"}

        with patch.object(system_update.httpx, "get", side_effect=self._github(tags, release)):
            latest = system_update.fetch_latest_release()

        assert latest.version == "1.32.0"
        assert latest.changelog == "notas"

    def test_ignora_tag_que_nao_e_versao(self):
        tags = ["v2.0.0-beta", "latest", "v1.4.0", "teste"]

        with patch.object(system_update.httpx, "get", side_effect=self._github(tags, release_status=404)):
            latest = system_update.fetch_latest_release()

        assert latest.version == "1.4.0"

    def test_tag_sem_release_usa_as_notas_do_historico(self):
        with patch.object(system_update.httpx, "get", side_effect=self._github(["v1.0.0"], release_status=404)):
            latest = system_update.fetch_latest_release()

        assert latest.version == "1.0.0"
        assert latest.name == changelog.entry_for("1.0.0").title
        assert latest.changelog

    def test_tag_sem_release_e_fora_do_historico_so_tem_o_numero(self):
        with patch.object(system_update.httpx, "get", side_effect=self._github(["v99.0.0"], release_status=404)):
            latest = system_update.fetch_latest_release()

        assert (latest.version, latest.name, latest.changelog) == ("99.0.0", "v99.0.0", "")

    def test_sem_nenhuma_tag_de_versao_nao_ha_atualizacao(self):
        with patch.object(system_update.httpx, "get", side_effect=self._github(["latest"])):
            assert system_update.fetch_latest_release() is None

    def test_junta_as_paginas_de_tags(self):
        pagina1 = _resposta([{"name": f"v1.{n}.0"} for n in range(100)])
        pagina2 = _resposta([{"name": "v1.150.0"}])
        release = _resposta({"tag_name": "v1.150.0", "name": "x", "body": "", "published_at": None})

        with patch.object(system_update.httpx, "get", side_effect=[pagina1, pagina2, release]) as mocked:
            latest = system_update.fetch_latest_release()

        assert latest.version == "1.150.0"
        assert mocked.call_count == 3
