/* global window */
/*
 * 05b §8.1 / §8.4 bundled pages — shared helpers. Plain JS, no framework, no network calls: everything goes
 * through window.Capacitor.Plugins.PosNative (H-3), and each method is feature-checked (M-14).
 */
(function () {
  'use strict';

  /** The M-16 texts by probe reason (the same table as HubProbe.MESSAGES). */
  var REASON_TEXT = {
    no_hub: 'No hub at this address',
    guest: 'Connect to the staff Wi-Fi',
    not_pos: 'Not a POS hub',
    host_not_allowed: "Use the address shown on the hub's setup page (with the port)",
    starting: 'The hub is starting…',
    bad_address: 'Type the address with its port, for example 192.168.1.10:3000',
  };

  function plugin() {
    var c = window.Capacitor;
    return (c && c.Plugins && c.Plugins.PosNative) || null;
  }

  function has(name) {
    var p = plugin();
    return !!p && typeof p[name] === 'function';
  }

  /** Calls PosNative[name](arg); rejects with a readable error when the method is missing. */
  function call(name, arg) {
    if (!has(name)) return Promise.reject(new Error('This app version cannot do "' + name + '". Update the app.'));
    try {
      return Promise.resolve(plugin()[name](arg || {}));
    } catch (e) {
      return Promise.reject(e);
    }
  }

  function reasonText(r) {
    if (r && r.message) return r.message;
    return (r && REASON_TEXT[r.reason]) || REASON_TEXT.no_hub;
  }

  /** Same shape check as HubProbe.normaliseOrigin, only to give quick feedback; native has the final word. */
  function looksLikeHostPort(s) {
    return /^(http:\/\/)?[A-Za-z0-9.-]+:\d{1,5}\/?$/.test(String(s).trim());
  }

  function setMsg(el, text, kind) {
    el.textContent = text || '';
    el.className = 'msg' + (kind ? ' ' + kind : '');
  }

  /**
   * The address form (first run, and "Change hub address"). On a successful probe calls onOk(origin), where
   * origin is the `http://host:port` the probe used.
   */
  function addressForm(root, onOk) {
    root.innerHTML =
      '<div class="card">' +
      '<label for="addr">Hub address</label>' +
      '<input id="addr" type="text" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="192.168.1.10:3000">' +
      '<button id="connect" class="wide">Connect</button>' +
      '<div id="addr-msg" class="msg"></div>' +
      '</div>';
    var input = root.querySelector('#addr');
    var btn = root.querySelector('#connect');
    var msg = root.querySelector('#addr-msg');
    var busy = false;

    function connect() {
      if (busy) return;
      var raw = input.value.trim();
      if (!looksLikeHostPort(raw)) {
        setMsg(msg, REASON_TEXT.bad_address, 'error');
        return;
      }
      var origin = (/^http:\/\//i.test(raw) ? raw : 'http://' + raw).replace(/\/$/, '').toLowerCase();
      busy = true;
      btn.disabled = true;
      setMsg(msg, 'Checking…', 'info');
      call('probeHub', { origin: origin })
        .then(function (r) {
          if (r && r.ok) {
            setMsg(msg, 'Hub found', 'ok');
            onOk(origin);
          } else {
            setMsg(msg, reasonText(r), 'error');
          }
        })
        .catch(function (e) {
          setMsg(msg, (e && e.message) || REASON_TEXT.no_hub, 'error');
        })
        .then(function () {
          busy = false;
          btn.disabled = false;
        });
    }

    btn.addEventListener('click', connect);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') connect();
    });
    return { focus: function () { input.focus(); }, setValue: function (v) { input.value = v; } };
  }

  function query(name) {
    var m = new RegExp('[?&]' + name + '=([^&#]*)').exec(window.location.search);
    return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : null;
  }

  window.PosPages = {
    REASON_TEXT: REASON_TEXT,
    has: has,
    call: call,
    reasonText: reasonText,
    setMsg: setMsg,
    addressForm: addressForm,
    query: query,
  };
})();
