#!/bin/sh
set -e

# Rename do projeto (ver L-330) mudou tambem o nome do arquivo do banco (DATABASE_URL). Sem
# isso, quem atualiza uma instancia existente perderia o acesso aos dados -- o arquivo antigo
# continua no volume, so o app passaria a procurar por outro nome. Migra uma unica vez, so se
# o banco novo ainda nao existir e o antigo existir.
# Nome antigo montado em duas partes de proposito -- se ficasse escrito por inteiro aqui, a
# reescrita de historico do git (replace-text trocando o nome antigo pelo novo em todos os
# commits) teria substituido essa string tambem e quebrado a migracao.
OLD_DB_NAME="pbi""hoster.db"
OLD_DB="/app/data/${OLD_DB_NAME}"
NEW_DB=/app/data/bihoster.db
if [ -f "$OLD_DB" ] && [ ! -f "$NEW_DB" ]; then
    mv "$OLD_DB" "$NEW_DB"
fi

# Se o socket do Docker do host estiver montado (ENABLE_AUTO_UPDATE=true, ver
# docker-compose.yml), o GID do grupo dono dele varia por host -- nao da pra cravar isso no
# build da imagem (ver L-326 no vault pessoal). Em vez disso, resolve em runtime: cria/ajusta
# um grupo local com o GID real do socket e coloca o appuser nele, sempre que o container sobe.
SOCKET=/var/run/docker.sock
if [ -S "$SOCKET" ]; then
    SOCKET_GID=$(stat -c '%g' "$SOCKET")
    EXISTING_GROUP=$(getent group "$SOCKET_GID" | cut -d: -f1 || true)
    if [ -z "$EXISTING_GROUP" ]; then
        groupadd -g "$SOCKET_GID" dockerhost
        EXISTING_GROUP=dockerhost
    fi
    usermod -aG "$EXISTING_GROUP" appuser
fi

exec gosu appuser "$@"
