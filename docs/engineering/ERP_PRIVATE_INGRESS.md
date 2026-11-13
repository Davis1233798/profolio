# ERP private ingress

The ERP container listens on host loopback port 18096. A systemd socket
proxies that listener through a root-owned Unix socket. Verify the private
socket returns the same release revision and access controls as loopback.
Public routing requires the separate data cutover and Caddy configuration.
