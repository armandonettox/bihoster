"""Camada de dados do chat: elegibilidade (RLS bloqueia, na duvida bloqueia), esquema, validador de
DAX e execucao com limites."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.core import chat_dataset, powerbi
from app.core.chat_dataset import ChatDataError, DatasetSchema, SchemaColumn, SchemaTable
from app.core.powerbi import DatasetSecurityInfo, DaxQueryError, PowerBIError

CONEXAO = SimpleNamespace(id=1)
RELATORIO = SimpleNamespace(id=7, pbi_workspace_id="ws", pbi_dataset_id="ds")

SEM_RLS = DatasetSecurityInfo(known=True, requires_identity=False, has_rls_roles=False)


@pytest.fixture(autouse=True)
def _caches_limpos():
    chat_dataset.clear_caches()
    yield
    chat_dataset.clear_caches()


@pytest.fixture
def pbi(monkeypatch):
    """Power BI falso: `info` e a resposta de seguranca; `consultas` guarda as DAX executadas;
    `respostas` mapeia um trecho da DAX para as linhas devolvidas (ou uma excecao)."""
    estado = SimpleNamespace(info=SEM_RLS, consultas=[], respostas={}, chamadas_info=0)

    def fake_info(connection, workspace_id, dataset_id):
        estado.chamadas_info += 1
        if isinstance(estado.info, Exception):
            raise estado.info
        return estado.info

    def fake_execute(connection, workspace_id, dataset_id, dax, timeout=45.0):
        estado.consultas.append(dax)
        for trecho, resposta in estado.respostas.items():
            if trecho in dax:
                if isinstance(resposta, Exception):
                    raise resposta
                return resposta
        return []

    monkeypatch.setattr(powerbi, "get_dataset_security_info", fake_info)
    monkeypatch.setattr(powerbi, "execute_dax_query_strict", fake_execute)
    return estado


class TestElegibilidade:
    def test_sem_rls_e_confirmado_pode(self, pbi):
        assert chat_dataset.check_eligibility(CONEXAO, RELATORIO) == chat_dataset.Eligibility(True, None)

    def test_exige_identidade_efetiva_bloqueia(self, pbi):
        pbi.info = DatasetSecurityInfo(known=True, requires_identity=True, has_rls_roles=False)

        resultado = chat_dataset.check_eligibility(CONEXAO, RELATORIO)

        assert resultado.ok is False and "seguranca por linha" in resultado.reason

    def test_papeis_de_rls_bloqueiam(self, pbi):
        pbi.info = DatasetSecurityInfo(known=True, requires_identity=False, has_rls_roles=True)

        assert chat_dataset.check_eligibility(CONEXAO, RELATORIO).ok is False

    def test_na_duvida_bloqueia(self, pbi):
        pbi.info = DatasetSecurityInfo(known=False, requires_identity=False, has_rls_roles=False)

        resultado = chat_dataset.check_eligibility(CONEXAO, RELATORIO)

        assert resultado.ok is False and "Nao foi possivel confirmar" in resultado.reason

    def test_sem_dataset_bloqueia_sem_perguntar_ao_power_bi(self, pbi):
        sem_dataset = SimpleNamespace(id=8, pbi_workspace_id="ws", pbi_dataset_id=None)

        resultado = chat_dataset.check_eligibility(CONEXAO, sem_dataset)

        assert resultado.ok is False and "dataset" in resultado.reason
        assert pbi.chamadas_info == 0

    def test_erro_do_power_bi_bloqueia_e_nao_fica_em_cache(self, pbi):
        pbi.info = PowerBIError("fora do ar")

        assert chat_dataset.check_eligibility(CONEXAO, RELATORIO).ok is False

        pbi.info = SEM_RLS
        assert chat_dataset.check_eligibility(CONEXAO, RELATORIO).ok is True
        assert pbi.chamadas_info == 2

    def test_resposta_fica_em_cache(self, pbi):
        chat_dataset.check_eligibility(CONEXAO, RELATORIO)
        chat_dataset.check_eligibility(CONEXAO, RELATORIO)

        assert pbi.chamadas_info == 1

    def test_cache_vencido_pergunta_de_novo_e_pega_o_rls_ligado_depois(self, pbi):
        chat_dataset.check_eligibility(CONEXAO, RELATORIO)
        chave = (1, "ws", "ds")
        _, valor = chat_dataset._eligibility_cache[chave]
        chat_dataset._eligibility_cache[chave] = (datetime.now(timezone.utc) - timedelta(seconds=1), valor)
        pbi.info = DatasetSecurityInfo(known=True, requires_identity=True, has_rls_roles=False)

        assert chat_dataset.check_eligibility(CONEXAO, RELATORIO).ok is False

    def test_cache_e_por_conexao_e_dataset(self, pbi):
        outro = SimpleNamespace(id=9, pbi_workspace_id="ws", pbi_dataset_id="outro-ds")

        chat_dataset.check_eligibility(CONEXAO, RELATORIO)
        chat_dataset.check_eligibility(CONEXAO, outro)

        assert pbi.chamadas_info == 2


TABELAS = [
    {"[ID]": 1, "[Name]": "Vendas", "[IsHidden]": False},
    {"[ID]": 2, "[Name]": "Aux", "[IsHidden]": True},
    {"[ID]": 3, "[Name]": "LocalDateTable_abc", "[IsHidden]": False},
    {"[ID]": 4, "[Name]": "Medidas", "[IsHidden]": False},
]
COLUNAS = [
    {"[TableID]": 1, "[ExplicitName]": "Data", "[IsHidden]": False, "[Type]": 1, "[ExplicitDataType]": 9},
    {"[TableID]": 1, "[ExplicitName]": "Valor", "[IsHidden]": False, "[Type]": 1, "[ExplicitDataType]": 8},
    {"[TableID]": 1, "[ExplicitName]": "Oculta", "[IsHidden]": True, "[Type]": 1, "[ExplicitDataType]": 2},
    {"[TableID]": 1, "[ExplicitName]": "RowNumber-2662979B", "[IsHidden]": False, "[Type]": 3, "[ExplicitDataType]": 6},
    {"[TableID]": 1, "[ExplicitName]": None, "[InferredName]": "Cliente", "[IsHidden]": False, "[Type]": 1, "[InferredDataType]": 2},
    {"[TableID]": 2, "[ExplicitName]": "NaTabelaOculta", "[IsHidden]": False, "[Type]": 1},
    {"[TableID]": 3, "[ExplicitName]": "Ano", "[IsHidden]": False, "[Type]": 2},
    {"[TableID]": 1, "[ExplicitName]": "Sem tipo", "[IsHidden]": False, "[Type]": 1, "[ExplicitDataType]": 99},
]
MEDIDAS = [
    {"[TableID]": 4, "[Name]": "Total Vendas", "[IsHidden]": False, "[Description]": "Soma do valor das vendas"},
    {"[TableID]": 4, "[Name]": "Interna", "[IsHidden]": True},
    {"[TableID]": 4, "[Name]": "Ticket", "[IsHidden]": False, "[Description]": "  "},
]


def _respostas_info(pbi):
    pbi.respostas = {"INFO.TABLES": TABELAS, "INFO.COLUMNS": COLUNAS, "INFO.MEASURES": MEDIDAS}


class TestEsquema:
    def test_le_so_o_que_e_visivel(self, pbi):
        _respostas_info(pbi)

        esquema = chat_dataset.get_dataset_schema(CONEXAO, RELATORIO)

        assert [t.name for t in esquema.tables] == ["Vendas", "Medidas"]
        vendas = esquema.tables[0]
        assert [c.name for c in vendas.columns] == ["Data", "Valor", "Cliente", "Sem tipo"]

    def test_traduz_o_tipo_dos_dados(self, pbi):
        _respostas_info(pbi)

        colunas = {c.name: c.data_type for c in chat_dataset.get_dataset_schema(CONEXAO, RELATORIO).tables[0].columns}

        assert colunas == {"Data": "data e hora", "Valor": "decimal", "Cliente": "texto", "Sem tipo": None}

    def test_medidas_com_descricao_so_quando_ha_texto(self, pbi):
        _respostas_info(pbi)

        medidas = chat_dataset.get_dataset_schema(CONEXAO, RELATORIO).tables[1].measures

        assert medidas == (("Total Vendas", "Soma do valor das vendas"), ("Ticket", None))

    def test_aceita_nomes_de_coluna_sem_colchetes(self, pbi):
        pbi.respostas = {
            "INFO.TABLES": [{"ID": 1, "Name": "Vendas", "IsHidden": False}],
            "INFO.COLUMNS": [{"TableID": 1, "ExplicitName": "Valor", "IsHidden": False}],
            "INFO.MEASURES": [],
        }

        esquema = chat_dataset.get_dataset_schema(CONEXAO, RELATORIO)

        assert esquema.tables[0].columns[0].name == "Valor"

    def test_contagens(self, pbi):
        _respostas_info(pbi)

        esquema = chat_dataset.get_dataset_schema(CONEXAO, RELATORIO)

        assert (len(esquema.tables), esquema.column_count, esquema.measure_count) == (2, 4, 2)

    def test_fica_em_cache(self, pbi):
        _respostas_info(pbi)

        chat_dataset.get_dataset_schema(CONEXAO, RELATORIO)
        pbi.consultas.clear()
        chat_dataset.get_dataset_schema(CONEXAO, RELATORIO)

        assert pbi.consultas == []

    def test_dataset_com_rls_nao_tem_esquema_lido(self, pbi):
        pbi.info = DatasetSecurityInfo(known=True, requires_identity=True, has_rls_roles=False)

        with pytest.raises(ChatDataError, match="seguranca por linha"):
            chat_dataset.get_dataset_schema(CONEXAO, RELATORIO)

        assert pbi.consultas == []

    def test_se_as_funcoes_info_falham_usa_columnstatistics(self, pbi):
        pbi.respostas = {
            "INFO.TABLES": DaxQueryError("INFO nao suportada"),
            "COLUMNSTATISTICS": [
                {"[Table Name]": "Vendas", "[Column Name]": "Valor"},
                {"[Table Name]": "Vendas", "[Column Name]": "RowNumber-1"},
                {"[Table Name]": "LocalDateTable_x", "[Column Name]": "Ano"},
                {"[Table Name]": "Clientes", "[Column Name]": "Nome"},
            ],
        }

        esquema = chat_dataset.get_dataset_schema(CONEXAO, RELATORIO)

        assert {t.name: [c.name for c in t.columns] for t in esquema.tables} == {"Vendas": ["Valor"], "Clientes": ["Nome"]}
        assert esquema.measure_count == 0

    def test_falha_que_nao_e_de_dax_nao_aciona_a_alternativa(self, pbi):
        pbi.respostas = {"INFO.TABLES": PowerBIError("HTTP 401")}

        with pytest.raises(PowerBIError):
            chat_dataset.get_dataset_schema(CONEXAO, RELATORIO)

        assert not any("COLUMNSTATISTICS" in q for q in pbi.consultas)

    def test_dataset_sem_nada_visivel_e_erro_claro(self, pbi):
        pbi.respostas = {"INFO.TABLES": [], "INFO.COLUMNS": [], "INFO.MEASURES": []}

        with pytest.raises(ChatDataError, match="tabelas e colunas visiveis"):
            chat_dataset.get_dataset_schema(CONEXAO, RELATORIO)


def _esquema(*tabelas: SchemaTable) -> DatasetSchema:
    return DatasetSchema(tables=tuple(tabelas))


class TestEsquemaEmTexto:
    def test_traz_a_sintaxe_dax_de_cada_nome(self):
        texto = chat_dataset.format_schema_for_prompt(
            _esquema(
                SchemaTable(
                    "Vendas",
                    (SchemaColumn("Valor", "decimal"), SchemaColumn("Cliente", None)),
                    (("Total", "Soma"), ("Ticket", None)),
                )
            )
        )

        assert texto == (
            "Tabela 'Vendas'\n"
            "  Colunas: 'Vendas'[Valor] (decimal); 'Vendas'[Cliente]\n"
            "  Medidas: [Total] - Soma; [Ticket]"
        )

    def test_escapa_apostrofo_e_colchete_fechando(self):
        texto = chat_dataset.format_schema_for_prompt(
            _esquema(SchemaTable("D'Avila", (SchemaColumn("a]b", None),), (("m]x", None),)))
        )

        assert "'D''Avila'['a]]b']" not in texto  # a coluna nao leva aspas
        assert "'D''Avila'[a]]b]" in texto
        assert "[m]]x]" in texto

    def test_corta_por_tamanho_e_avisa(self):
        tabelas = [SchemaTable(f"T{i}", (SchemaColumn("Coluna", None),), ()) for i in range(20)]

        texto = chat_dataset.format_schema_for_prompt(_esquema(*tabelas), max_chars=120)

        assert "Tabela 'T0'" in texto
        assert "Tabela 'T19'" not in texto
        assert "tabelas omitidas por tamanho" in texto

    def test_a_primeira_tabela_entra_mesmo_estourando_o_limite(self):
        tabela = SchemaTable("Grande", tuple(SchemaColumn(f"c{i}", None) for i in range(50)), ())

        texto = chat_dataset.format_schema_for_prompt(_esquema(tabela), max_chars=10)

        assert texto.startswith("Tabela 'Grande'")
        assert "omitidas por tamanho" not in texto

    def test_limita_colunas_por_tabela(self):
        tabela = SchemaTable("T", tuple(SchemaColumn(f"c{i}", None) for i in range(200)), ())

        texto = chat_dataset.format_schema_for_prompt(_esquema(tabela), max_chars=10**6)

        assert "'T'[c149]" in texto and "'T'[c150]" not in texto
        assert "(+50 colunas omitidas)" in texto


class TestValidarDax:
    @pytest.mark.parametrize(
        "dax",
        [
            "EVALUATE Vendas",
            "  evaluate TOPN(10, Vendas)  ",
            "DEFINE MEASURE Vendas[Total] = SUM(Vendas[Valor])\nEVALUATE ROW(\"x\", [Total])",
            "// total do mes\nEVALUATE ROW(\"t\", [Total])",
            "EVALUATE ROW(\"texto\", \"EVALUATE outra coisa\")",
            "EVALUATE SELECTCOLUMNS(Vendas, \"c\", Vendas[Evaluate])",
            "EVALUATE ROW(\"x\", 'Info'[Valor])",
        ],
    )
    def test_aceita_consultas_validas(self, dax):
        assert chat_dataset.validate_dax(dax) == dax.strip()

    @pytest.mark.parametrize(
        "dax,trecho",
        [
            ("", "vazia"),
            ("   \n  ", "vazia"),
            ("x" * 8001, "passa de"),
            ("SELECT * FROM Vendas", "comecar com EVALUATE"),
            ("EVALUATE Vendas EVALUATE Clientes", "exatamente um EVALUATE"),
            ("DEFINE VAR x = 1", "exatamente um EVALUATE"),
            ("EVALUATE INFO.TABLES()", "metadados"),
            ("EVALUATE Info . Columns()", "metadados"),
            ("EVALUATE $SYSTEM.TMSCHEMA_TABLES", "metadados"),
        ],
    )
    def test_recusa_com_mensagem_corrigivel(self, dax, trecho):
        with pytest.raises(ChatDataError, match=trecho) as erro:
            chat_dataset.validate_dax(dax)

        assert erro.value.fixable is True

    def test_none_e_tratado_como_vazio(self):
        with pytest.raises(ChatDataError, match="vazia"):
            chat_dataset.validate_dax(None)  # type: ignore[arg-type]


class TestExecutar:
    def test_devolve_linhas_e_colunas(self, pbi):
        pbi.respostas = {"EVALUATE": [{"Vendas[Total]": 10, "Vendas[Mes]": "Jan"}, {"Vendas[Total]": 5, "Vendas[Mes]": "Fev"}]}

        resultado = chat_dataset.run_chat_query(CONEXAO, RELATORIO, "EVALUATE Vendas")

        assert resultado.columns == ["Vendas[Total]", "Vendas[Mes]"]
        assert len(resultado.rows) == 2 and resultado.total_rows == 2 and resultado.truncated is False

    def test_corta_em_cem_linhas_e_avisa(self, pbi):
        pbi.respostas = {"EVALUATE": [{"n": i} for i in range(150)]}

        resultado = chat_dataset.run_chat_query(CONEXAO, RELATORIO, "EVALUATE Vendas")

        assert len(resultado.rows) == 100 and resultado.total_rows == 150 and resultado.truncated is True
        assert resultado.rows[-1] == {"n": 99}

    def test_exatamente_cem_linhas_nao_e_corte(self, pbi):
        pbi.respostas = {"EVALUATE": [{"n": i} for i in range(100)]}

        resultado = chat_dataset.run_chat_query(CONEXAO, RELATORIO, "EVALUATE Vendas")

        assert resultado.truncated is False

    def test_sem_linhas(self, pbi):
        resultado = chat_dataset.run_chat_query(CONEXAO, RELATORIO, "EVALUATE Vendas")

        assert (resultado.rows, resultado.columns, resultado.total_rows, resultado.truncated) == ([], [], 0, False)

    def test_manda_a_consulta_sem_espacos_nas_pontas(self, pbi):
        chat_dataset.run_chat_query(CONEXAO, RELATORIO, "  EVALUATE Vendas \n")

        assert pbi.consultas[-1] == "EVALUATE Vendas"

    def test_erro_de_dax_volta_corrigivel_para_a_ia_tentar_de_novo(self, pbi):
        pbi.respostas = {"EVALUATE": DaxQueryError("Falha ao executar query DAX: coluna Foo nao existe")}

        with pytest.raises(ChatDataError, match="Foo") as erro:
            chat_dataset.run_chat_query(CONEXAO, RELATORIO, "EVALUATE Vendas")

        assert erro.value.fixable is True

    def test_falha_de_rede_ou_autenticacao_propaga(self, pbi):
        pbi.respostas = {"EVALUATE": PowerBIError("HTTP 401")}

        with pytest.raises(PowerBIError):
            chat_dataset.run_chat_query(CONEXAO, RELATORIO, "EVALUATE Vendas")

    def test_dataset_com_rls_nunca_executa(self, pbi):
        pbi.info = DatasetSecurityInfo(known=True, requires_identity=False, has_rls_roles=True)

        with pytest.raises(ChatDataError, match="seguranca por linha") as erro:
            chat_dataset.run_chat_query(CONEXAO, RELATORIO, "EVALUATE Vendas")

        assert erro.value.fixable is False
        assert pbi.consultas == []

    def test_na_duvida_sobre_rls_nunca_executa(self, pbi):
        pbi.info = DatasetSecurityInfo(known=False, requires_identity=False, has_rls_roles=False)

        with pytest.raises(ChatDataError):
            chat_dataset.run_chat_query(CONEXAO, RELATORIO, "EVALUATE Vendas")

        assert pbi.consultas == []

    def test_dax_invalida_nem_chega_no_power_bi(self, pbi):
        with pytest.raises(ChatDataError):
            chat_dataset.run_chat_query(CONEXAO, RELATORIO, "EVALUATE INFO.TABLES()")

        assert pbi.consultas == [] and pbi.chamadas_info == 0

    def test_vaga_e_devolvida_depois_de_erro(self, pbi):
        pbi.respostas = {"EVALUATE": DaxQueryError("falhou")}
        for _ in range(5):  # mais do que as 3 vagas: se o erro prendesse a vaga, travaria
            with pytest.raises(ChatDataError):
                chat_dataset.run_chat_query(CONEXAO, RELATORIO, "EVALUATE Vendas")

    def test_sem_vaga_livre_responde_com_aviso_em_vez_de_travar(self, pbi, monkeypatch):
        monkeypatch.setattr(chat_dataset, "QUERY_SLOT_WAIT_SECONDS", 0.01)
        tomadas = [chat_dataset._query_slots.acquire() for _ in range(3)]
        try:
            with pytest.raises(ChatDataError, match="Muitas consultas"):
                chat_dataset.run_chat_query(CONEXAO, RELATORIO, "EVALUATE Vendas")
        finally:
            for _ in tomadas:
                chat_dataset._query_slots.release()
