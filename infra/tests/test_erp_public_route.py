from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1] / "linux"

class ERPPublicRouteTest(unittest.TestCase):
    def test_shared_default_and_private_socket_overlay(self):
        caddy = (ROOT / "Caddyfile.sites").read_text()
        erp = caddy.split("erp.{", 1)[1].split("pos.{", 1)[0]
        self.assertIn("import suite-policy", erp)
        self.assertIn("reverse_proxy {$ERP_PUBLIC_UPSTREAM:web:8080}", erp)
        overlay = (ROOT / "compose.erp-rootless-route.yaml").read_text()
        self.assertIn("ERP_PUBLIC_UPSTREAM: unix//run/erp-ingress/upstream.sock", overlay)
        self.assertIn("/run/erp-ingress:/run/erp-ingress:ro", overlay)
