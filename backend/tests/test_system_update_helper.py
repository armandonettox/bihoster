"""A atualizacao pelo container auxiliar: o comando certo para a pilha que esta rodando (nome do projeto, pasta e arquivos
do compose lidos dos rotulos do proprio container) e o que acontece quando o Docker recusa."""

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from app.core import system_update


def _info(**labels) -> dict:
    base = {
        "com.docker.compose.project": "bihoster",
        "com.docker.compose.project.working_dir": "/home/pessoa/bihoster",
        "com.docker.compose.project.config_files": (
            "/home/pessoa/bihoster/docker-compose.yml,/home/pessoa/bihoster/docker-compose.override.yml"
        ),
    }
    base.update(labels)
    return {
        "Id": "abc123def456",
        "Config": {"Image": "ghcr.io/armandonettox/bihoster-backend:1.33.0", "Labels": {k: v for k, v in base.items() if v is not None}},
    }


@pytest.fixture
def deploy(tmp_path, monkeypatch) -> Path:
    pasta = tmp_path / "deploy"
    pasta.mkdir()
    (pasta / "docker-compose.yml").write_text("services: {}\n")
    (pasta / "docker-compose.override.yml").write_text("services: {}\n")
    (pasta / ".env").write_text("APP_VERSION=1.33.0\n")
    monkeypatch.setenv("DEPLOY_DIR", str(pasta))
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    return pasta


def _comando(deploy: Path, info: dict | None = None) -> list[str] | None:
    return system_update.build_helper_command(
        info or _info(), "1.34.0", deploy.parent / "data" / "update_logs" / "x.log", deploy, "bihoster-updater-1"
    )


class TestComandoDoAuxiliar:
    def test_usa_a_mesma_imagem_e_os_mesmos_volumes_do_backend(self, deploy):
        comando = _comando(deploy)

        assert comando[:4] == ["docker", "run", "-d", "--rm"]
        assert comando[comando.index("--volumes-from") + 1] == "abc123def456"
        assert "ghcr.io/armandonettox/bihoster-backend:1.33.0" in comando
        assert comando[comando.index("--user") + 1] == "root"
        assert comando[comando.index("--entrypoint") + 1] == "sh"
        assert comando[comando.index("--name") + 1] == "bihoster-updater-1"

    def test_a_versao_alvo_vai_no_ambiente_e_vence_o_env_do_projeto(self, deploy):
        comando = _comando(deploy)

        assert comando[comando.index("-e") + 1] == "APP_VERSION=1.34.0"

    def test_o_compose_usa_o_projeto_a_pasta_e_os_dois_arquivos_da_pilha_que_roda(self, deploy):
        script = _comando(deploy)[-1]

        assert "-p bihoster " in script
        assert "--project-directory /home/pessoa/bihoster" in script
        assert f"--env-file {deploy.as_posix()}/.env" in script
        assert f"-f {deploy.as_posix()}/docker-compose.yml" in script
        # O override (portas so em 127.0.0.1, limites de memoria) faz parte da pilha: sem ele a pilha mudaria
        assert f"-f {deploy.as_posix()}/docker-compose.override.yml" in script

    def test_baixa_as_imagens_antes_de_recriar_e_grava_o_log(self, deploy):
        script = _comando(deploy)[-1]

        assert script.index(" pull ") < script.index(" up -d")
        assert " && " in script
        assert script.count(">> ") == 2
        assert "x.log" in script

    def test_sem_arquivo_env_nao_passa_env_file(self, deploy):
        (deploy / ".env").unlink()

        assert "--env-file" not in _comando(deploy)[-1]

    @pytest.mark.parametrize(
        "faltando",
        ["com.docker.compose.project", "com.docker.compose.project.working_dir", "com.docker.compose.project.config_files"],
    )
    def test_sem_os_rotulos_do_compose_nao_monta_o_comando(self, deploy, faltando):
        assert _comando(deploy, _info(**{faltando: None})) is None

    def test_sem_imagem_ou_id_nao_monta_o_comando(self, deploy):
        sem_imagem = _info()
        sem_imagem["Config"]["Image"] = None
        sem_id = _info()
        del sem_id["Id"]

        assert _comando(deploy, sem_imagem) is None
        assert _comando(deploy, sem_id) is None

    def test_arquivo_do_compose_que_nao_esta_montado_nao_monta_o_comando(self, deploy):
        (deploy / "docker-compose.override.yml").unlink()

        assert _comando(deploy) is None

    def test_caminho_do_windows_nos_rotulos_tambem_acha_o_arquivo(self, deploy):
        info = _info(**{"com.docker.compose.project.config_files": "C:\\proj\\docker-compose.yml"})

        assert f"-f {deploy.as_posix()}/docker-compose.yml" in _comando(deploy, info)[-1]

    def test_valores_com_espaco_ou_aspas_saem_protegidos(self, deploy):
        info = _info(**{"com.docker.compose.project.working_dir": "/home/pessoa/meu projeto; rm -rf x"})
        script = _comando(deploy, info)[-1]

        assert "'/home/pessoa/meu projeto; rm -rf x'" in script


class TestInspecaoDeSiMesmo:
    def test_sem_nome_de_host_nao_da_para_saber(self, monkeypatch):
        monkeypatch.delenv("HOSTNAME", raising=False)

        assert system_update._inspect_self() is None

    def test_docker_ausente_devolve_nada(self, monkeypatch):
        monkeypatch.setenv("HOSTNAME", "abc")
        with patch.object(system_update.subprocess, "run", side_effect=FileNotFoundError("docker")):
            assert system_update._inspect_self() is None

    def test_docker_que_recusa_devolve_nada(self, monkeypatch):
        monkeypatch.setenv("HOSTNAME", "abc")
        with patch.object(system_update.subprocess, "run", return_value=MagicMock(returncode=1, stdout="")):
            assert system_update._inspect_self() is None

    def test_resposta_que_nao_e_json_devolve_nada(self, monkeypatch):
        monkeypatch.setenv("HOSTNAME", "abc")
        with patch.object(system_update.subprocess, "run", return_value=MagicMock(returncode=0, stdout="isso nao e json")):
            assert system_update._inspect_self() is None

    def test_devolve_o_primeiro_item(self, monkeypatch):
        monkeypatch.setenv("HOSTNAME", "abc")
        saida = json.dumps([_info()])
        with patch.object(system_update.subprocess, "run", return_value=MagicMock(returncode=0, stdout=saida)) as run:
            info = system_update._inspect_self()

        assert info["Id"] == "abc123def456"
        assert run.call_args.args[0] == ["docker", "inspect", "abc"]


class TestApplyComAuxiliar:
    def test_dispara_o_auxiliar_e_nao_roda_o_compose_daqui(self, deploy):
        with patch.object(system_update, "_inspect_self", return_value=_info()), patch.object(
            system_update.subprocess, "run", return_value=MagicMock(returncode=0, stdout="f00dbabe1234\n", stderr="")
        ) as run, patch.object(system_update.subprocess, "Popen") as popen:
            log_path = system_update.apply_update("1.34.0")

        assert popen.call_count == 0
        comando = run.call_args.args[0]
        assert comando[:3] == ["docker", "run", "-d"]
        assert comando[comando.index("-e") + 1] == "APP_VERSION=1.34.0"
        texto = log_path.read_text()
        assert "Atualizando para v1.34.0" in texto
        assert "Container auxiliar iniciado: f00dbabe1234" in texto

    def test_docker_que_recusa_avisa_o_motivo_e_libera_a_trava(self, deploy):
        recusa = MagicMock(returncode=125, stdout="", stderr="Error response from daemon: pull access denied")
        with patch.object(system_update, "_inspect_self", return_value=_info()), patch.object(
            system_update.subprocess, "run", return_value=recusa
        ):
            with pytest.raises(system_update.UpdateCouldNotStart, match="pull access denied"):
                system_update.apply_update("1.34.0")

        # Nao ficou trava presa: uma nova tentativa passa
        ok = MagicMock(returncode=0, stdout="abc\n", stderr="")
        with patch.object(system_update, "_inspect_self", return_value=_info()), patch.object(
            system_update.subprocess, "run", return_value=ok
        ):
            system_update.apply_update("1.34.0")

    def test_docker_que_demora_demais_vira_erro_de_inicio(self, deploy):
        import subprocess

        with patch.object(system_update, "_inspect_self", return_value=_info()), patch.object(
            system_update.subprocess, "run", side_effect=subprocess.TimeoutExpired("docker", 60)
        ):
            with pytest.raises(system_update.UpdateCouldNotStart):
                system_update.apply_update("1.34.0")

    def test_segunda_atualizacao_com_a_primeira_rodando_e_recusada(self, deploy):
        ok = MagicMock(returncode=0, stdout="abc\n", stderr="")
        with patch.object(system_update, "_inspect_self", return_value=_info()), patch.object(
            system_update.subprocess, "run", return_value=ok
        ) as run:
            system_update.apply_update("1.34.0")
            with pytest.raises(system_update.UpdateAlreadyRunning):
                system_update.apply_update("1.34.0")

        assert run.call_count == 1

    def test_sem_os_rotulos_cai_no_jeito_antigo(self, deploy):
        with patch.object(system_update, "_inspect_self", return_value=None), patch.object(
            system_update.subprocess, "Popen"
        ) as popen:
            system_update.apply_update("1.34.0")

        assert popen.call_count == 1
        assert "pull" in popen.call_args.args[0][-1]


def test_rota_responde_500_com_o_motivo_quando_o_docker_recusa(client, monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setattr(system_update, "backup_database", lambda *args, **kwargs: None)
    client.post("/auth/register", json={"name": "Admin", "email": "admin@example.com", "password": "SenhaForte123"})
    token = client.post("/auth/login", json={"email": "admin@example.com", "password": "SenhaForte123"}).json()["access_token"]
    monkeypatch.setattr(system_update, "is_auto_update_enabled", lambda: True)
    monkeypatch.setattr(system_update.settings, "app_version", "1.0.0")
    novo = system_update.ReleaseInfo(version="1.5.0", name="v1.5.0", changelog="", published_at=None)

    with patch.object(system_update, "fetch_latest_release", return_value=novo), patch.object(
        system_update, "apply_update", side_effect=system_update.UpdateCouldNotStart("sem permissao no socket")
    ):
        resp = client.post("/system/version/apply", headers={"Authorization": f"Bearer {token}"})

    assert resp.status_code == 500
    assert "sem permissao no socket" in resp.json()["detail"]
