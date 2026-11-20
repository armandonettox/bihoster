"""Horario de acesso: faixas de dias e horas por grupo e por pessoa, e a queda da sessao fora do horario."""

from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.core import access_schedule as schedule
from app.models.access_schedule import AccessScheduleRange

PASSWORD = "SenhaForte123"

# Fuso padrao do sistema: America/Sao_Paulo (UTC-3). 2026-11-23 e uma segunda-feira.
SEGUNDA_10H = datetime(2026, 11, 23, 13, 0, tzinfo=timezone.utc)
SEGUNDA_20H = datetime(2026, 11, 23, 23, 0, tzinfo=timezone.utc)
SABADO_10H = datetime(2026, 11, 21, 13, 0, tzinfo=timezone.utc)
DOMINGO_02H = datetime(2026, 11, 22, 5, 0, tzinfo=timezone.utc)

SEG_A_SEX = {"days": [0, 1, 2, 3, 4], "start": "08:00", "end": "18:00"}
SABADO = {"days": [5], "start": "08:00", "end": "12:00"}


def faixa(days, start, end):
    return SimpleNamespace(days=",".join(map(str, days)), start_minute=start, end_minute=end)


def local(hora, minuto=0, dia=23):
    from zoneinfo import ZoneInfo

    return datetime(2026, 11, dia, hora, minuto, tzinfo=ZoneInfo("America/Sao_Paulo"))


class TestRegras:
    def test_dentro_e_fora_da_faixa(self):
        faixas = [faixa([0, 1, 2, 3, 4], 8 * 60, 18 * 60)]
        assert schedule.ranges_allow(faixas, local(8))
        assert schedule.ranges_allow(faixas, local(17, 59))
        assert not schedule.ranges_allow(faixas, local(18))
        assert not schedule.ranges_allow(faixas, local(7, 59))
        assert not schedule.ranges_allow(faixas, local(10, dia=21))  # sabado

    def test_faixa_que_vira_a_madrugada(self):
        faixas = [faixa([4], 22 * 60, 6 * 60)]  # sexta 22h ate sabado 6h
        assert schedule.ranges_allow(faixas, local(23, dia=20))
        assert schedule.ranges_allow(faixas, local(5, dia=21))
        assert not schedule.ranges_allow(faixas, local(6, dia=21))
        assert not schedule.ranges_allow(faixas, local(5, dia=20))

    def test_dia_inteiro(self):
        faixas = [faixa(range(7), 0, 1440)]
        assert schedule.ranges_allow(faixas, local(0))
        assert schedule.ranges_allow(faixas, local(23, 59, dia=21))

    def test_proxima_abertura(self):
        faixas = [faixa([0, 1, 2, 3, 4], 8 * 60, 18 * 60)]
        proxima = schedule.next_open(faixas, local(10, dia=21))  # sabado
        assert (proxima.day, proxima.hour, proxima.minute) == (23, 8, 0)  # segunda 08:00
        depois = schedule.next_open(faixas, local(20))  # segunda a noite
        assert (depois.day, depois.hour) == (24, 8)

    def test_texto_das_faixas(self):
        faixas = [faixa([0, 1, 2, 3, 4], 480, 720), faixa([0, 1, 2, 3, 4], 480, 720), faixa([5, 6], 480, 600), faixa(range(7), 0, 1440)]
        assert schedule.describe(faixas) == ["Seg a Sex, 08:00 às 12:00", "Sáb e Dom, 08:00 às 10:00", "Todos os dias, 00:00 às 24:00"]

    @pytest.mark.parametrize("texto,fim,esperado", [("08:00", False, 480), ("24:00", True, 1440), ("00:00", False, 0)])
    def test_horarios_validos(self, texto, fim, esperado):
        assert schedule.parse_clock(texto, is_end=fim) == esperado

    @pytest.mark.parametrize("texto,fim", [("24:00", False), ("00:00", True), ("25:00", True), ("8h", False), ("12:60", False), ("", False)])
    def test_horarios_invalidos(self, texto, fim):
        with pytest.raises(ValueError):
            schedule.parse_clock(texto, is_end=fim)


def _entrar(client, email):
    client.post("/auth/register", json={"name": email.split("@")[0], "email": email, "password": PASSWORD})
    resposta = client.post("/auth/login", json={"email": email, "password": PASSWORD})
    return {"Authorization": f"Bearer {resposta.json()['access_token']}"}


@pytest.fixture
def admin(client):
    return _entrar(client, "admin@example.com")


@pytest.fixture
def pessoa(client, admin):
    return _entrar(client, "pessoa@example.com")


def _id(client, headers, email):
    return next(u["id"] for u in client.get("/users/", headers=headers).json() if u["email"] == email)


@pytest.fixture
def pessoa_id(client, admin, pessoa):
    return _id(client, admin, "pessoa@example.com")


@pytest.fixture
def relogio(monkeypatch):
    def fixar(momento):
        monkeypatch.setattr(schedule, "_now", lambda: momento)

    return fixar


def _grupo(client, admin, nome="Comercial", com=("pessoa@example.com",), faixas=(SEG_A_SEX,)):
    grupo_id = client.post("/groups/", json={"name": nome}, headers=admin).json()["id"]
    for email in com:
        assert client.post(f"/groups/{grupo_id}/members", json={"email": email}, headers=admin).status_code == 201
    if faixas:
        assert client.put(f"/access-schedules/groups/{grupo_id}", json={"ranges": list(faixas)}, headers=admin).status_code == 200
    return grupo_id


def _acessa(client, headers):
    return client.get("/auth/me", headers=headers)


class TestQuedaDaSessao:
    def test_dentro_do_horario_usa_normal_e_fora_cai_na_hora(self, client, admin, pessoa, relogio):
        _grupo(client, admin)
        relogio(SEGUNDA_10H)
        assert _acessa(client, pessoa).status_code == 200

        relogio(SEGUNDA_20H)
        resposta = _acessa(client, pessoa)
        assert resposta.status_code == 403
        detalhe = resposta.json()["detail"]
        assert detalhe["code"] == "outside_hours"
        assert detalhe["windows"] == ["Seg a Sex, 08:00 às 18:00"]
        assert detalhe["timezone"] == "America/Sao_Paulo"
        assert detalhe["next_open"].startswith("2026-11-24T08:00:00")

    def test_volta_sozinha_quando_o_horario_abre(self, client, admin, pessoa, relogio):
        _grupo(client, admin)
        relogio(SABADO_10H)
        assert _acessa(client, pessoa).status_code == 403
        relogio(SEGUNDA_10H)
        assert _acessa(client, pessoa).status_code == 200

    def test_entrar_fora_do_horario_da_uma_sessao_que_so_serve_para_a_tela_de_aviso(self, client, admin, pessoa, relogio):
        _grupo(client, admin)
        relogio(SABADO_10H)
        resposta = client.post("/auth/login", json={"email": "pessoa@example.com", "password": PASSWORD})
        assert resposta.status_code == 200
        sessao = {"Authorization": f"Bearer {resposta.json()['access_token']}"}

        # Qualquer rota do sistema continua recusando, com o aviso de fora do horario...
        negada = client.get("/auth/me", headers=sessao)
        assert negada.status_code == 403 and negada.json()["detail"]["code"] == "outside_hours"
        assert client.get("/users/", headers=sessao).status_code == 403
        # ...e so as rotas de pedir mais tempo respondem
        assert client.get("/access-extensions/mine", headers=sessao).status_code == 200

    def test_administrador_nunca_e_limitado(self, client, admin, relogio):
        _grupo(client, admin, com=("admin@example.com",))
        relogio(SABADO_10H)
        assert _acessa(client, admin).status_code == 200

    def test_sem_faixa_nenhuma_nao_ha_limite(self, client, admin, pessoa, relogio):
        relogio(SABADO_10H)
        assert _acessa(client, pessoa).status_code == 200

    def test_grupo_sem_faixa_nao_anula_o_limite_de_outro_grupo(self, client, admin, pessoa, relogio):
        _grupo(client, admin)  # com limite
        _grupo(client, admin, nome="Livre", faixas=())  # sem faixa nenhuma, alem do grupo padrao
        relogio(SABADO_10H)
        assert _acessa(client, pessoa).status_code == 403

    def test_com_dois_grupos_vale_o_mais_permissivo(self, client, admin, pessoa, relogio):
        _grupo(client, admin)
        _grupo(client, admin, nome="Plantao", faixas=(SABADO,))
        relogio(SABADO_10H)
        assert _acessa(client, pessoa).status_code == 200
        relogio(SEGUNDA_20H)
        assert _acessa(client, pessoa).status_code == 403

    def test_excecao_individual_substitui_o_horario_do_grupo(self, client, admin, pessoa, pessoa_id, relogio):
        _grupo(client, admin)
        assert client.put(f"/access-schedules/users/{pessoa_id}", json={"ranges": [SABADO]}, headers=admin).status_code == 200

        relogio(SABADO_10H)
        assert _acessa(client, pessoa).status_code == 200  # a excecao liberou o sabado
        relogio(SEGUNDA_10H)
        assert _acessa(client, pessoa).status_code == 403  # e tirou a segunda do grupo

        client.put(f"/access-schedules/users/{pessoa_id}", json={"ranges": []}, headers=admin)  # volta a seguir o grupo
        assert _acessa(client, pessoa).status_code == 200

    def test_excecao_sem_limite_libera_tudo(self, client, admin, pessoa, pessoa_id, relogio):
        _grupo(client, admin)
        tudo = {"days": list(range(7)), "start": "00:00", "end": "24:00"}
        client.put(f"/access-schedules/users/{pessoa_id}", json={"ranges": [tudo]}, headers=admin)
        relogio(SABADO_10H)
        assert _acessa(client, pessoa).status_code == 200

    def test_faixa_pela_madrugada(self, client, admin, pessoa, relogio):
        _grupo(client, admin, faixas=({"days": [5], "start": "22:00", "end": "06:00"},))
        relogio(DOMINGO_02H)  # sabado 23:00 no horario local
        assert _acessa(client, pessoa).status_code == 200


class TestEditar:
    def test_grava_le_e_limpa(self, client, admin):
        grupo = _grupo(client, admin, com=(), faixas=())
        corpo = {"ranges": [SEG_A_SEX, SABADO]}
        saiu = client.put(f"/access-schedules/groups/{grupo}", json=corpo, headers=admin).json()
        assert saiu["ranges"] == corpo["ranges"]
        assert client.get(f"/access-schedules/groups/{grupo}", headers=admin).json()["ranges"] == corpo["ranges"]
        assert client.put(f"/access-schedules/groups/{grupo}", json={"ranges": []}, headers=admin).json()["ranges"] == []

    @pytest.mark.parametrize(
        "faixa_ruim",
        [
            {"days": [], "start": "08:00", "end": "18:00"},
            {"days": [7], "start": "08:00", "end": "18:00"},
            {"days": [1, 7], "start": "08:00", "end": "18:00"},
            {"days": [1], "start": "8h", "end": "18:00"},
            {"days": [1], "start": "08:00", "end": "08:00"},
            {"days": [1], "start": "24:00", "end": "18:00"},
        ],
    )
    def test_faixa_invalida_da_400(self, client, admin, faixa_ruim):
        grupo = _grupo(client, admin, com=(), faixas=())
        assert client.put(f"/access-schedules/groups/{grupo}", json={"ranges": [faixa_ruim]}, headers=admin).status_code == 400

    def test_dia_repetido_vale_uma_vez(self, client, admin):
        grupo = _grupo(client, admin, com=(), faixas=())
        saiu = client.put(f"/access-schedules/groups/{grupo}", json={"ranges": [{"days": [3, 1, 3], "start": "08:00", "end": "18:00"}]}, headers=admin)
        assert saiu.json()["ranges"][0]["days"] == [1, 3]

    def test_limite_de_faixas(self, client, admin):
        grupo = _grupo(client, admin, com=(), faixas=())
        assert client.put(f"/access-schedules/groups/{grupo}", json={"ranges": [SEG_A_SEX] * 21}, headers=admin).status_code == 422

    def test_grupo_administradores_nao_tem_horario(self, client, admin):
        admin_group = next(g["id"] for g in client.get("/groups/", headers=admin).json() if g["is_admin_group"])
        assert client.put(f"/access-schedules/groups/{admin_group}", json={"ranges": [SEG_A_SEX]}, headers=admin).status_code == 400

    def test_quem_so_edita_horario_nao_afrouxa_o_proprio_limite(self, client, admin, pessoa, pessoa_id, relogio):
        relogio(SEGUNDA_10H)  # dentro da faixa do grupo, senao o 403 de fora do horario esconderia a regra testada
        grupo = _grupo(client, admin)  # a pessoa esta no grupo
        client.put(
            f"/access/users/{pessoa_id}",
            json={"blocks": [{"workspace_id": None, "permissions": ["membros.horario"]}]},
            headers=admin,
        )
        assert client.put(f"/access-schedules/users/{pessoa_id}", json={"ranges": []}, headers=pessoa).status_code == 400
        assert client.put(f"/access-schedules/groups/{grupo}", json={"ranges": []}, headers=pessoa).status_code == 400
        # E de outro grupo, em que ela nao esta, pode
        outro = _grupo(client, admin, nome="Outro", com=(), faixas=())
        assert client.put(f"/access-schedules/groups/{outro}", json={"ranges": [SEG_A_SEX]}, headers=pessoa).status_code == 200

    def test_conta_de_administrador_so_outro_administrador_mexe(self, client, admin, pessoa, pessoa_id, relogio):
        relogio(SEGUNDA_10H)
        client.put(
            f"/access/users/{pessoa_id}",
            json={"blocks": [{"workspace_id": None, "permissions": ["membros.horario"]}]},
            headers=admin,
        )
        admin_id = _id(client, admin, "admin@example.com")
        assert client.put(f"/access-schedules/users/{admin_id}", json={"ranges": [SEG_A_SEX]}, headers=pessoa).status_code == 403

    def test_apagar_pessoa_e_grupo_leva_as_faixas(self, client, admin, pessoa_id, db_session):
        grupo = _grupo(client, admin, com=())
        client.put(f"/access-schedules/users/{pessoa_id}", json={"ranges": [SABADO]}, headers=admin)
        assert db_session.query(AccessScheduleRange).count() == 2

        assert client.delete(f"/groups/{grupo}", headers=admin).status_code in (200, 204)
        assert client.delete(f"/users/{pessoa_id}", headers=admin).status_code in (200, 204)
        assert db_session.query(AccessScheduleRange).count() == 0

    def test_registra_na_auditoria(self, client, admin, db_session):
        from app.models.audit_log import AuditLog

        grupo = _grupo(client, admin, com=(), faixas=())
        client.put(f"/access-schedules/groups/{grupo}", json={"ranges": [SEG_A_SEX]}, headers=admin)
        registro = db_session.query(AuditLog).filter(AuditLog.action == "set_group_schedule").order_by(AuditLog.id.desc()).first()
        assert "Seg a Sex, 08:00 às 18:00" in registro.details
