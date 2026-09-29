"""Ordem dos relatorios dentro de uma secao (Modo TV, Apresentacao): a ordem define a sequencia de
exibicao, entao precisa ser estavel, controlavel (subir/descer) e restrita a quem pode editar."""

import pytest


def _register_and_login(client, email: str = "admin@example.com") -> str:
    client.post("/auth/register", json={"name": "Pessoa", "email": email, "password": "SenhaForte123"})
    resp = client.post("/auth/login", json={"email": email, "password": "SenhaForte123"})
    return resp.json()["access_token"]


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _setup(client):
    headers = _headers(_register_and_login(client))
    workspace = client.post("/workspaces/", json={"name": "Sala"}, headers=headers).json()
    conn = client.post(
        "/powerbi-connections/",
        json={"name": "Conta", "tenant_id": "t", "client_id": "c", "client_secret": "s"},
        headers=headers,
    ).json()
    return headers, workspace, conn


def _add(client, headers, workspace, conn, name: str, display_type: str = "tv") -> dict:
    resp = client.post(
        f"/workspaces/{workspace['id']}/reports/",
        json={
            "name": name,
            "powerbi_connection_id": conn["id"],
            "pbi_workspace_id": "w",
            "pbi_report_id": f"r-{name}",
            "display_type": display_type,
        },
        headers=headers,
    )
    assert resp.status_code == 201
    return resp.json()


def _names(client, headers, workspace, display_type: str | None = None) -> list[str]:
    reports = client.get(f"/workspaces/{workspace['id']}/reports/", headers=headers).json()
    return [r["name"] for r in reports if display_type is None or r["display_type"] == display_type]


def _move(client, headers, workspace, report, direction: str):
    return client.post(
        f"/workspaces/{workspace['id']}/reports/{report['id']}/move",
        json={"direction": direction},
        headers=headers,
    )


def test_sem_mover_a_ordem_e_a_de_criacao(client):
    headers, ws, conn = _setup(client)
    for name in ("A", "B", "C"):
        _add(client, headers, ws, conn, name)

    assert _names(client, headers, ws) == ["A", "B", "C"]


def test_descer_troca_com_o_proximo_da_mesma_secao(client):
    headers, ws, conn = _setup(client)
    a, b, c = (_add(client, headers, ws, conn, n) for n in ("A", "B", "C"))

    resp = _move(client, headers, ws, a, "down")

    assert resp.status_code == 200
    assert _names(client, headers, ws) == ["B", "A", "C"]


def test_subir_troca_com_o_anterior(client):
    headers, ws, conn = _setup(client)
    a, b, c = (_add(client, headers, ws, conn, n) for n in ("A", "B", "C"))

    _move(client, headers, ws, c, "up")

    assert _names(client, headers, ws) == ["A", "C", "B"]


def test_a_resposta_ja_traz_a_lista_na_nova_ordem(client):
    headers, ws, conn = _setup(client)
    a, b = (_add(client, headers, ws, conn, n) for n in ("A", "B"))

    resp = _move(client, headers, ws, a, "down")

    assert [r["name"] for r in resp.json()] == ["B", "A"]


def test_mover_so_considera_relatorios_da_mesma_secao(client):
    """Um relatorio de outra secao entre dois da TV nao conta como vizinho."""
    headers, ws, conn = _setup(client)
    tv1 = _add(client, headers, ws, conn, "TV1", "tv")
    _add(client, headers, ws, conn, "Painel", "painel")
    _add(client, headers, ws, conn, "TV2", "tv")

    _move(client, headers, ws, tv1, "down")

    assert _names(client, headers, ws, "tv") == ["TV2", "TV1"]
    assert _names(client, headers, ws, "painel") == ["Painel"]


def test_no_topo_subir_nao_muda_nada(client):
    headers, ws, conn = _setup(client)
    a, b = (_add(client, headers, ws, conn, n) for n in ("A", "B"))

    resp = _move(client, headers, ws, a, "up")

    assert resp.status_code == 200
    assert _names(client, headers, ws) == ["A", "B"]


def test_no_fim_descer_nao_muda_nada(client):
    headers, ws, conn = _setup(client)
    a, b = (_add(client, headers, ws, conn, n) for n in ("A", "B"))

    resp = _move(client, headers, ws, b, "down")

    assert resp.status_code == 200
    assert _names(client, headers, ws) == ["A", "B"]


def test_movimentos_seguidos_acumulam(client):
    headers, ws, conn = _setup(client)
    a, b, c, d = (_add(client, headers, ws, conn, n) for n in ("A", "B", "C", "D"))

    _move(client, headers, ws, a, "down")  # B A C D
    _move(client, headers, ws, a, "down")  # B C A D
    _move(client, headers, ws, d, "up")  # B C D A

    assert _names(client, headers, ws) == ["B", "C", "D", "A"]


def test_relatorio_criado_depois_da_reordenacao_vai_para_o_fim(client):
    headers, ws, conn = _setup(client)
    a, b = (_add(client, headers, ws, conn, n) for n in ("A", "B"))
    _move(client, headers, ws, a, "down")  # B A

    _add(client, headers, ws, conn, "Novo")

    assert _names(client, headers, ws) == ["B", "A", "Novo"]


def test_direcao_invalida_da_422(client):
    headers, ws, conn = _setup(client)
    a = _add(client, headers, ws, conn, "A")

    assert _move(client, headers, ws, a, "lateral").status_code == 422


def test_relatorio_inexistente_da_404(client):
    headers, ws, conn = _setup(client)

    resp = client.post(f"/workspaces/{ws['id']}/reports/9999/move", json={"direction": "up"}, headers=headers)

    assert resp.status_code == 404


def test_relatorio_de_outra_colecao_da_404(client):
    headers, ws, conn = _setup(client)
    other = client.post("/workspaces/", json={"name": "Outra"}, headers=headers).json()
    a = _add(client, headers, ws, conn, "A")

    resp = client.post(f"/workspaces/{other['id']}/reports/{a['id']}/move", json={"direction": "up"}, headers=headers)

    assert resp.status_code == 404


def test_leitor_da_colecao_nao_reordena(client):
    """Todo usuario novo entra no grupo padrao, que ganha acesso de leitura (viewer) a cada
    colecao criada: ele ve os relatorios, mas nao pode mudar a ordem."""
    headers, ws, conn = _setup(client)
    a, b = (_add(client, headers, ws, conn, n) for n in ("A", "B"))
    viewer = _headers(_register_and_login(client, "leitor@example.com"))
    assert _names(client, viewer, ws) == ["A", "B"], "o leitor deveria enxergar a colecao"

    resp = _move(client, viewer, ws, a, "down")

    assert resp.status_code == 403
    assert _names(client, headers, ws) == ["A", "B"]


def test_sem_login_da_401(client):
    headers, ws, conn = _setup(client)
    a = _add(client, headers, ws, conn, "A")

    resp = client.post(f"/workspaces/{ws['id']}/reports/{a['id']}/move", json={"direction": "up"})

    assert resp.status_code == 401


@pytest.mark.parametrize("display_type", ["tv", "apresentacao", "relatorio", "painel"])
def test_funciona_em_todas_as_secoes(client, display_type):
    headers, ws, conn = _setup(client)
    a, b = (_add(client, headers, ws, conn, n, display_type) for n in ("A", "B"))

    _move(client, headers, ws, a, "down")

    assert _names(client, headers, ws, display_type) == ["B", "A"]
