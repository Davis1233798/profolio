"""Verify station login limits through the production Caddy route in remote CI."""

import http.client
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import uuid


HOST = "station.example.test"


def client(mode):
    if mode == "ready":
        for attempt in range(30):
            try:
                if request("edge", 80, "GET", "/api/health") == 200:
                    return
            except (OSError, http.client.HTTPException):
                pass
            time.sleep(1)
        raise AssertionError("station health did not become available through Caddy")

    if mode == "exhaust":
        for attempt in range(21):
            expected = 401 if attempt < 20 else 429
            # Caddy must replace each attempted spoof with the socket peer.
            check_login("edge", 80, f"192.0.2.{attempt + 1}", expected)
        check_login("station", 8095, "198.51.100.1", 429)
    elif mode == "independent":
        check_login("edge", 80, "192.0.2.21", 401)
        check_login("station", 8095, "192.0.2.21", 401)
    else:
        raise ValueError(f"unknown test mode: {mode}")


def request(host, port, method, path, body=None, claimed_address=None):
    headers = {"Host": HOST}
    if body is not None:
        headers["Content-Type"] = "application/json"
        headers["X-Suite-Station-Client-IP"] = claimed_address
    connection = http.client.HTTPConnection(host, port, timeout=5)
    try:
        connection.request(method, path, body, headers)
        response = connection.getresponse()
        response.read()
        return response.status
    finally:
        connection.close()


def check_login(host, port, claimed_address, expected):
    body = json.dumps({
        "site": "mes",
        "email": "viewer@suite.test",
        "password": "incorrect-ci-only",
    })
    status = request(host, port, "POST", "/api/auth/login", body, claimed_address)
    if status != expected:
        raise AssertionError(f"{host} login returned {status}, expected {expected}")


def main():
    root = Path(__file__).resolve().parents[2]
    production_config = subprocess.check_output(
        ["docker", "compose", "-f", "infra/linux/compose.stations.yaml", "config", "--format", "json"],
        cwd=root,
        env={**os.environ, "GATEWAY_TOKEN": "ci-fixture-only"},
        text=True,
    )
    station = json.loads(production_config)["services"]["station"]
    if station.get("ports"):
        raise AssertionError("public station must be reached through the edge")
    edge_host = station["environment"]["SUITE_STATION_TRUSTED_EDGE_HOST"]
    source = (root / "infra/linux/Caddyfile.sites").read_text(encoding="utf-8")
    route = 'station.{$BASE_DOMAIN} {'
    offset = source.index(route)

    with tempfile.TemporaryDirectory(prefix="station-login-edge-") as tmp:
        directory = Path(tmp)
        caddyfile = directory / "Caddyfile"
        caddyfile.write_text("http://" + source[offset:], encoding="utf-8")
        client_service = {
            "image": "python:3.12-alpine",
            "command": ["python", "-c", "import time; time.sleep(900)"],
            "volumes": [f"{Path(__file__).resolve()}:/check.py:ro"],
        }
        compose_file = directory / "compose.json"
        compose_file.write_text(json.dumps({"services": {
            "edge": {
                "image": "caddy:2.10-alpine",
                "environment": {"BASE_DOMAIN": HOST.removeprefix("station.")},
                "volumes": [f"{caddyfile}:/etc/caddy/Caddyfile:ro"],
            },
            "station": {
                "image": "debian:bookworm-slim",
                "entrypoint": ["/station-server"],
                "environment": {
                    "SUITE_DB": "/tmp/stations.sqlite",
                    "SUITE_WEB": "/web-dist",
                    "SUITE_ADDR": "0.0.0.0:8095",
                    "SUITE_STATION_TRUSTED_EDGE_HOST": edge_host,
                },
                "volumes": [
                    f"{root / 'release/station-server'}:/station-server:ro",
                    f"{root / 'web-dist'}:/web-dist:ro",
                ],
            },
            "client-a": client_service,
            "client-b": client_service,
        }}), encoding="utf-8")
        project = "station-login-edge-" + uuid.uuid4().hex[:12]
        compose = ["docker", "compose", "-p", project, "-f", str(compose_file)]
        try:
            subprocess.run(compose + ["up", "-d"], check=True, timeout=120)
            for service, mode in [("client-a", "ready"), ("client-a", "exhaust"), ("client-b", "independent")]:
                subprocess.run(compose + ["exec", "-T", service, "python", "/check.py", mode], check=True, timeout=70)
            print("Station login limiter rejected a spoofed address and preserved separate visitor budgets.")
        finally:
            subprocess.run(compose + ["down", "--volumes", "--remove-orphans"], check=True, timeout=60)


if __name__ == "__main__":
    if len(sys.argv) == 2:
        client(sys.argv[1])
    else:
        main()
