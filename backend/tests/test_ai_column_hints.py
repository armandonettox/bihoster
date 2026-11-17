"""Sugestao de colunas para bloquear no chat: por nome (dado de pessoa ou documento) e por texto com valores demais.
So sinaliza; usa so o nome e a contagem de valores diferentes."""

import pytest

from app.core import ai_column_hints
from app.core.ai_column_hints import SUGGEST_MANY_VALUES, SUGGEST_NAME, suggestion
from app.core.chat_dataset import MAX_ROWS_FOR_AI, SchemaColumn


class TestPorNome:
    @pytest.mark.parametrize(
        "nome",
        [
            "nome",
            "Nome",
            "NomeCliente",
            "nome_beneficiario",
            "dim_pessoa.nome",
            "CPF",
            "cnpj",
            "E-mail",
            "email_titular",
            "telefone",
            "Celular",
            "matricula",
            "Matrícula",
            "Beneficiários",
            "dt_nascimento",
            "Endereço",
            "carteirinha",
        ],
    )
    def test_nome_que_lembra_dado_de_pessoa_ou_documento_e_sugerido(self, nome):
        assert suggestion(SchemaColumn(nome, "texto")) == SUGGEST_NAME

    @pytest.mark.parametrize("tipo", ["texto", "inteiro", "decimal", "data", None])
    def test_a_sugestao_por_nome_vale_para_qualquer_tipo(self, tipo):
        assert suggestion(SchemaColumn("matricula", tipo)) == SUGGEST_NAME

    @pytest.mark.parametrize("nome", ["origem", "margem", "regiao", "uf", "valor", "unidade", "competencia", "nomenclatura", "rgb"])
    def test_palavra_parecida_dentro_de_outra_nao_gera_falso_positivo(self, nome):
        assert suggestion(SchemaColumn(nome, "texto", 5)) is None


class TestPorQuantidadeDeValores:
    def test_texto_com_valores_demais_e_sugerido(self):
        assert suggestion(SchemaColumn("unidade", "texto", 1377)) == SUGGEST_MANY_VALUES

    def test_o_limite_e_o_mesmo_das_linhas_que_o_chat_recebe(self):
        assert ai_column_hints.MANY_VALUES_LIMIT == MAX_ROWS_FOR_AI
        assert suggestion(SchemaColumn("regiao", "texto", MAX_ROWS_FOR_AI)) is None
        assert suggestion(SchemaColumn("regiao", "texto", MAX_ROWS_FOR_AI + 1)) == SUGGEST_MANY_VALUES

    def test_coluna_sem_tipo_vinda_da_leitura_alternativa_conta_como_texto(self):
        assert suggestion(SchemaColumn("codigo_interno", None, 5000)) == SUGGEST_MANY_VALUES

    @pytest.mark.parametrize("tipo", ["inteiro", "decimal", "data"])
    def test_numero_e_data_com_muitos_valores_nao_sao_sugeridos(self, tipo):
        assert suggestion(SchemaColumn("valor", tipo, 5000)) is None

    def test_sem_contagem_nada_e_sugerido(self):
        assert suggestion(SchemaColumn("regiao", "texto", None)) is None

    def test_poucos_valores_nao_sao_sugeridos(self):
        assert suggestion(SchemaColumn("uf", "texto", 5)) is None


def test_o_nome_pesa_mais_que_a_quantidade_de_valores():
    assert suggestion(SchemaColumn("nome", "texto", 5000)) == SUGGEST_NAME
