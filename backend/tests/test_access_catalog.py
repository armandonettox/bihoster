from app.core.access_catalog import CATALOG, GLOBAL, PRESETS, WORKSPACE, with_implied


def test_chaves_nao_se_repetem():
    keys = [p.key for p in CATALOG]
    assert len(keys) == len(set(keys))


def test_toda_exigencia_existe_e_tem_o_mesmo_escopo():
    by_key = {p.key: p for p in CATALOG}
    for permission in CATALOG:
        for required in permission.requires:
            assert required in by_key, f"{permission.key} exige {required}, que não existe"
            assert by_key[required].scope == permission.scope, f"{permission.key} mistura escopos com {required}"


def test_item_de_grupo_tem_nome_e_descricao_do_grupo():
    for permission in CATALOG:
        if permission.feature:
            assert permission.feature_label and permission.feature_description, permission.key


def test_grupo_de_itens_fica_inteiro_no_mesmo_escopo():
    scopes_by_feature: dict[str, set[str]] = {}
    for permission in CATALOG:
        if permission.feature:
            scopes_by_feature.setdefault(permission.feature, set()).add(permission.scope)
    assert all(len(scopes) == 1 for scopes in scopes_by_feature.values())


def test_atalhos_so_usam_permissoes_de_colecao_do_catalogo():
    workspace_keys = {p.key for p in CATALOG if p.scope == WORKSPACE}
    for name, keys in PRESETS.items():
        assert set(keys) <= workspace_keys, name


def test_administracao_tem_os_itens_delegaveis_e_nao_a_atualizacao_do_sistema():
    keys = {p.key for p in CATALOG if p.scope == GLOBAL}
    assert {"membros.adicionar", "grupos.criar", "permissoes.editar", "colecao.criar", "auditoria.reverter"} <= keys
    # Aplicar a atualização do servidor fica só com o administrador da plataforma
    assert not any("atualizar-sistema" in key or key == "sistema.aplicar" for key in keys)


def test_exigencias_em_cadeia_da_administracao():
    # Dar permissões exige poder ver membros e grupos; criar coleção exige ver todas
    assert set(with_implied(["permissoes.editar"])) == {"permissoes.editar", "membros.ver", "grupos.ver"}
    assert set(with_implied(["colecao.criar"])) == {"colecao.criar", "colecao.todas"}
    assert set(with_implied(["membros.adicionar"])) == {"membros.adicionar", "membros.ver"}
