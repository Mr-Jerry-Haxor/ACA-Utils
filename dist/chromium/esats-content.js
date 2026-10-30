(() => {
  'use strict';

  const api = globalThis.browser ?? globalThis.chrome;
  const BUTTON_ID = 'aca-esats-dashboard-button';
  const OVERLAY_ID = 'aca-esats-dashboard-overlay';
  let frame = null;
  let open = false;

  document.documentElement.dataset.acaUtilsEsats = 'content-script-loaded';

  function findTopbar() {
    return document.querySelector('app-header mat-toolbar.topbar')
      ?? document.querySelector('app-header mat-toolbar')
      ?? document.querySelector('app-header');
  }

  function addButton() {
    if (document.getElementById(BUTTON_ID)) return true;
    const topbar = findTopbar();
    if (!topbar) return false;
    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.title = 'Open ACA-utils ESATS dashboard';
    button.setAttribute('aria-label', 'Open ACA-utils ESATS dashboard');
    button.setAttribute('aria-pressed', 'false');
    const icon = createDashboardIcon();
    button.append(icon);
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (open) closeDashboard();
      else openDashboard();
    });
    const spacer = topbar.querySelector('.example-spacer');
    if (spacer?.nextSibling) topbar.insertBefore(button, spacer.nextSibling);
    else topbar.append(button);
    return true;
  }

  function createDashboardIcon() {
    const namespace = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(namespace, 'svg');
    svg.classList.add('aca-esats-dashboard-icon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const panel = document.createElementNS(namespace, 'rect');
    panel.setAttribute('x', '2.5'); panel.setAttribute('y', '3'); panel.setAttribute('width', '19'); panel.setAttribute('height', '18'); panel.setAttribute('rx', '2.5');
    panel.setAttribute('class', 'aca-icon-panel');
    const baseline = document.createElementNS(namespace, 'path');
    baseline.setAttribute('d', 'M6 17.5h12'); baseline.setAttribute('class', 'aca-icon-line');
    const bars = [[6,12,2.3,4.5],[10.85,8,2.3,8.5],[15.7,10,2.3,6.5]].map(([x,y,width,height]) => {
      const bar = document.createElementNS(namespace, 'rect');
      bar.setAttribute('x', x); bar.setAttribute('y', y); bar.setAttribute('width', width); bar.setAttribute('height', height); bar.setAttribute('rx', '1');
      bar.setAttribute('class', 'aca-icon-bar');
      return bar;
    });
    const trend = document.createElementNS(namespace, 'path');
    trend.setAttribute('d', 'M6 10.2 10.2 7l3.2 2 4.6-4'); trend.setAttribute('class', 'aca-icon-trend');
    svg.append(panel, baseline, ...bars, trend);
    return svg;
  }

  function createOverlay() {
    const overlay = document.createElement('section');
    overlay.id = OVERLAY_ID;
    overlay.setAttribute('aria-label', 'ACA-utils ESATS dashboard');
    frame = document.createElement('iframe');
    frame.title = 'ACA-utils ESATS dashboard';
    frame.src = api.runtime.getURL('esats-dashboard.html?embedded=1');
    overlay.append(frame);
    document.body.append(overlay);
    return overlay;
  }

  function placeOverlay() {
    const overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) return;
    const header = findTopbar()?.getBoundingClientRect();
    overlay.style.top = `${Math.max(0, Math.round(header?.bottom ?? 64))}px`;
  }

  function openDashboard() {
    open = true;
    const overlay = document.getElementById(OVERLAY_ID) ?? createOverlay();
    overlay.hidden = false;
    frame = overlay.querySelector('iframe');
    placeOverlay();
    document.getElementById(BUTTON_ID)?.setAttribute('aria-pressed', 'true');
  }

  function closeDashboard() {
    open = false;
    const overlay = document.getElementById(OVERLAY_ID);
    if (overlay) overlay.hidden = true;
    document.getElementById(BUTTON_ID)?.setAttribute('aria-pressed', 'false');
  }

  addEventListener('resize', placeOverlay, { passive: true });
  addEventListener('message', (event) => {
    if (event.source !== frame?.contentWindow || event.data?.source !== 'aca-esats-dashboard') return;
    if (event.data.type === 'close') closeDashboard();
    if (event.data.version === 1 && event.data.type === 'request-auth-token' && typeof event.data.requestId === 'string') {
      const token = String(localStorage.getItem('esatsToken') ?? '').trim().replace(/^Bearer\s+/i, '');
      frame.contentWindow.postMessage({
        source: 'aca-esats-host', version: 1, type: 'auth-token', requestId: event.data.requestId, token,
      }, new URL(api.runtime.getURL('/')).origin);
    }
  });

  addButton();
  new MutationObserver(() => {
    addButton();
    if (open && !document.getElementById(OVERLAY_ID)) openDashboard();
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
