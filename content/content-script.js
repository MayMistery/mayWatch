(async function() {
  if (window.__maywatch_injected) return;
  window.__maywatch_injected = true;

  document.addEventListener('contextmenu', (e) => {
    const el = e.target;
    if (!el || el === document.body || el === document.documentElement) {
      window.__maywatch_last_context_target = null;
      return;
    }

    function getXPath(element) {
      if (element.id) return `//*[@id="${element.id}"]`;
      const parts = [];
      let current = element;
      while (current && current.nodeType === Node.ELEMENT_NODE) {
        let index = 1;
        let sibling = current.previousElementSibling;
        while (sibling) {
          if (sibling.tagName === current.tagName) index++;
          sibling = sibling.previousElementSibling;
        }
        parts.unshift(`${current.tagName.toLowerCase()}[${index}]`);
        current = current.parentElement;
      }
      return '/' + parts.join('/');
    }

    function getCssSelector(element) {
      if (element.id) return `#${element.id}`;
      const parts = [];
      let current = element;
      while (current && current !== document.documentElement) {
        if (current.id) {
          parts.unshift(`#${current.id}`);
          break;
        }
        let selector = current.tagName.toLowerCase();
        if (current.parentElement) {
          const siblings = Array.from(current.parentElement.children).filter(
            c => c.tagName === current.tagName
          );
          if (siblings.length > 1) {
            const idx = siblings.indexOf(current) + 1;
            selector += `:nth-of-type(${idx})`;
          }
        }
        parts.unshift(selector);
        current = current.parentElement;
      }
      return parts.join(' > ');
    }

    window.__maywatch_last_context_target = {
      xpath: getXPath(el),
      cssSelector: getCssSelector(el),
      text: (el.innerText || el.textContent || '').slice(0, 100).trim(),
      url: location.href,
      title: document.title,
    };
  }, true);

  const host = document.createElement('div');
  host.id = 'maywatch-root';
  host.style.cssText = 'all:initial !important; position:fixed !important; top:0 !important; right:0 !important; width:0 !important; height:0 !important; overflow:visible !important; z-index:2147483647 !important; pointer-events:none !important;';
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  const cssUrl = chrome.runtime.getURL('content/panel.css');
  const htmlUrl = chrome.runtime.getURL('content/panel.html');

  const [cssText, htmlText] = await Promise.all([
    fetch(cssUrl).then(r => r.text()),
    fetch(htmlUrl).then(r => r.text()),
  ]);

  const style = document.createElement('style');
  style.textContent = cssText;
  shadow.appendChild(style);

  const container = document.createElement('div');
  container.innerHTML = htmlText;
  shadow.appendChild(container);

  const { Panel } = await import(chrome.runtime.getURL('content/panel.js'));
  const panel = new Panel(shadow);

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'QUICK_ADD' && msg.data) {
      panel.showQuickAdd(msg.data);
      sendResponse({ ok: true });
    }
    return false;
  });
})();
