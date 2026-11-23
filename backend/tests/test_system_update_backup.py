"""A copia do banco feita antes de atualizar: consistente, verificada, com limite de copias, e a atualizacao que NAO comeca
quando a copia falha."""

import sqlite3
from unittest.mock import patch

import pytest

from app.core import system_update


@pytest.fixture
def pastas(tmp_path, monkeypatch):
    """Tudo numa pasta temporaria: o volume de dados e a pasta do projeto montada."""
    dados = tmp_path / "data"
    projeto = tmp_path / "deploy"
    dados.mkdir()
    projeto.mkdir()
    monkeypatch.setenv("DATA_DIR", str(dados))
    monkeypatch.setenv("DEPLOY_DIR", str(projeto))
    return dados, projeto


def _banco(pasta, linhas: int = 3):
    caminho = pasta / "bihoster.db"
    con = sqlite3.connect(caminho)
    con.execute("create table pessoas (id integer primary key, nome text)")
    con.executemany("insert into pessoas (nome) values (?)", [(f"pessoa {n}",) for n in range(linhas)])
    con.commit()
    con.close()
    return caminho


class TestCopia:
    def test_copia_o_conteudo_do_banco(self, pastas):
        dados, _ = pastas
        origem = _banco(dados, linhas=5)

        copia = system_update.backup_database("1.2.0", "1.3.0", database_file=origem)

        con = sqlite3.connect(copia)
        assert con.execute("select count(*) from pessoas").fetchone()[0] == 5
        assert con.execute("pragma integrity_check").fetchone()[0] == "ok"
        con.close()

    def test_o_nome_diz_de_qual_versao_para_qual_e_fica_na_pasta_de_backups(self, pastas):
        dados, _ = pastas
        copia = system_update.backup_database("1.2.0", "1.3.0", database_file=_banco(dados))

        assert copia.parent == dados / "backups"
        assert copia.name.startswith("db-antes-v1.2.0-para-v1.3.0-")
        assert copia.name.endswith(".db")

    def test_nao_mexe_no_banco_de_origem(self, pastas):
        dados, _ = pastas
        origem = _banco(dados)
        antes = origem.read_bytes()

        system_update.backup_database("1.2.0", "1.3.0", database_file=origem)

        assert origem.read_bytes() == antes

    def test_copia_tambem_o_env_do_projeto_quando_a_pasta_esta_montada(self, pastas):
        dados, projeto = pastas
        (projeto / ".env").write_text("APP_VERSION=1.2.0\nSESSION_MAX_HOURS=0\n")

        copia = system_update.backup_database("1.2.0", "1.3.0", database_file=_banco(dados))

        env_copia = copia.parent / copia.name.replace("db-antes-", "env-antes-").removesuffix(".db")
        assert env_copia.read_text() == "APP_VERSION=1.2.0\nSESSION_MAX_HOURS=0\n"

    def test_sem_env_copia_so_o_banco(self, pastas):
        dados, _ = pastas
        copia = system_update.backup_database("1.2.0", "1.3.0", database_file=_banco(dados))

        assert [p.name for p in copia.parent.iterdir()] == [copia.name]

    def test_so_o_dono_le_as_copias(self, pastas):
        import os

        if os.name == "nt":
            pytest.skip("permissoes de arquivo do Linux")
        dados, projeto = pastas
        (projeto / ".env").write_text("X=1\n")
        copia = system_update.backup_database("1.2.0", "1.3.0", database_file=_banco(dados))

        assert oct(copia.stat().st_mode & 0o777) == "0o600"
        env_copia = next(p for p in copia.parent.iterdir() if p.name.startswith("env-antes-"))
        assert oct(env_copia.stat().st_mode & 0o777) == "0o600"


class TestLimiteDeCopias:
    def test_guarda_so_as_mais_novas_e_apaga_o_env_junto(self, pastas, monkeypatch):
        import os
        import time

        dados, projeto = pastas
        (projeto / ".env").write_text("X=1\n")
        monkeypatch.setattr(system_update, "MAX_UPDATE_BACKUPS", 2)
        origem = _banco(dados)
        pasta = dados / "backups"
        pasta.mkdir()
        # Quatro copias antigas, da mais velha para a mais nova, cada uma com o seu env
        for n in range(4):
            antiga = pasta / f"db-antes-v1.0.{n}-para-v1.0.{n + 1}-2026010{n}T000000Z.db"
            antiga.write_bytes(b"x")
            (pasta / f"env-antes-v1.0.{n}-para-v1.0.{n + 1}-2026010{n}T000000Z").write_text("x")
            instante = time.time() - 1000 + n
            os.utime(antiga, (instante, instante))

        nova = system_update.backup_database("1.0.4", "1.0.5", database_file=origem)

        restantes = sorted(p.name for p in pasta.glob("db-antes-*.db"))
        assert len(restantes) == 2
        assert nova.name in restantes
        assert "db-antes-v1.0.3-para-v1.0.4-20260103T000000Z.db" in restantes
        envs = sorted(p.name for p in pasta.glob("env-antes-*"))
        assert len(envs) == 2

    def test_nao_apaga_arquivos_que_nao_sao_copias_do_banco(self, pastas, monkeypatch):
        dados, _ = pastas
        monkeypatch.setattr(system_update, "MAX_UPDATE_BACKUPS", 1)
        pasta = dados / "backups"
        pasta.mkdir()
        (pasta / "meu-backup-manual.db").write_bytes(b"x")

        origem = _banco(dados)
        system_update.backup_database("1.0.0", "1.0.1", database_file=origem)
        system_update.backup_database("1.0.1", "1.0.2", database_file=origem)

        assert (pasta / "meu-backup-manual.db").exists()
        assert len(list(pasta.glob("db-antes-*.db"))) == 1


class TestFalhas:
    def test_arquivo_do_banco_que_nao_existe_avisa(self, pastas):
        dados, _ = pastas

        with pytest.raises(system_update.UpdateCouldNotStart, match="nao foi encontrado"):
            system_update.backup_database("1.0.0", "1.0.1", database_file=dados / "nao-existe.db")

    def test_arquivo_que_nao_e_banco_avisa_e_nao_deixa_copia_pela_metade(self, pastas):
        dados, _ = pastas
        estragado = dados / "bihoster.db"
        estragado.write_bytes(b"isto nao e um banco sqlite " * 50)

        with pytest.raises(system_update.UpdateCouldNotStart, match="copiar o banco"):
            system_update.backup_database("1.0.0", "1.0.1", database_file=estragado)

        assert list((dados / "backups").glob("db-antes-*.db")) == []

    def test_banco_em_memoria_nao_tem_o_que_copiar(self, pastas, monkeypatch):
        monkeypatch.setattr(system_update.settings, "database_url", "sqlite://")

        assert system_update.backup_database("1.0.0", "1.0.1") is None

    def test_banco_que_nao_e_sqlite_recusa(self, pastas, monkeypatch):
        monkeypatch.setattr(system_update.settings, "database_url", "postgresql://u:p@h/db")

        with pytest.raises(system_update.UpdateCouldNotStart, match="SQLite"):
            system_update.backup_database("1.0.0", "1.0.1")

    def test_usa_o_banco_configurado_quando_nenhum_e_passado(self, pastas, monkeypatch):
        dados, _ = pastas
        origem = _banco(dados)
        monkeypatch.setattr(system_update.settings, "database_url", f"sqlite:///{origem.as_posix()}")

        copia = system_update.backup_database("1.0.0", "1.0.1")

        assert copia.is_file()


class TestRota:
    @staticmethod
    def _admin(client):
        client.post("/auth/register", json={"name": "Admin", "email": "admin@example.com", "password": "SenhaForte123"})
        token = client.post("/auth/login", json={"email": "admin@example.com", "password": "SenhaForte123"}).json()["access_token"]
        return {"Authorization": f"Bearer {token}"}

    @staticmethod
    def _preparar(monkeypatch):
        monkeypatch.setattr(system_update, "is_auto_update_enabled", lambda: True)
        monkeypatch.setattr(system_update.settings, "app_version", "1.0.0")
        return system_update.ReleaseInfo(version="1.5.0", name="v1.5.0", changelog="", published_at=None)

    def test_copia_o_banco_antes_de_atualizar_e_conta_na_resposta(self, client, monkeypatch, pastas):
        dados, _ = pastas
        headers = self._admin(client)
        novo = self._preparar(monkeypatch)
        ordem = []
        copia = dados / "backups" / "db-antes-v1.0.0-para-v1.5.0-x.db"

        def copiar(de, para):
            ordem.append(("copia", de, para))
            return copia

        def atualizar(versao):
            ordem.append(("atualiza", versao))
            return dados / "update_logs" / "x.log"

        with patch.object(system_update, "fetch_latest_release", return_value=novo), patch.object(
            system_update, "backup_database", side_effect=copiar
        ), patch.object(system_update, "apply_update", side_effect=atualizar):
            resp = client.post("/system/version/apply", headers=headers)

        assert resp.status_code == 200
        assert ordem == [("copia", "1.0.0", "1.5.0"), ("atualiza", "1.5.0")]
        body = resp.json()
        assert body["backup_file"] == copia.name
        assert "banco foi copiado" in body["message"]

    def test_se_a_copia_falha_a_atualizacao_nao_comeca(self, client, monkeypatch, pastas):
        headers = self._admin(client)
        novo = self._preparar(monkeypatch)

        with patch.object(system_update, "fetch_latest_release", return_value=novo), patch.object(
            system_update, "backup_database", side_effect=system_update.UpdateCouldNotStart("disco cheio")
        ), patch.object(system_update, "apply_update") as atualizar:
            resp = client.post("/system/version/apply", headers=headers)

        assert resp.status_code == 500
        assert "disco cheio" in resp.json()["detail"]
        assert "nao foi iniciada" in resp.json()["detail"]
        atualizar.assert_not_called()

    def test_a_auditoria_guarda_o_nome_da_copia(self, client, monkeypatch, pastas):
        dados, _ = pastas
        headers = self._admin(client)
        novo = self._preparar(monkeypatch)
        copia = dados / "backups" / "db-antes-v1.0.0-para-v1.5.0-y.db"

        with patch.object(system_update, "fetch_latest_release", return_value=novo), patch.object(
            system_update, "backup_database", return_value=copia
        ), patch.object(system_update, "apply_update", return_value=dados / "x.log"):
            client.post("/system/version/apply", headers=headers)

        entradas = client.get("/audit", headers=headers).json()
        detalhes = [e["details"] for e in entradas if e["action"] == "apply_update"]
        assert any("db-antes-v1.0.0-para-v1.5.0-y.db" in (d or "") for d in detalhes)
