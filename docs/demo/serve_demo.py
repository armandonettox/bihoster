"""Serve o frontend ja compilado e repassa /api e /static ao backend, como o nginx faz em producao.

Por que nao usar o servidor de desenvolvimento do Vite: as miniaturas dos relatorios sao pedidas em /static/... na propria
origem da pagina, e so o nginx (ou este servidor) repassa isso ao backend.

Alem disso, so nesta demonstracao, injeta na pagina um trecho que redireciona o iframe do relatorio: a biblioteca do Power
BI recusa qualquer endereco que nao seja HTTPS de um dominio *.powerbi.com, entao o backend de demonstracao devolve
https://bihoster-demo.powerbi.com/... e este trecho troca por /demo-embed/<relatorio>, a pagina de mentira local. Nenhum
pedido chega a sair para a internet, e o codigo do sistema nao e alterado.

Uso (a partir de qualquer pasta):
    cd frontend; VITE_API_URL=/api npm run build      # gera frontend/dist
    python docs/demo/serve_demo.py                     # http://localhost:5180
"""

import mimetypes
import os
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
BACKEND = os.environ.get("DEMO_BACKEND", "http://127.0.0.1:8000")
FAKE_POWERBI = os.environ.get("DEMO_POWERBI", "http://127.0.0.1:8765")
PORT = int(os.environ.get("DEMO_WEB_PORT", "5180"))
_HOP = {"connection", "transfer-encoding", "content-length", "server", "date"}

SHIM = """<script>
(function () {
  var original = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if (this.tagName === 'IFRAME' && name === 'src' && typeof value === 'string') {
      var match = /^https:\\/\\/bihoster-demo\\.powerbi\\.com\\/reportEmbed\\?reportId=([^&]+)/.exec(value);
      if (match) value = '/demo-embed/' + match[1];
    }
    return original.call(this, name, value);
  };
})();
</script>"""


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args) -> None:
        pass

    def _proxy(self, base: str, target: str) -> None:
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None
        headers = {k: v for k, v in self.headers.items() if k.lower() not in ("host", "connection", "content-length")}
        request = urllib.request.Request(base + target, data=body, headers=headers, method=self.command)
        try:
            response = urllib.request.urlopen(request, timeout=60)
        except urllib.error.HTTPError as error:
            response = error
        data = response.read()
        self.send_response(response.status if hasattr(response, "status") else response.code)
        for key, value in response.headers.items():
            if key.lower() not in _HOP:
                self.send_header(key, value)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _file(self) -> None:
        relative = self.path.split("?")[0].lstrip("/")
        candidate = (DIST / relative).resolve()
        # Nunca sai da pasta dist; qualquer rota que nao seja arquivo cai no index.html (SPA)
        if not (candidate.is_file() and DIST in candidate.parents):
            candidate = DIST / "index.html"
        data = candidate.read_bytes()
        if candidate.name == "index.html":
            data = data.replace(b"<head>", b"<head>" + SHIM.encode("utf-8"), 1)
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(candidate.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _route(self) -> None:
        if self.path.startswith("/api/"):
            return self._proxy(BACKEND, self.path[len("/api") :])
        if self.path.startswith("/static/"):
            return self._proxy(BACKEND, self.path)
        if self.path.startswith("/demo-embed/"):
            return self._proxy(FAKE_POWERBI, "/embed/" + self.path.split("?")[0].rsplit("/", 1)[-1])
        self._file()

    do_GET = do_POST = do_PUT = do_DELETE = do_PATCH = _route


if __name__ == "__main__":
    print(f"Frontend de demonstracao em http://localhost:{PORT} (backend em {BACKEND})")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
