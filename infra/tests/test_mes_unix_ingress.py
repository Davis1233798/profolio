import os
from pathlib import Path
import socket
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'linux'))
from mes_unix_ingress import validate_socket_path
from mes_public_route import route_config


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
                validate_socket_path(target, os.getuid())
            target.unlink()
            with socket.socket(socket.AF_UNIX) as listener:
                listener.bind(str(target))
                target.chmod(0o600)
                validate_socket_path(target, os.getuid())
                directory.chmod(0o777)
                with self.assertRaises(ValueError):
                    validate_socket_path(target, os.getuid())
                directory.chmod(0o755)
                target.chmod(0o666)
                with self.assertRaises(ValueError):
                    validate_socket_path(target, os.getuid())
                target.chmod(0o600)
                with self.assertRaises(ValueError):
                    validate_socket_path(target, os.getuid() + 1)
                alias = Path(temporary) / 'alias'
                alias.symlink_to(directory)
                with self.assertRaises(ValueError):
                    validate_socket_path(alias / target.name, os.getuid())


if __name__ == '__main__':
    unittest.main()
