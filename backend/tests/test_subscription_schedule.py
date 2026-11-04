"""Regra de horarios das assinaturas. Sao funcoes puras: o instante de referencia e sempre passado."""

from datetime import date, datetime, timezone

import pytest

from app.core import subscription_schedule as sched
from app.core.subscription_schedule import ScheduleError

SP = "America/Sao_Paulo"  # UTC-3, sem horario de verao desde 2019


def utc(ano, mes, dia, hora=0, minuto=0):
    return datetime(ano, mes, dia, hora, minuto, tzinfo=timezone.utc)


# 2026-11-02 e uma segunda-feira, 2026-11-04 e quarta, 2026-11-08 e domingo
SEGUNDA, TERCA, QUARTA, QUINTA, SEXTA, SABADO, DOMINGO = range(7)


class TestProximoHorario:
    def test_ainda_ha_horario_hoje(self):
        # Quarta 10:00 no Brasil (13:00 UTC); a assinatura e as 17:30 -> hoje mesmo, 20:30 UTC
        proximo = sched.next_run_after([QUARTA], ["17:30"], SP, utc(2026, 11, 4, 13, 0))

        assert proximo == utc(2026, 11, 4, 20, 30)

    def test_depois_do_ultimo_horario_do_dia_vai_para_o_proximo_dia_marcado(self):
        # Quarta 18:00 no Brasil, passou das 17:30: a proxima quarta e na semana seguinte
        proximo = sched.next_run_after([QUARTA], ["17:30"], SP, utc(2026, 11, 4, 21, 0))

        assert proximo == utc(2026, 11, 11, 20, 30)

    def test_varios_horarios_no_mesmo_dia_pega_o_seguinte(self):
        manha, tarde = "08:00", "17:30"
        depois_das_8 = utc(2026, 11, 4, 12, 0)  # 09:00 no Brasil

        assert sched.next_run_after([QUARTA], [manha, tarde], SP, depois_das_8) == utc(2026, 11, 4, 20, 30)

    def test_horarios_fora_de_ordem_dao_o_mesmo_resultado(self):
        a = sched.next_run_after([QUARTA], ["17:30", "08:00"], SP, utc(2026, 11, 4, 5, 0))
        b = sched.next_run_after([QUARTA], ["08:00", "17:30"], SP, utc(2026, 11, 4, 5, 0))

        assert a == b == utc(2026, 11, 4, 11, 0)

    def test_pula_os_dias_nao_marcados(self):
        # Segunda e sexta; estando na terca o proximo e a sexta
        proximo = sched.next_run_after([SEGUNDA, SEXTA], ["08:00"], SP, utc(2026, 11, 3, 15, 0))

        assert proximo == utc(2026, 11, 6, 11, 0)

    def test_todos_os_dias(self):
        proximo = sched.next_run_after(list(range(7)), ["06:00"], SP, utc(2026, 11, 4, 12, 0))

        assert proximo == utc(2026, 11, 5, 9, 0)

    def test_horario_exatamente_igual_ao_de_referencia_nao_conta(self):
        # "Estritamente depois": quem acabou de disparar as 08:00 nao pode ser agendado de novo as 08:00
        proximo = sched.next_run_after([QUARTA], ["08:00"], SP, utc(2026, 11, 4, 11, 0))

        assert proximo == utc(2026, 11, 11, 11, 0)

    def test_um_minuto_antes_ainda_pega_o_horario(self):
        proximo = sched.next_run_after([QUARTA], ["08:00"], SP, utc(2026, 11, 4, 10, 59))

        assert proximo == utc(2026, 11, 4, 11, 0)

    def test_virada_de_semana(self):
        # Domingo a noite -> a segunda seguinte
        proximo = sched.next_run_after([SEGUNDA], ["08:00"], SP, utc(2026, 11, 9, 2, 0))

        assert proximo == utc(2026, 11, 9, 11, 0)

    def test_o_dia_vale_no_fuso_da_assinatura_nao_em_utc(self):
        # Terca 22:00 no Brasil ja e quarta 01:00 em UTC. Assinatura de TERCA 23:00 no Brasil:
        proximo = sched.next_run_after([TERCA], ["23:00"], SP, utc(2026, 11, 4, 1, 0))

        assert proximo == utc(2026, 11, 4, 2, 0)  # terca 23:00 -> quarta 02:00 UTC

    def test_fuso_diferente_muda_o_resultado(self):
        sp = sched.next_run_after([QUARTA], ["08:00"], SP, utc(2026, 11, 3, 0, 0))
        utc_zone = sched.next_run_after([QUARTA], ["08:00"], "UTC", utc(2026, 11, 3, 0, 0))

        assert sp == utc(2026, 11, 4, 11, 0)
        assert utc_zone == utc(2026, 11, 4, 8, 0)

    def test_aceita_referencia_sem_fuso_como_utc(self):
        # O SQLite devolve datas sem fuso
        sem_fuso = datetime(2026, 11, 4, 13, 0)

        assert sched.next_run_after([QUARTA], ["17:30"], SP, sem_fuso) == utc(2026, 11, 4, 20, 30)

    def test_horario_de_verao_respeita_o_fuso(self):
        # Nova York: em janeiro UTC-5, em julho UTC-4. "09:00" local muda em UTC.
        inverno = sched.next_run_after(list(range(7)), ["09:00"], "America/New_York", utc(2026, 1, 14, 0, 0))
        verao = sched.next_run_after(list(range(7)), ["09:00"], "America/New_York", utc(2026, 7, 14, 0, 0))

        assert inverno == utc(2026, 1, 14, 14, 0)
        assert verao == utc(2026, 7, 14, 13, 0)


class TestPeriodoDeValidade:
    def test_antes_da_data_inicial_espera_ate_ela(self):
        proximo = sched.next_run_after(
            list(range(7)), ["08:00"], SP, utc(2026, 11, 4, 12, 0), start_date=date(2026, 11, 10)
        )

        assert proximo == utc(2026, 11, 10, 11, 0)

    def test_data_inicial_num_dia_nao_marcado_vai_para_o_primeiro_dia_marcado_depois_dela(self):
        # Comeca numa terca, mas so envia nas quintas
        proximo = sched.next_run_after(
            [QUINTA], ["08:00"], SP, utc(2026, 11, 2, 12, 0), start_date=date(2026, 11, 10)
        )

        assert proximo == utc(2026, 11, 12, 11, 0)

    def test_no_ultimo_dia_ainda_envia(self):
        proximo = sched.next_run_after(
            [QUARTA], ["17:30"], SP, utc(2026, 11, 4, 13, 0), end_date=date(2026, 11, 4)
        )

        assert proximo == utc(2026, 11, 4, 20, 30)

    def test_depois_da_data_final_nao_ha_mais_envio(self):
        proximo = sched.next_run_after(
            [QUARTA], ["17:30"], SP, utc(2026, 11, 4, 21, 0), end_date=date(2026, 11, 4)
        )

        assert proximo is None

    def test_data_final_no_passado(self):
        assert sched.next_run_after(list(range(7)), ["08:00"], SP, utc(2026, 11, 4), end_date=date(2026, 1, 1)) is None

    def test_o_proximo_dia_marcado_cai_depois_da_data_final(self):
        proximo = sched.next_run_after(
            [SEGUNDA], ["08:00"], SP, utc(2026, 11, 4, 12, 0), end_date=date(2026, 11, 8)
        )

        assert proximo is None  # a proxima segunda (09/11) ja esta fora do periodo


class TestValidacao:
    def test_dias_sao_ordenados_e_sem_repeticao(self):
        assert sched.normalize_days([4, 0, 4, 2]) == [0, 2, 4]

    @pytest.mark.parametrize("dias", [[], [7], [-1], [0, 9]])
    def test_dias_invalidos(self, dias):
        with pytest.raises(ScheduleError):
            sched.normalize_days(dias)

    def test_horarios_sao_ordenados_e_sem_repeticao(self):
        assert sched.normalize_times(["17:30", "08:00", "08:00", " 12:15 "]) == ["08:00", "12:15", "17:30"]

    @pytest.mark.parametrize("horario", ["8:00", "24:00", "12:60", "abc", "", "08:0", "08:00:00", "8h"])
    def test_horarios_invalidos(self, horario):
        with pytest.raises(ScheduleError, match="Horario invalido"):
            sched.normalize_times([horario])

    def test_sem_horarios(self):
        with pytest.raises(ScheduleError, match="pelo menos um"):
            sched.normalize_times([])

    def test_limite_de_horarios_por_dia(self):
        muitos = [f"{h:02d}:00" for h in range(sched.MAX_TIMES_PER_DAY + 1)]

        with pytest.raises(ScheduleError, match="No maximo"):
            sched.normalize_times(muitos)

    def test_limites_do_dia_sao_aceitos(self):
        assert sched.normalize_times(["00:00", "23:59"]) == ["00:00", "23:59"]

    def test_fuso_invalido(self):
        with pytest.raises(ScheduleError, match="Fuso"):
            sched.validate_timezone("Marte/Olympus")
        assert sched.validate_timezone("America/Sao_Paulo") == "America/Sao_Paulo"

    def test_data_final_antes_da_inicial(self):
        with pytest.raises(ScheduleError, match="data final"):
            sched.validate_period(date(2026, 11, 10), date(2026, 11, 1))
        sched.validate_period(date(2026, 11, 10), date(2026, 11, 10))  # o mesmo dia vale
        sched.validate_period(None, date(2026, 11, 1))
        sched.validate_period(None, None)


class TestDescricao:
    def test_dias_e_horarios(self):
        assert sched.describe([0, 2, 4], ["08:00", "17:30"]) == "seg, qua, sex as 08:00, 17:30"

    def test_todos_os_dias(self):
        assert sched.describe(list(range(7)), ["06:00"]) == "todos os dias as 06:00"
