(() => {
  'use strict';

  const api = globalThis.browser ?? globalThis.chrome;
  const BUTTON_ID = 'aca-supported-compliance-button';
  const OVERLAY_ID = 'aca-compliance-overlay';
  const STYLE_ID = 'aca-compliance-host-style';
  let frame = null;
  let observer = null;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${BUTTON_ID} { width:100%; display:flex; align-items:center; gap:.65rem; border:0; border-top:1px solid rgba(255,255,255,.18); background:#212529; color:#fff; padding:.85rem 1rem; font:600 14px/1.2 Arial,sans-serif; cursor:pointer; text-align:left; }
      #${BUTTON_ID}:hover, #${BUTTON_ID}:focus-visible { background:#337ab7; outline:2px solid #fff; outline-offset:-3px; }
      #${BUTTON_ID} .aca-nav-mark { width:.7rem; height:.7rem; border:2px solid currentColor; border-radius:2px; box-shadow:5px 0 0 -2px currentColor,0 5px 0 -2px currentColor,5px 5px 0 -2px currentColor; }
      #${OVERLAY_ID} { position:fixed; background:#fff; border:0; z-index:999; box-shadow:0 0 0 1px rgba(0,0,0,.08),0 8px 28px rgba(0,0,0,.15); }
      #${OVERLAY_ID} iframe { display:block; width:100%; height:100%; border:0; background:#fff; }
    `;
    document.documentElement.append(style);
  }

  function visible(element) {
    if (!element?.isConnected) return false;
    const rect = element.getBoundingClientRect();
    const css = getComputedStyle(element);
    return rect.width > 80 && rect.height > 40 && css.display !== 'none' && css.visibility !== 'hidden';
  }

  function scoreSidebar(element) {
    if (!visible(element)) return -Infinity;
    const rect = element.getBoundingClientRect();
    const classes = `${element.tagName} ${element.id} ${element.className}`.toLowerCase();
    let score = /sidebar|sidenav|left.?nav|side.?nav/.test(classes) ? 80 : 0;
    if (rect.left < 12) score += 25;
    if (rect.height > innerHeight * .45) score += 20;
    if (rect.width >= 140 && rect.width <= 380) score += 20;
    if (element.matches('aside,nav,app-sidebar,mat-sidenav')) score += 20;
    return score;
  }

  function findSidebar() {
    const candidates = [...document.querySelectorAll('app-sidebar,mat-sidenav,aside,nav,[class*="sidebar" i],[class*="side-nav" i],[id*="sidebar" i]')];
    return candidates.sort((a, b) => scoreSidebar(b) - scoreSidebar(a))[0] ?? null;
  }

  function addNavigationItem() {
    if (document.getElementById(BUTTON_ID)) return true;
    const sidebar = findSidebar();
    if (!sidebar) return false;
    const target = sidebar.querySelector('ul,nav,.nav') ?? sidebar;
    const wrapper = target.matches('ul') ? document.createElement('li') : document.createElement('div');
    wrapper.dataset.acaNavItem = 'true';
    wrapper.style.marginTop = 'auto';
    wrapper.style.position = 'sticky';
    wrapper.style.bottom = '0';
    wrapper.style.zIndex = '2';
    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    const mark = document.createElement('span');
    mark.className = 'aca-nav-mark';
    mark.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = 'Supported Compliance';
    button.append(mark, label);
    button.addEventListener('click', openDashboard);
    wrapper.append(button);
    target.append(wrapper);
    return true;
  }

  function landmark(selectors, fallback) {
    for (const selector of selectors) {
      const item = [...document.querySelectorAll(selector)].find(visible);
      if (item) return item.getBoundingClientRect();
    }
    return fallback;
  }

  function placeOverlay() {
    const overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) return;
    const side = findSidebar()?.getBoundingClientRect();
    const header = landmark(['app-header','header','.header','.navbar','[role="banner"]'], { bottom: 0 });
    const footer = landmark(['app-footer','footer','[role="contentinfo"]'], { top: innerHeight });
    const left = side && side.left < innerWidth / 2 ? Math.max(0, side.right) : 0;
    const top = Math.max(0, Math.min(header.bottom ?? 0, innerHeight * .25));
    const bottom = footer.top > innerHeight * .6 ? Math.max(0, innerHeight - footer.top) : 0;
    overlay.style.left = `${Math.round(left)}px`;
    overlay.style.top = `${Math.round(top)}px`;
    overlay.style.right = '0';
    overlay.style.bottom = `${Math.round(bottom)}px`;
  }

  function openDashboard() {
    let overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) {
      overlay = document.createElement('section');
      overlay.id = OVERLAY_ID;
      overlay.setAttribute('aria-label', 'Supported application compliance dashboard');
      frame = document.createElement('iframe');
      frame.title = 'Supported application compliance dashboard';
      frame.src = api.runtime.getURL('dashboard.html?embedded=1');
      overlay.append(frame);
      document.body.append(overlay);
      addEventListener('resize', placeOverlay, { passive: true });
      placeOverlay();
    }
    overlay.hidden = false;
    placeOverlay();
  }

  function closeDashboard() {
    const overlay = document.getElementById(OVERLAY_ID);
    if (overlay) overlay.hidden = true;
  }

  addEventListener('message', (event) => {
    if (event.source === frame?.contentWindow && event.data?.source === 'aca-dashboard' && event.data?.type === 'close') closeDashboard();
  });

  injectStyles();
  addNavigationItem();
  observer = new MutationObserver(() => addNavigationItem());
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
