// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 lucamaf

import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {QuickMenuToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const POLL_SECONDS = 5;

function run(argv) {
    return new Promise(resolve => {
        try {
            const p = Gio.Subprocess.new(argv,
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_MERGE);
            p.communicate_utf8_async(null, null, (proc, res) => {
                try {
                    const [, out] = proc.communicate_utf8_finish(res);
                    resolve({ok: proc.get_successful(), out: out ?? ''});
                } catch (e) {
                    resolve({ok: false, out: String(e)});
                }
            });
        } catch (e) {
            resolve({ok: false, out: String(e)});
        }
    });
}

async function tailscaleUp() {
    const r = await run(['tailscale', 'status', '--json']);
    if (!r.ok) return false;
    try {
        return JSON.parse(r.out).BackendState === 'Running';
    } catch (_e) {
        return false;
    }
}

async function netbirdUp() {
    const r = await run(['netbird', 'status']);
    return r.ok && /Management:\s*Connected/.test(r.out);
}

let helperPath = null;

// Runs the whole down / restart-resolved / up sequence as root via the helper
// shipped inside the extension (both VPN CLIs and systemd-resolved need root).
function switchTo(target) {
    return run(['pkexec', helperPath, target]);
}

const VpnToggle = GObject.registerClass({
    Signals: {'refresh-requested': {}},
},
class VpnToggle extends QuickMenuToggle {
    _init() {
        super._init({title: 'VPN', iconName: 'network-vpn-symbolic', toggleMode: false});
        this.menu.setHeader('network-vpn-symbolic', 'VPN Switch', 'Only one VPN at a time');
        this._busy = false;
        this._items = {};
        const section = new PopupMenu.PopupMenuSection();
        for (const [id, label] of [['tailscale', 'Tailscale'], ['netbird', 'NetBird'], ['off', 'Disconnect all']]) {
            const item = new PopupMenu.PopupMenuItem(label);
            item.connect('activate', () => this._select(id));
            this._items[id] = item;
            section.addMenuItem(item);
        }
        this.menu.addMenuItem(section);
        // Clicking the tile itself: toggle off if something is on, else open menu.
        this.connect('clicked', () => this.menu.open());
    }

    setActive(state) {
        this._state = state;
        for (const [id, item] of Object.entries(this._items))
            item.setOrnament(id === state ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NONE);
        this.checked = state === 'tailscale' || state === 'netbird' || state === 'both';
        this.subtitle = {
            tailscale: 'Tailscale', netbird: 'NetBird', off: 'Off',
            both: 'Both up (conflict!)',
        }[state] ?? '…';
    }

    async _select(id) {
        if (this._busy) return;
        this._busy = true;
        this.subtitle = 'Switching…';
        const r = await switchTo(id);
        this._busy = false;
        if (!r.ok) Main.notifyError('VPN Switch', r.out.trim().slice(0, 300));
        this.emit('refresh-requested');
    }
});

const VpnIndicator = GObject.registerClass(
class VpnIndicator extends SystemIndicator {
    _init() {
        super._init();
        this.toggle = new VpnToggle();
        this.quickSettingsItems.push(this.toggle);
    }
});

export default class VpnSwitchExtension extends Extension {
    enable() {
        helperPath = GLib.build_filenamev([this.path, 'vpn-switch-helper']);
        this._indicator = new VpnIndicator();
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
        this._indicator.toggle.connect('refresh-requested', () => this._refresh());
        this._refresh();
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, POLL_SECONDS, () => {
            this._refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    async _refresh() {
        const toggle = this._indicator?.toggle;
        if (!toggle || toggle._busy) return;
        const [ts, nb] = await Promise.all([tailscaleUp(), netbirdUp()]);
        if (!this._indicator || toggle._busy) return;
        toggle.setActive(ts && nb ? 'both' : ts ? 'tailscale' : nb ? 'netbird' : 'off');
    }

    disable() {
        if (this._timer) GLib.source_remove(this._timer);
        this._timer = null;
        this._indicator?.toggle.destroy();
        this._indicator?.destroy();
        this._indicator = null;
        helperPath = null;
    }
}
