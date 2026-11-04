"""Info de atualizacao do dataset: ultima atualizacao concluida, status da tentativa mais recente e
proxima atualizacao agendada. A tabela "Atualizacoes" da colecao mostra os tres."""

from types import SimpleNamespace
from unittest.mock import patch

from app.core import powerbi as powerbi_core

CONEXAO = SimpleNamespace(id=1, tenant_id="t", client_id="c", client_secret="s")


def _info(history, schedule=None):
    with patch.object(powerbi_core, "get_refresh_history", return_value=history) as hist, patch.object(
        powerbi_core, "get_refresh_schedule", return_value=schedule
    ):
        resultado = powerbi_core.get_refresh_info(CONEXAO, "ws", "ds")
    return resultado, hist


def _entrada(status, fim):
    return {"status": status, "endTime": fim}


def test_ultima_concluida_e_status_concluida():
    resultado, _ = _info([_entrada("Completed", "2026-11-04T04:40:12Z")])

    assert resultado["last_refresh"] == "2026-11-04T04:40:12Z"
    assert resultado["last_status"] == "Completed"


def test_ultima_tentativa_falhou_mostra_a_falha_e_a_data_do_ultimo_sucesso():
    resultado, _ = _info(
        [_entrada("Failed", "2026-11-04T04:40:00Z"), _entrada("Completed", "2026-11-03T04:40:00Z")]
    )

    assert resultado["last_status"] == "Failed"
    assert resultado["last_refresh"] == "2026-11-03T04:40:00Z"


def test_atualizacao_em_andamento_nao_conta_como_ultima_concluida():
    resultado, _ = _info(
        [{"status": "Unknown", "endTime": None}, _entrada("Completed", "2026-11-03T04:40:00Z")]
    )

    assert resultado["last_status"] == "Unknown"
    assert resultado["last_refresh"] == "2026-11-03T04:40:00Z"


def test_sem_historico_fica_sem_data_e_sem_status():
    resultado, _ = _info([])

    assert resultado["last_refresh"] is None
    assert resultado["last_status"] is None


def test_pede_mais_de_uma_entrada_para_achar_o_ultimo_sucesso():
    _, hist = _info([_entrada("Completed", "2026-11-04T04:40:12Z")])

    assert hist.call_args.kwargs["top"] == 5


def test_historico_indisponivel_nao_derruba_e_a_proxima_continua_vindo():
    agendamento = {"enabled": True, "days": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"], "times": ["04:30"]}
    with patch.object(powerbi_core, "get_refresh_history", side_effect=powerbi_core.PowerBIError("indisponivel")), patch.object(
        powerbi_core, "get_refresh_schedule", return_value=agendamento
    ):
        resultado = powerbi_core.get_refresh_info(CONEXAO, "ws", "ds")

    assert resultado["last_refresh"] is None
    assert resultado["last_status"] is None
    assert resultado["next_refresh"] is not None
