(function () {
  'use strict';

  if (window.sitebot) return;

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function labelForUrl(url, sources) {
    if (sources) {
      for (var i = 0; i < sources.length; i++) {
        if (sources[i].url === url && sources[i].title) {
          return sources[i].title;
        }
      }
    }
    return 'see link';
  }

  function renderInline(text, sources) {
    text = String(text).replace(/^([ \t]*)- (?=\S)/gm, '$1• ');
    var out = '';
    var i = 0;
    while (i < text.length) {
      var rest = text.slice(i);
      var m;
      if ((m = /^\*\*([^*\n]+)\*\*/.exec(rest))) {
        out += '<strong>' + renderInline(m[1], sources) + '</strong>';
        i += m[0].length;
      } else if ((m = /^\*([^*\n]+)\*/.exec(rest))) {
        out += '<em>' + renderInline(m[1], sources) + '</em>';
        i += m[0].length;
      } else if ((m = /^https?:\/\/[^\s<]+/.exec(rest))) {
        var url = m[0].replace(/[.,;:!?)\]]+$/, '');
        out +=
          '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener">' +
          escapeHtml(labelForUrl(url, sources)) + '</a>';
        i += m[0].length;
      } else {
        var next = rest.search(/[*]|https?:\/\//);
        var end = next === -1 ? rest.length : next;
        out += escapeHtml(rest.slice(0, end));
        i += end;
      }
    }
    return out;
  }

  function renderMessage(text, sources) {
    var parts = [];
    var regex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
    var last = 0;
    var match;
    while ((match = regex.exec(text)) !== null) {
      if (match.index > last) parts.push({ text: text.slice(last, match.index) });
      parts.push({ label: match[1], url: match[2] });
      last = regex.lastIndex;
    }
    if (last < text.length) parts.push({ text: text.slice(last) });

    var html = '';
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      if (part.url) {
        html +=
          '<a href="' + escapeHtml(part.url) + '" target="_blank" rel="noopener">' +
          escapeHtml(part.label) + '</a>';
      } else {
        html += renderInline(part.text, sources);
      }
    }
    return html;
  }

  function createWidget(opts) {
    var siteId = opts.siteId;
    var API_URL = (opts.apiUrl || '').replace(/\/$/, '');
    var COLOR = opts.color || '#4f46e5';
    var TITLE = opts.title || 'Assistant';
    var GREETING = opts.greeting || 'Hi! How can I help you?';
    var POSITION = opts.position === 'left' ? 'left' : 'right';
    var container = opts.container || document.body;
    var storageKey = 'sitebot:session:' + siteId;

    var sessionId = null;
    try {
      sessionId = localStorage.getItem(storageKey);
    } catch (e) {}

    var host = document.createElement('div');
    host.setAttribute('data-sitebot', '');
    host.setAttribute('data-sitebot-site', siteId);
    container.appendChild(host);
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

    // If the brand color is very light, an outline in the same color would
    // be invisible on white (focus ring, user bubble text). We compute the
    // relative luminance and fall back to a fixed dark tone in that case.
    function isLightColor(hex) {
      var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      if (!m) return false;
      var r = parseInt(m[1], 16) / 255;
      var g = parseInt(m[2], 16) / 255;
      var b = parseInt(m[3], 16) / 255;
      var luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      return luminance > 0.6;
    }
    var FOCUS_COLOR = isLightColor(COLOR) ? '#0f172a' : COLOR;

    var style = document.createElement('style');
    style.textContent = [
      // `all:initial` does not reset custom properties declared in the
      // same rule, so --sb-color remains available throughout the tree.
      ':host{all:initial;--sb-color:' + COLOR + ';--sb-focus:' + FOCUS_COLOR + '}',
      '*{box-sizing:border-box}',
      '.sb-launcher{position:fixed;bottom:20px;' + POSITION + ':20px;width:56px;height:56px;border-radius:50%;background:var(--sb-color);border:none;cursor:pointer;box-shadow:0 1px 2px rgba(15,23,42,.08),0 8px 24px rgba(15,23,42,.12);display:flex;align-items:center;justify-content:center;z-index:2147483000;transition:transform .15s ease}',
      '.sb-launcher:hover{transform:scale(1.05)}',
      '.sb-launcher svg{width:26px;height:26px;fill:#fff}',
      '.sb-panel{position:fixed;bottom:88px;' + POSITION + ':20px;width:380px;max-width:calc(100vw - 40px);height:540px;max-height:calc(100vh - 120px);background:#fff;border-radius:16px;box-shadow:0 1px 2px rgba(15,23,42,.08),0 16px 48px rgba(15,23,42,.16);display:none;flex-direction:column;overflow:hidden;z-index:2147483000;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}',
      '.sb-panel.open{display:flex}',
      '.sb-header{background:var(--sb-color);color:#fff;padding:14px 16px;font-weight:600;font-size:15px;display:flex;justify-content:space-between;align-items:center}',
      '.sb-close{background:transparent;border:none;color:#fff;font-size:20px;cursor:pointer;line-height:1;opacity:.85}',
      '.sb-messages{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px;background:#f8fafc}',
      '.sb-msg{max-width:85%;padding:10px 13px;border-radius:12px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}',
      '.sb-msg.user{align-self:flex-end;background:var(--sb-color);color:#fff;border-bottom-right-radius:4px}',
      '.sb-msg.bot{align-self:flex-start;background:#fff;color:#1e293b;border:1px solid #e2e8f0;border-bottom-left-radius:4px}',
      '.sb-msg a{color:var(--sb-color);text-decoration:underline;word-break:break-word}',
      '.sb-rate{margin-top:8px;display:flex;gap:6px;align-items:center}',
      '.sb-rate button{border:1px solid #e2e8f0;background:#fff;border-radius:6px;cursor:pointer;font-size:13px;line-height:1;padding:4px 7px;opacity:.75;transition:opacity .15s,border-color .15s}',
      '.sb-rate button:hover{opacity:1;border-color:#cbd5e1}',
      '.sb-rate button.on{opacity:1;border-color:var(--sb-color)}',
      '.sb-rate span{font-size:11px;color:#94a3b8}',
      '.sb-sources{margin-top:8px;font-size:12px;display:flex;flex-direction:column;gap:4px}',
      '.sb-sources a{color:var(--sb-color);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.sb-sources a:hover{text-decoration:underline}',
      '.sb-form{display:flex;gap:8px;padding:12px;border-top:1px solid #e2e8f0;background:#fff}',
      '.sb-input{flex:1;border:1px solid #cbd5e1;border-radius:8px;padding:10px 12px;font-size:14px;outline:none;font-family:inherit;resize:none}',
      '.sb-input:focus{border-color:var(--sb-color)}',
      '.sb-input:focus-visible{outline:2px solid var(--sb-focus);outline-offset:-1px}',
      '.sb-send{background:var(--sb-color);color:#fff;border:none;border-radius:8px;padding:0 16px;cursor:pointer;font-weight:600;font-size:14px}',
      '.sb-send:disabled{opacity:.5;cursor:not-allowed}',
      '.sb-typing{display:inline-block;width:8px;height:8px;border-radius:50%;background:#94a3b8;animation:sb-blink 1s infinite}',
      '@keyframes sb-blink{0%,100%{opacity:.3}50%{opacity:1}}',
      '.sb-footer{text-align:center;font-size:10px;color:#94a3b8;padding:6px 0;background:#fff}',
      '.sb-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}',
      '.sb-launcher:focus-visible,.sb-close:focus-visible,.sb-send:focus-visible,.sb-rate button:focus-visible{outline:2px solid var(--sb-focus);outline-offset:2px}',
      '@media (prefers-reduced-motion:reduce){.sb-launcher{transition:none}.sb-launcher:hover{transform:none}.sb-typing{animation:none;opacity:.6}}',
    ].join('');
    root.appendChild(style);

    var launcher = document.createElement('button');
    launcher.className = 'sb-launcher';
    launcher.setAttribute('aria-label', 'Open chat');
    launcher.setAttribute('aria-expanded', 'false');
    launcher.innerHTML =
      '<svg viewBox="0 0 24 24"><path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2z"/></svg>';

    var panel = document.createElement('div');
    panel.className = 'sb-panel';
    panel.innerHTML =
      '<div class="sb-header"><span></span><button class="sb-close" aria-label="Close">×</button></div>' +
      '<div class="sb-messages" role="log"></div>' +
      '<div class="sb-sr-only" aria-live="polite" aria-atomic="true"></div>' +
      '<form class="sb-form"><textarea class="sb-input" rows="1" placeholder="Type your question..."></textarea><button class="sb-send" type="submit">Send</button></form>' +
      '<div class="sb-footer" hidden>Powered by sitebot</div>';

    root.appendChild(launcher);
    root.appendChild(panel);

    panel.querySelector('.sb-header span').textContent = TITLE;
    var messagesEl = panel.querySelector('.sb-messages');
    // Region announced by screen readers, deliberately separate from
    // .sb-messages: streaming rewrites the bot text token by token, and
    // putting aria-live there would re-announce the whole answer on every
    // token. It's only announced once, on completion.
    var liveEl = panel.querySelector('.sb-sr-only');
    var footerEl = panel.querySelector('.sb-footer');
    var form = panel.querySelector('.sb-form');
    var input = panel.querySelector('.sb-input');
    var sendBtn = panel.querySelector('.sb-send');

    var history = [];
    var busy = false;

    /** 👍/👎 buttons under each bot answer. One vote per message. */
    function addRating(container, messageId) {
      var wrap = document.createElement('div');
      wrap.className = 'sb-rate';

      var note = document.createElement('span');
      var buttons = {};

      function vote(rating) {
        if (wrap.dataset.voted) return;
        wrap.dataset.voted = rating;
        buttons[rating].classList.add('on');
        note.textContent = 'Thanks!';

        fetch(API_URL + '/chat/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            siteId: siteId,
            sessionId: sessionId,
            messageId: messageId,
            rating: rating,
          }),
        }).catch(function (error) {
          // The vote is secondary: if it fails, don't bother the visitor.
          console.error('[sitebot]', error);
        });
      }

      ['up', 'down'].forEach(function (rating) {
        var button = document.createElement('button');
        button.type = 'button';
        button.textContent = rating === 'up' ? '👍' : '👎';
        button.setAttribute(
          'aria-label',
          rating === 'up' ? 'Helpful answer' : 'Not helpful answer',
        );
        button.addEventListener('click', function () {
          vote(rating);
        });
        buttons[rating] = button;
        wrap.appendChild(button);
      });

      wrap.appendChild(note);
      container.appendChild(wrap);
    }

    function addMessage(role, text) {
      var el = document.createElement('div');
      el.className = 'sb-msg ' + (role === 'user' ? 'user' : 'bot');
      el.innerHTML = renderMessage(text);
      messagesEl.appendChild(el);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return el;
    }

    function addSources(el, sources) {
      if (!sources || !sources.length) return;
      var wrap = document.createElement('div');
      wrap.className = 'sb-sources';
      sources.slice(0, 4).forEach(function (source) {
        var a = document.createElement('a');
        a.href = source.url;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = source.title || source.url;
        wrap.appendChild(a);
      });
      el.appendChild(wrap);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function toggle(open) {
      panel.classList.toggle('open', open);
      launcher.setAttribute('aria-expanded', open ? 'true' : 'false');
      launcher.setAttribute('aria-label', open ? 'Close chat' : 'Open chat');
      if (open) {
        input.focus();
      } else {
        launcher.focus();
      }
    }

    launcher.addEventListener('click', function () {
      toggle(!panel.classList.contains('open'));
    });
    panel.querySelector('.sb-close').addEventListener('click', function () {
      toggle(false);
    });
    panel.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        toggle(false);
      }
    });

    input.addEventListener('input', function () {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });

    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        form.dispatchEvent(new Event('submit', { cancelable: true }));
      }
    });

    async function ask(question) {
      busy = true;
      sendBtn.disabled = true;
      addMessage('user', question);
      history.push({ role: 'user', content: question });

      var botEl = addMessage('bot', '');
      var typing = document.createElement('span');
      typing.className = 'sb-typing';
      botEl.appendChild(typing);

      var answer = '';
      var sources = [];
      var messageId = null;

      try {
        var response = await fetch(API_URL + '/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            siteId: siteId,
            sessionId: sessionId || undefined,
            message: question,
            history: history.slice(0, -1),
          }),
        });

        if (!response.ok || !response.body) throw new Error('HTTP ' + response.status);

        var reader = response.body.getReader();
        var decoder = new TextDecoder();
        var buffer = '';

        while (true) {
          var chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          var parts = buffer.split('\n\n');
          buffer = parts.pop();

          for (var i = 0; i < parts.length; i++) {
            var line = parts[i].split('\n').find(function (l) {
              return l.indexOf('data:') === 0;
            });
            if (!line) continue;
            var payload;
            try {
              payload = JSON.parse(line.slice(5).trim());
            } catch (e) {
              continue;
            }

            if (payload.type === 'session') {
              sessionId = payload.sessionId;
              // Paid plans do not show the branding.
              footerEl.hidden = payload.branding === false;
              try {
                localStorage.setItem(storageKey, sessionId);
              } catch (e) {}
            } else if (payload.type === 'message') {
              messageId = payload.id;
            } else if (payload.type === 'sources') {
              sources = payload.sources || [];
            } else if (payload.type === 'token') {
              if (typing.parentNode) typing.remove();
              answer += payload.value;
              botEl.textContent = answer;
              messagesEl.scrollTop = messagesEl.scrollHeight;
            } else if (payload.type === 'error') {
              if (typing.parentNode) typing.remove();
              botEl.textContent = 'Sorry, an error occurred. Please try again.';
            }
          }
        }
      } catch (error) {
        if (typing.parentNode) typing.remove();
        botEl.textContent = 'Sorry, I could not connect to the assistant.';
        console.error('[sitebot]', error);
      }

      if (answer) {
        botEl.innerHTML = renderMessage(answer, sources);
        addSources(botEl, sources);
        if (messageId) addRating(botEl, messageId);
        history.push({ role: 'assistant', content: answer });
        history = history.slice(-8);
        // A single announcement when finished, not one per token.
        liveEl.textContent = 'Answer received: ' + answer;
      }

      busy = false;
      sendBtn.disabled = false;
      input.focus();
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (busy) return;
      var question = input.value.trim();
      if (!question) return;
      input.value = '';
      input.style.height = 'auto';
      ask(question);
    });

    addMessage('bot', GREETING);

    return {
      host: host,
      destroy: function () {
        host.remove();
      },
    };
  }

  var instances = {};

  function keyFor(opts) {
    var container = opts.container;
    var containerKey = container && container.id ? container.id : 'body';
    return opts.siteId + '=' + containerKey;
  }

  window.sitebot = {
    mount: function (opts) {
      if (!opts || !opts.siteId) return null;
      var key = keyFor(opts);
      var existing = instances[key];
      if (existing && existing.host && existing.host.isConnected) {
        return existing.host;
      }
      if (existing) {
        existing.destroy();
        delete instances[key];
      }
      var widget = createWidget(opts);
      instances[key] = widget;
      return widget.host;
    },
    unmount: function (siteId) {
      Object.keys(instances).forEach(function (key) {
        if (key.indexOf(siteId + '=') === 0) {
          instances[key].destroy();
          delete instances[key];
        }
      });
    },
    unmountAll: function () {
      Object.keys(instances).forEach(function (key) {
        instances[key].destroy();
        delete instances[key];
      });
    },
  };

  var current = document.currentScript;
  if (!current) {
    var scripts = document.getElementsByTagName('script');
    for (var i = scripts.length - 1; i >= 0; i--) {
      if (scripts[i].src && scripts[i].src.indexOf('/widget.js') !== -1) {
        current = scripts[i];
        break;
      }
    }
  }
  if (!current) return;
  if (current.getAttribute('data-auto') === 'false') return;

  var siteId = current.getAttribute('data-site-id');
  if (!siteId) {
    console.error('[sitebot] missing data-site-id on the script.');
    return;
  }

  window.sitebot.mount({
    siteId: siteId,
    apiUrl: current.getAttribute('data-api') || new URL(current.src).origin,
    color: current.getAttribute('data-color'),
    title: current.getAttribute('data-title'),
    greeting: current.getAttribute('data-greeting'),
    position: current.getAttribute('data-position'),
  });
})();
