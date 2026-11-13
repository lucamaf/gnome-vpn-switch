# VPN Switch

A GNOME Shell extension that adds a **VPN** tile to the Quick Settings panel for switching between **Tailscale** and **NetBird**.

The two clients conflict when running together (routes and DNS), so only one can be active at a time. The tile shows which one is up and lets you pick:

- **Tailscale**
- **NetBird**
- **Disconnect all**

If both are somehow up, the tile shows "Both up (conflict!)". Status is polled every 5 seconds.

## Requirements

- GNOME Shell 50
- `tailscale` and `netbird` CLIs installed, with their daemons running
- `systemd-resolved` and `pkexec` (polkit)

## Install

From extensions.gnome.org (once published), or manually:

```sh
git clone https://github.com/lucamaf/gnome-vpn-switch.git ~/.local/share/gnome-shell/extensions/vpn-switch@lucamaf
```

Then log out and back in (Wayland) and enable it:

```sh
gnome-extensions enable vpn-switch@lucamaf
```

## How switching works

Both VPN CLIs and the `systemd-resolved` restart need root, so the extension runs the bundled `vpn-switch-helper` through `pkexec`. You will be asked to authenticate on every switch. The helper is a short bash script that:

1. runs `netbird down` and `tailscale down`
2. restarts `systemd-resolved` (clears stale DNS left by the other VPN)
3. runs `tailscale up` or `netbird up` for the chosen target

The helper accepts only `tailscale`, `netbird` or `off`. Read it before installing: [vpn-switch-helper](vpn-switch-helper).

## Build the extension zip

```sh
gnome-extensions pack . --extra-source=vpn-switch-helper --extra-source=LICENSE --force
```

## License

GPL-2.0-or-later. See [LICENSE](LICENSE).
