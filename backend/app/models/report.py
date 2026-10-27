import json

from sqlalchemy import Boolean, Column, Integer, String, Text, ForeignKey, DateTime, func

from app.core.database import Base


class Report(Base):
    __tablename__ = "reports"

    id = Column(Integer, primary_key=True, index=True)
    collection_id = Column(Integer, ForeignKey("workspaces.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    # Qual conta/Service Principal do Power BI usar para esse relatorio (suporta mais de uma conta).
    powerbi_connection_id = Column(Integer, ForeignKey("powerbi_connections.id"), nullable=True)
    # Identificadores do Power BI -- prefixo pbi_ pra nao confundir com o "workspace"/colecao
    # do proprio app (collection_id acima), que e um conceito totalmente diferente.
    pbi_workspace_id = Column(String, nullable=False)
    pbi_report_id = Column(String, nullable=False)
    pbi_dataset_id = Column(String, nullable=True)
    # Nome tecnico (nao o titulo exibido) de uma pagina/aba especifica do relatorio -- None
    # embeda o relatorio inteiro, com navegacao entre todas as abas publicadas.
    pbi_page_name = Column(String, nullable=True)
    # Lista de abas escolhidas (JSON, ex: '["ReportSection1","ReportSection2"]'). Nulo = relatorio
    # antigo, de antes da selecao multipla: vale o pbi_page_name. "[]" = relatorio inteiro. Coluna
    # de texto nulavel de proposito (a migracao automatica do boot so adiciona colunas nulaveis).
    pbi_page_names_json = Column(Text, nullable=True)
    # Controles do iframe do Power BI: nullable de proposito (migracao automatica so adiciona
    # colunas nulaveis). False/NULL = oculto; True = visivel.
    show_filter_pane = Column(Boolean, default=False, nullable=True)
    show_page_nav = Column(Boolean, default=False, nullable=True)
    # Secao da colecao onde o relatorio aparece: relatorio, painel, apresentacao ou tv
    display_type = Column(String, default="relatorio", nullable=False)
    # Ordem dentro da secao (colecao + display_type), do menor pro maior. Nulo = ainda nao
    # reordenado: fica depois dos que tem posicao, na ordem de criacao. Coluna nulavel de
    # proposito (a migracao automatica do boot so adiciona colunas nulaveis).
    position = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    @property
    def pbi_page_names(self) -> list[str]:
        """Abas escolhidas pra exibir. Lista vazia = relatorio inteiro."""
        if self.pbi_page_names_json is not None:
            try:
                parsed = json.loads(self.pbi_page_names_json)
            except ValueError:
                parsed = None
            if isinstance(parsed, list):
                return [item for item in parsed if isinstance(item, str)]
        return [self.pbi_page_name] if self.pbi_page_name else []

    def set_page_names(self, names: list[str]) -> None:
        """Grava a lista e mantem pbi_page_name como a primeira aba (compatibilidade com
        versoes antigas do app e com quem faz rollback de imagem)."""
        self.pbi_page_names_json = json.dumps(names)
        self.pbi_page_name = names[0] if names else None
