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
    const icon = document.createElement('span');
    icon.className = 'aca-esats-dashboard-icon';
    icon.setAttribute('aria-hidden', 'true');
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
  });

  addButton();
  new MutationObserver(() => {
    addButton();
    if (open && !document.getElementById(OVERLAY_ID)) openDashboard();
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
