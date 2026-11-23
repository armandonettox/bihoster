"""Cria os dados de demonstracao no BIHoster de demonstracao (run_demo.py precisa estar rodando).

Cria a conta de administrador, a conexao com o Power BI de mentira, tres colecoes e seis relatorios, e pede as
miniaturas. Tudo fictício: nomes e numeros vem de demo_data.json.

Uso: python docs/demo/seed_demo.py"""

import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

API = "http://127.0.0.1:8000"
EMAIL = "demo@example.com"
PASSWORD = "DemoSenha123"
DATA = json.loads((Path(__file__).resolve().parent / "demo_data.json").read_text(encoding="utf-8"))


def call(method: str, path: str, body=None, token: str | None = None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(
        API + path, data=json.dumps(body).encode("utf-8") if body is not None else None, headers=headers, method=method
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        print(f"ERRO {method} {path}: {exc.code} {exc.read().decode('utf-8', 'replace')[:300]}", file=sys.stderr)
        raise


def main() -> None:
    call("POST", "/auth/register", {"name": "Pessoa Demonstração", "email": EMAIL, "password": PASSWORD})
    token = call("POST", "/auth/login", {"email": EMAIL, "password": PASSWORD})["access_token"]

    connection = call(
        "POST",
        "/powerbi-connections/",
        {"name": "Power BI de demonstração", "tenant_id": "demo-tenant", "client_id": "demo-client", "client_secret": "demo-secret"},
        token,
    )

    for collection in DATA["collections"]:
        workspace = call("POST", "/workspaces/", {"name": collection["name"]}, token)
        for key in collection["reports"]:
            report = call(
                "POST",
                f"/workspaces/{workspace['id']}/reports/",
                {
                    "name": DATA["reports"][key]["name"],
                    "powerbi_connection_id": connection["id"],
                    "pbi_workspace_id": "demo-workspace",
                    "pbi_report_id": key,
                    "pbi_dataset_id": f"ds-{key}",
                },
                token,
            )
            job = call("POST", f"/workspaces/{workspace['id']}/reports/{report['id']}/thumbnail", {}, token)
            for _ in range(30):
                status = call("GET", f"/workspaces/{workspace['id']}/reports/{report['id']}/thumbnail/jobs/{job['job_id']}", token=token)
                if status.get("status") in ("done", "success", "completed", "error", "failed"):
                    break
                time.sleep(1)
            print(f"  {collection['name']}: {report['name']} ({status.get('status')})")
    print(f"Pronto. Entre com {EMAIL} / {PASSWORD}.")


if __name__ == "__main__":
    main()
