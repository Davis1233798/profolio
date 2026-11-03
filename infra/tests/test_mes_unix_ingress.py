import os
from pathlib import Path
import socket
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'linux'))
from mes_public_route import route_config, validate_socket_path


class UnixIngressTests(unittest.TestCase):
    def test_rootless_route_is_fixed_and_has_no_cross_daemon_network(self):
        config = route_config('rootless')
        self.assertEqual(config['upstream'], 'unix//run/mes-ingress/upstream.sock')
        self.assertEqual(config['overlay'], 'linux/compose.mes-rootless-route.yaml')
        self.assertIsNone(config['network'])

    def test_socket_boundary_rejects_files_links_and_writable_directory(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary) / 'mes-ingress'
            directory.mkdir(mode=0o755)
            target = directory / 'upstream.sock'
            target.write_text('not a socket')
            with self.assertRaises(ValueError):
                validate_socket_path(target, os.getuid(), require_root_path=False)
            target.unlink()
            with socket.socket(socket.AF_UNIX) as listener:
                listener.bind(str(target))
                target.chmod(0o600)
                validate_socket_path(target, os.getuid(), require_root_path=False)
                directory.chmod(0o777)
                with self.assertRaises(ValueError):
                    validate_socket_path(target, os.getuid(), require_root_path=False)
                directory.chmod(0o755)
                target.chmod(0o666)
                with self.assertRaises(ValueError):
                    validate_socket_path(target, os.getuid(), require_root_path=False)
                target.chmod(0o600)
                with self.assertRaises(ValueError):
                    validate_socket_path(target, os.getuid() + 1, require_root_path=False)
                alias = Path(temporary) / 'alias'
                alias.symlink_to(directory)
                with self.assertRaises(ValueError):
                    validate_socket_path(alias / target.name, os.getuid(), require_root_path=False)

    def test_socket_path_is_fixed_in_production(self):
        with self.assertRaises(ValueError):
            validate_socket_path('/tmp/attacker.sock')

    def test_systemd_proxy_is_unprivileged_and_confined_to_local_upstream(self):
        root = Path(__file__).resolve().parents[1] / 'linux'
        socket_unit = (root / 'mes-ingress.socket').read_text(encoding='utf-8')
        service_unit = (root / 'mes-ingress.service').read_text(encoding='utf-8')
        self.assertIn('ListenStream=/run/mes-ingress/upstream.sock', socket_unit)
        self.assertIn('SocketMode=0600', socket_unit)
        self.assertIn('SocketUser=root', socket_unit)
        self.assertIn('DynamicUser=yes', service_unit)
        self.assertIn('NoNewPrivileges=yes', service_unit)
        self.assertIn('ProtectSystem=strict', service_unit)
        self.assertIn('127.0.0.1:18095', service_unit)
        self.assertNotIn('docker.sock', service_unit)


if __name__ == '__main__':
    unittest.main()
