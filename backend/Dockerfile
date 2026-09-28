FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Docker CLI + plugin de compose -- necessarios pra aba Atualizacoes (core/system_update.py)
# rodar `docker compose pull && up -d` contra o daemon do HOST via socket montado. So o
# binario, sem daemon proprio dentro do container (docker-outside-of-docker). `gosu` deixa o
# container iniciar como root (pra ajustar o grupo do socket em runtime, ver
# docker-entrypoint.sh) e depois trocar pro appuser sem privilegio antes do uvicorn rodar.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gnupg gosu \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
    && chmod a+r /etc/apt/keyrings/docker.asc \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" \
       > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends docker-ce-cli docker-compose-plugin \
    && rm -rf /var/lib/apt/lists/*

COPY app ./app

RUN mkdir -p /app/static/uploads /app/data

ENV DATABASE_URL=sqlite:////app/data/bihoster.db
# JWT_SECRET/ENCRYPTION_KEY sao gerados automaticamente no primeiro boot e persistidos aqui
# (ver core/bootstrap_secrets.py) se nao forem passados via variavel de ambiente -- assim
# `docker compose up -d` funciona sem nenhuma configuracao previa, igual outros self-hosted
# (Metabase, etc). Quem quiser definir os proprios secrets continua podendo via env var.
ENV DATA_DIR=/app/data

# Versao gravada em arquivo (nao so env var) pra nao poder ser falsificada por uma variavel de
# ambiente esquecida no host -- o CI passa a tag real (ex: 1.4.0) no build de release; builds
# locais/dev ficam com "dev". Lido por core/config.py.
ARG APP_VERSION=dev
RUN echo "${APP_VERSION}" > /app/VERSION

# Nao roda como root -- um container comprometido (ex: futura vulnerabilidade de dependencia)
# fica limitado a um usuario sem privilegios em vez de root dentro do container. O container
# ainda SOBE como root (ver USER abaixo) so pra o entrypoint conseguir ajustar o grupo do
# socket do Docker em runtime -- ele mesmo troca pro appuser via gosu antes do uvicorn rodar.
RUN useradd --create-home --shell /bin/false appuser \
    && chown -R appuser:appuser /app
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["docker-entrypoint.sh"]
# --workers 1 e obrigatorio, nao so o default: os caches de token/embed do Power BI e o lock de
# bootstrap do grupo Administradores (core/workspace_deps.py) vivem em memoria de um unico
# processo -- rodar com mais workers reintroduz as race conditions que esses locks existem
# pra evitar, e deixa os caches inconsistentes entre processos.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
