(() => {
  'use strict';

  const api = globalThis.browser ?? globalThis.chrome;
  const BUTTON_ID = 'aca-supported-compliance-button';
  const OVERLAY_ID = 'aca-compliance-overlay';
  const ACTIVE_CLASS = 'aca-dashboard-active';
  let frame = null;
  let observer = null;
  let menuResizeObserver = null;
  let dashboardOpen = false;

  document.documentElement.dataset.acaUtils = 'content-script-loaded';
  console.info('[ACA-utils] Website integration loaded.');

  function visible(element) {
    if (!element?.isConnected) return false;
    const rect = element.getBoundingClientRect();
    const css = getComputedStyle(element);
    return rect.width > 1 && rect.height > 1 && css.display !== 'none' && css.visibility !== 'hidden';
  }

  function descriptor(element) {
    const className = typeof element.className === 'string' ? element.className : element.getAttribute('class') ?? '';
    return `${element.tagName} ${element.id} ${className}`.toLowerCase();
  }

  function scoreSidebar(element) {
    if (!visible(element)) return -Infinity;
    const rect = element.getBoundingClientRect();
    const description = descriptor(element);
    let score = /side-navigation|side-nav|sidebar|sidenav|drawer-panel/.test(description) ? 90 : 0;
    if (element.matches('app-side-navigation-menu')) score += 200;
    if (element.querySelector('.dx-treeview-node-container')) score += 80;
    if (rect.left < 16) score += 30;
    if (rect.height > innerHeight * .4) score += 25;
    if (rect.width >= 45 && rect.width <= 380) score += 25;
    return score;
  }

  function findSidebar() {
    const exact = document.querySelector('app-side-navigation-menu');
    if (visible(exact)) return exact;
    const candidates = [...document.querySelectorAll([
      '.dx-drawer-panel-content app-side-navigation-menu',
      '.dx-drawer-panel-content .menu-container',
      '.dx-drawer-panel-content .dx-treeview',
      '.dx-drawer-panel-content',
      'app-side-nav-outer-toolbar',
      'app-sidebar',
      'mat-sidenav',
      'aside',
      'nav',
      '[class*="sidebar" i]',
      '[class*="side-nav" i]',
      '[id*="sidebar" i]'
    ].join(','))];
    return candidates.sort((a, b) => scoreSidebar(b) - scoreSidebar(a))[0] ?? null;
  }

  function findNavigationTarget(sidebar) {
    return sidebar.querySelector('.dx-treeview-node-container')
      ?? sidebar.querySelector('.menu-container')
      ?? sidebar.querySelector('ul,ol,nav,.nav')
      ?? sidebar;
  }

  function updateCompactMode(wrapper, sidebar) {
    wrapper.classList.toggle('aca-nav-compact', sidebar.getBoundingClientRect().width <= 90);
  }

  function stopHostMenuEvent(event) {
    event.stopPropagation();
    if (event.type === 'dxclick') event.preventDefault();
  }

  function addNavigationItem() {
    if (document.getElementById(BUTTON_ID)) return true;
    const sidebar = findSidebar();
    if (!sidebar) return false;
    const target = findNavigationTarget(sidebar);
    const treeTarget = target.matches('.dx-treeview-node-container');
    const wrapper = target.matches('ul,ol') ? document.createElement('li') : document.createElement('div');
    wrapper.dataset.acaNavItem = 'true';
    wrapper.className = treeTarget ? 'aca-nav-entry dx-treeview-node' : 'aca-nav-entry';
    if (treeTarget) {
      wrapper.setAttribute('role', 'treeitem');
      wrapper.setAttribute('aria-level', '1');
    }
    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.title = 'Open ACA-utils supported compliance dashboard';
    const mark = document.createElement('span');
    mark.className = 'aca-nav-mark';
    mark.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'aca-nav-label';
    label.textContent = 'ACA-utils';
    button.append(mark, label);
    for (const eventName of ['pointerdown', 'mousedown', 'touchstart', 'dxclick']) wrapper.addEventListener(eventName, stopHostMenuEvent);
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openDashboard();
    });
    wrapper.append(button);
    target.append(wrapper);
    updateCompactMode(wrapper, sidebar);
    menuResizeObserver?.disconnect();
    if ('ResizeObserver' in globalThis) {
      menuResizeObserver = new ResizeObserver(() => updateCompactMode(wrapper, sidebar));
      menuResizeObserver.observe(sidebar);
    }
    console.info('[ACA-utils] Sidebar button added.');
    return true;
  }

  function findContentHost() {
    const outer = document.querySelector('app-side-nav-outer-toolbar');
    const candidates = [
      outer?.querySelector('.dx-drawer-content dx-scroll-view .content'),
      outer?.querySelector('.dx-drawer-content .content'),
      outer?.querySelector('dx-scroll-view .content'),
      document.querySelector('[role="main"]'),
      document.querySelector('main')
    ];
    return candidates.find(visible) ?? null;
  }

  function landmark(selectors, fallback) {
    for (const selector of selectors) {
      const item = [...document.querySelectorAll(selector)].find(visible);
      if (item) return item.getBoundingClientRect();
    }
    return fallback;
  }

  function createOverlay() {
    const overlay = document.createElement('section');
    overlay.id = OVERLAY_ID;
    overlay.setAttribute('aria-label', 'ACA-utils supported application compliance dashboard');
    frame = document.createElement('iframe');
    frame.title = 'ACA-utils supported application compliance dashboard';
    frame.src = api.runtime.getURL('dashboard.html?embedded=1');
    overlay.append(frame);
    return overlay;
  }

  function placeFixedOverlay(overlay) {
    if (!overlay.classList.contains('aca-fixed')) return;
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

  function sizeInlineOverlay(overlay, contentHost) {
    if (!overlay.classList.contains('aca-inline')) return;
    const scrollView = contentHost.closest('dx-scroll-view,.with-footer');
    const footerBlock = scrollView?.querySelector(':scope > .content-block');
    const contentStyle = getComputedStyle(contentHost);
    const contentInsets = Number.parseFloat(contentStyle.paddingTop || '0')
      + Number.parseFloat(contentStyle.paddingBottom || '0')
      + Number.parseFloat(contentStyle.borderTopWidth || '0')
      + Number.parseFloat(contentStyle.borderBottomWidth || '0');
    const availableHeight = (scrollView?.getBoundingClientRect().height ?? innerHeight)
      - (footerBlock?.getBoundingClientRect().height ?? 0)
      - contentInsets;
    overlay.style.height = `${Math.max(480, Math.round(availableHeight))}px`;
  }

  function mountDashboard() {
    let overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) overlay = createOverlay();
    const contentHost = findContentHost();
    const previousHost = overlay.parentElement?.classList.contains(ACTIVE_CLASS) ? overlay.parentElement : null;
    if (contentHost) {
      previousHost?.classList.remove(ACTIVE_CLASS);
      contentHost.classList.add(ACTIVE_CLASS);
      overlay.classList.remove('aca-fixed');
      overlay.classList.add('aca-inline');
      overlay.removeAttribute('style');
      if (overlay.parentElement !== contentHost) contentHost.append(overlay);
      sizeInlineOverlay(overlay, contentHost);
    } else {
      previousHost?.classList.remove(ACTIVE_CLASS);
      overlay.classList.remove('aca-inline');
      overlay.classList.add('aca-fixed');
      if (overlay.parentElement !== document.body) document.body.append(overlay);
      placeFixedOverlay(overlay);
    }
    overlay.hidden = false;
    frame = overlay.querySelector('iframe');
  }

  function openDashboard() {
    dashboardOpen = true;
    mountDashboard();
  }

  function closeDashboard() {
    dashboardOpen = false;
    const overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) return;
    overlay.hidden = true;
    overlay.parentElement?.classList.remove(ACTIVE_CLASS);
  }

  addEventListener('resize', () => {
    const overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) return;
    if (overlay.classList.contains('aca-inline') && overlay.parentElement) sizeInlineOverlay(overlay, overlay.parentElement);
    else placeFixedOverlay(overlay);
  }, { passive: true });

  addEventListener('message', (event) => {
    if (event.source !== frame?.contentWindow || event.data?.source !== 'aca-dashboard') return;
    if (event.data.type === 'close') closeDashboard();
  });

  addNavigationItem();
  observer = new MutationObserver(() => {
    addNavigationItem();
    if (dashboardOpen && !document.getElementById(OVERLAY_ID)) mountDashboard();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => {
    if (!document.getElementById(BUTTON_ID)) console.warn('[ACA-utils] The content script loaded, but the website sidebar was not found.');
  }, 8000);
})();
