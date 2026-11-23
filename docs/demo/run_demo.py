"""Sobe o BIHoster de demonstracao: backend com banco temporario novo, apontado para o Power BI de mentira.

Nao altera nenhum arquivo do sistema: troca, so nesta execucao, os dois enderecos do Power BI que o backend usa
(ficam como constantes em app/core/powerbi.py) e liga o servidor. O banco e os arquivos ficam numa pasta temporaria.

Uso (a partir de qualquer pasta):
    python docs/demo/run_demo.py
Depois, em outro terminal:
    python docs/demo/seed_demo.py                      # cria conexao, colecoes e relatorios de demonstracao
    cd frontend; VITE_API_URL=http://localhost:8000 npm run dev -- --port 5180
"""

import os
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEMO_DIR = Path(os.environ.get("DEMO_DIR") or Path(tempfile.gettempdir()) / "bihoster-demo")
PORT = int(os.environ.get("DEMO_API_PORT", "8000"))
FRONTEND_ORIGIN = os.environ.get("DEMO_FRONTEND_ORIGIN", "http://localhost:5180")

# Sempre comeca do zero: a demonstracao nao pode herdar dado de uma execucao anterior
if DEMO_DIR.exists():
    shutil.rmtree(DEMO_DIR)
DEMO_DIR.mkdir(parents=True)

os.environ["DATABASE_URL"] = "sqlite:///" + (DEMO_DIR / "demo.db").as_posix()
os.environ["DATA_DIR"] = str(DEMO_DIR)
os.environ["CORS_ORIGINS"] = FRONTEND_ORIGIN

sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
os.chdir(ROOT / "backend")

import fake_powerbi  # noqa: E402

fake_powerbi.start(fake_powerbi.PORT)

from app.core import powerbi  # noqa: E402

powerbi.AAD_TOKEN_URL = f"http://127.0.0.1:{fake_powerbi.PORT}" + "/{tenant_id}/oauth2/v2.0/token"
powerbi.POWERBI_API_BASE = f"http://127.0.0.1:{fake_powerbi.PORT}/v1.0/myorg"

import uvicorn  # noqa: E402

print(f"BIHoster de demonstracao em http://127.0.0.1:{PORT} (dados em {DEMO_DIR})")
uvicorn.run("app.main:app", host="127.0.0.1", port=PORT, log_level="warning")
