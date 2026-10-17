'use strict';
/* Hidden window on the computer: keeps the relay connections, answers phones' knocks, upgrades to WebRTC,
   decrypts their messages and hands them to the main process (window.host). */
(async () => {
  const A = window.FabroAnywhere;
  let boot = await host.boot();
  const identity = await A.importPriv(boot.identity);
  let relay = null, hub = null, pairing = null, relayUrls = boot.relays, ice = boot.ice;

  function makeRelay(urls) {
    const r = new A.Relay(urls, { onState: (st) => host.relays(st) });
    host.relays(r.status());
    return r;
  }
  async function makeHub(devices) {
    hub = await A.pcHub({
      relay, devices, revoked: boot.revoked || [], ice,
      info: () => ({ pcName: boot.info.pcName, vapid: boot.info.vapid }),
      onMessage: (deviceId, msg) => { if (msg && msg.t === 'bye') { host.state(deviceId, 'off'); return; } host.message(deviceId, msg); },
      onState: (deviceId, st, s) => { host.state(deviceId, st); watch(deviceId, s); },
    });
  }
  // a phone that stops answering is shown offline
  const watchers = new Map();
  function watch(id, s) {
    clearInterval(watchers.get(id));
    watchers.set(id, setInterval(() => { if (s.closed || Date.now() - s.alive > 70000) { clearInterval(watchers.get(id)); host.state(id, 'off'); } }, 10000));
  }
  async function startAll() {
    relay = makeRelay(relayUrls);
    await makeHub(boot.devices);
  }
  async function startPairing(secret) {
    if (pairing) pairing.stop();
    pairing = await A.pcPairing({
      relay, identity, secret: A.unb64u(secret),
      info: { pcName: boot.info.pcName, vapid: boot.info.vapid, relays: relayUrls, ice },
      onPaired: (dev) => { pairing = null; host.paired(dev); },
    });
  }

  host.onCommand(async (c) => {
    if (c.cmd === 'send') { const s = hub && hub.session(c.deviceId); if (s) await s.send(c.msg); }
    else if (c.cmd === 'pair-start') { if (c.relays && JSON.stringify(c.relays) !== JSON.stringify(relayUrls)) { relayUrls = c.relays; await restart(); } await startPairing(c.secret); }
    else if (c.cmd === 'pair-stop') { if (pairing) pairing.stop(); pairing = null; }
    else if (c.cmd === 'add') { await hub.add(c.device); }
    else if (c.cmd === 'remove') { await hub.remove(c.deviceId, c.notify); }
    else if (c.cmd === 'bye-all') { for (const id of hub ? hub.ids() : []) { const s = hub.session(id); if (s) s.send({ t: 'bye' }); } }
    else if (c.cmd === 'config') { relayUrls = c.relays; ice = c.ice; await restart(); }
  });
  async function restart() {
    const ids = hub ? hub.ids() : [];
    if (relay) relay.close();
    boot = await host.boot();
    relay = makeRelay(relayUrls);
    await makeHub(boot.devices);
    for (const id of ids) if (!boot.devices.some((d) => d.id === id)) host.state(id, 'off');
  }
  await startAll();
})();
