"""Power BI de mentira, so para gravar o GIF de demonstracao do README.

Responde o minimo que o BIHoster pede ao Azure AD e a API do Power BI (token, detalhes do relatorio, paginas,
embed token, dataset, historico de atualizacao e exportacao em PNG para as miniaturas) e serve, no lugar do
relatorio embutido, uma pagina HTML de dashboard com numeros INVENTADOS (demo_data.json). Nada aqui fala com a
internet nem usa dado real.

Uso isolado: python fake_powerbi.py   (sobe em http://127.0.0.1:8765)
Normalmente quem sobe e o run_demo.py, junto com o backend."""

import json
import re
import struct
import threading
import zlib
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = json.loads((HERE / "demo_data.json").read_text(encoding="utf-8"))
COLORS = DATA["colors"]
REPORTS = DATA["reports"]
TEMPLATE = (HERE / "embed_template.html").read_text(encoding="utf-8")
PORT = 8765


def _rgb(hex_color: str) -> bytes:
    value = hex_color.lstrip("#")
    return bytes(int(value[i : i + 2], 16) for i in (0, 2, 4))


# --- A pagina que faz o papel do relatorio embutido ---------------------------------------------------------


def _delta_class(text: str) -> str:
    return "down" if text.strip().startswith("-") else "up"


def render_embed(report_id: str) -> str:
    report = REPORTS[report_id]
    kpis = "".join(
        f'<div class="kpi"><span>{label}</span><b>{value}</b><i class="{_delta_class(delta)}">{delta}</i></div>'
        for label, value, delta in report["kpis"]
    )
    top = max(value for _, value in report["bars"])
    bars = "".join(
        f'<div class="bar"><span>{name}</span><div><u style="width:{value / top * 100:.0f}%"></u></div><em>{value:,}</em></div>'.replace(",", ".")
        for name, value in report["bars"]
    )
    line = report["line"]
    low, high = min(line), max(line)
    span = (high - low) or 1
    points = [(10 + i * (380 / (len(line) - 1)), 140 - (v - low) / span * 120) for i, v in enumerate(line)]
    polyline = " ".join(f"{x:.1f},{y:.1f}" for x, y in points)
    area = f"10,140 {polyline} 390,140"
    chart = (
        f'<svg viewBox="0 0 400 150" preserveAspectRatio="none">'
        f'<polygon points="{area}" fill="{report["accent"]}" fill-opacity="0.12"/>'
        f'<polyline points="{polyline}" fill="none" stroke="{report["accent"]}" stroke-width="2.5"/>'
        f'<circle cx="{points[-1][0]:.1f}" cy="{points[-1][1]:.1f}" r="4" fill="{report["accent"]}"/></svg>'
    )
    rows = "".join(
        f'<tr><td>{a}</td><td>{b}</td><td class="{_delta_class(c) if c[:1] in "+-" else ""}">{c}</td></tr>'
        for a, b, c in report["rows"]
    )
    values = {
        "TITLE": report["name"],
        "ACCENT": report["accent"],
        "INK": COLORS["ink"],
        "BG": COLORS["bg"],
        "MUTED": COLORS["muted"],
        "LINE": COLORS["line"],
        "CARD": COLORS["card"],
        "POSITIVE": COLORS["positive"],
        "NEGATIVE": COLORS["negative"],
        "KPIS": kpis,
        "BARS_TITLE": report["bars_title"],
        "BARS": bars,
        "LINE_TITLE": report["line_title"],
        "LINE": chart,
        "TABLE_TITLE": report["table_title"],
        "ROWS": rows,
    }
    html = TEMPLATE
    for key, value in values.items():
        html = html.replace("{{" + key + "}}", str(value))
    return html


# --- A miniatura (PNG) do relatorio, desenhada sem nenhuma biblioteca de imagem ------------------------------


def _png(width: int, height: int, rows: list[bytearray]) -> bytes:
    raw = b"".join(b"\x00" + bytes(row) for row in rows)

    def chunk(tag: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + tag + body + struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b"")


def render_thumbnail(report_id: str, width: int = 640, height: int = 360) -> bytes:
    report = REPORTS[report_id]
    accent = _rgb(report["accent"])
    rows = [bytearray(_rgb(COLORS["bg"]) * width) for _ in range(height)]

    def rect(x0: int, y0: int, x1: int, y1: int, color: bytes) -> None:
        for y in range(max(y0, 0), min(y1, height)):
            rows[y][max(x0, 0) * 3 : min(x1, width) * 3] = color * (min(x1, width) - max(x0, 0))

    card = _rgb(COLORS["card"])
    rect(30, 28, 38, 58, accent)  # barra de titulo
    rect(50, 36, 240, 50, _rgb(COLORS["ink"]))
    for i in range(3):  # tres indicadores
        x = 30 + i * 200
        rect(x, 80, x + 184, 150, card)
        rect(x, 80, x + 184, 84, accent)
        rect(x + 14, 98, x + 80, 106, _rgb(COLORS["muted"]))
        rect(x + 14, 116, x + 120, 136, _rgb(COLORS["ink"]))
    values = [v for _, v in report["bars"]]
    top = max(values)
    for i, value in enumerate(values[:5]):  # barras horizontais
        y = 176 + i * 34
        rect(30, y, 100, y + 14, card)
        rect(110, y, 110 + int(value / top * 230), y + 14, accent)
    # grafico de area com linha: para cada coluna de pixels, o valor vem da interpolacao entre os pontos da serie
    line = report["line"]
    low, high = min(line), max(line)
    left, right, floor, ceiling = 380, 612, 330, 190
    soft = bytes(int(channel * 0.16 + 255 * 0.84) for channel in accent)  # a cor da marca bem clara, para a area
    for x in range(left, right):
        position = (x - left) / (right - left) * (len(line) - 1)
        index = min(int(position), len(line) - 2)
        value = line[index] + (line[index + 1] - line[index]) * (position - index)
        y = floor - int((value - low) / ((high - low) or 1) * (floor - ceiling))
        rect(x, y, x + 1, floor, soft)
        rect(x, y - 1, x + 1, y + 2, accent)
    return _png(width, height, rows)


# --- A API do Power BI e do Azure AD ------------------------------------------------------------------------

_REPORT = re.compile(r"^/v1\.0/myorg/groups/([^/]+)/reports/([^/]+)(/.*)?$")
_DATASET = re.compile(r"^/v1\.0/myorg/groups/([^/]+)/datasets/([^/]+)(/.*)?$")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args) -> None:  # silencioso: o backend ja loga o que importa
        pass

    def _send(self, status: int, body: bytes, content_type: str = "application/json") -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, payload, status: int = 200) -> None:
        self._send(status, json.dumps(payload).encode("utf-8"))

    def do_POST(self) -> None:
        path = self.path.split("?")[0]
        length = int(self.headers.get("Content-Length") or 0)
        if length:
            self.rfile.read(length)  # corpo ignorado: so interessa responder
        if path.endswith("/oauth2/v2.0/token"):
            return self._json({"access_token": "token-de-demonstracao", "expires_in": 3600, "token_type": "Bearer"})
        report = _REPORT.match(path)
        if report and (report.group(3) or "").endswith("/GenerateToken"):
            expiration = (datetime.now(timezone.utc) + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
            return self._json({"token": "embed-de-demonstracao", "tokenId": "demo", "expiration": expiration})
        if report and (report.group(3) or "").endswith("/ExportTo"):
            return self._json({"id": report.group(2), "status": "Running", "percentComplete": 0}, 202)
        if _DATASET.match(path) and path.endswith("/refreshes"):
            return self._send(202, b"{}")
        self._json({"error": {"code": "NotFound", "message": "Rota nao simulada"}}, 404)

    def do_GET(self) -> None:
        path, _, _query = self.path.partition("?")
        if path.startswith("/embed/"):
            report_id = path.rsplit("/", 1)[-1]
            if report_id in REPORTS:
                return self._send(200, render_embed(report_id).encode("utf-8"), "text/html; charset=utf-8")
        report = _REPORT.match(path)
        if report:
            report_id, rest = report.group(2), report.group(3) or ""
            if report_id not in REPORTS:
                return self._json({"error": {"code": "NotFound"}}, 404)
            if rest == "":
                return self._json(
                    {
                        "id": report_id,
                        "name": REPORTS[report_id]["name"],
                        # A biblioteca do Power BI no navegador so aceita HTTPS e um dominio *.powerbi.com. O servidor da
                        # demo (serve_demo.py) troca este endereco pela pagina de mentira antes de o iframe carregar.
                        "embedUrl": f"https://bihoster-demo.powerbi.com/reportEmbed?reportId={report_id}",
                        "datasetId": f"ds-{report_id}",
                    }
                )
            if rest == "/pages":
                return self._json({"value": [{"name": "ReportSection1", "displayName": "Visão geral", "order": 0}]})
            if rest.startswith("/exports/") and rest.endswith("/file"):
                return self._send(200, render_thumbnail(report_id), "image/png")
            if rest.startswith("/exports/"):
                return self._json({"status": "Succeeded", "percentComplete": 100})
        dataset = _DATASET.match(path)
        if dataset:
            rest = dataset.group(3) or ""
            if rest == "":
                return self._json({"id": dataset.group(2), "isEffectiveIdentityRequired": False, "isEffectiveIdentityRolesRequired": False})
            if rest == "/refreshes":
                ended = (datetime.now(timezone.utc) - timedelta(hours=3)).strftime("%Y-%m-%dT%H:%M:%SZ")
                return self._json({"value": [{"status": "Completed", "endTime": ended, "refreshType": "Scheduled"}]})
            if rest == "/refreshSchedule":
                return self._json({"enabled": True, "times": ["06:00"], "days": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], "localTimeZoneId": "UTC"})
        self._json({"error": {"code": "NotFound", "message": "Rota nao simulada"}}, 404)


def start(port: int = PORT) -> ThreadingHTTPServer:
    """Sobe o servidor numa thread e devolve ele (server.shutdown() desliga)."""
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    threading.Thread(target=server.serve_forever, name="powerbi-de-mentira", daemon=True).start()
    return server


if __name__ == "__main__":
    print(f"Power BI de mentira em http://127.0.0.1:{PORT} (Ctrl+C para sair)")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
