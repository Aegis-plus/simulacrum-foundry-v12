/**
 * Foundry VTT v12 sidebar support.
 *
 * v13 ships `foundry.applications.sidebar.AbstractSidebarTab` and a data-driven
 * `Sidebar.TABS` registry. v12 has neither: its sidebar is an Application v1
 * with a hard-coded tab list and a v1 `Tabs` controller. This module provides:
 *
 * - `LegacySidebarTab`: an ApplicationV2 base class (ApplicationV2 exists in
 *   v12) exposing the subset of the v13 AbstractSidebarTab API the Simulacrum
 *   tab relies on (tabName, isPopout, active, activate, renderPopout,
 *   _onActivate/_onDeactivate, _postRender).
 * - `registerLegacySidebarTab()`: injects the tab button and content slot into
 *   the v12 sidebar DOM so the core v1 `Tabs` controller switches to it like
 *   any built-in tab.
 *
 * Nothing in this file runs on v13+.
 */

import { getActiveSidebarTab } from '../utils/foundry-compat.js';

const ApplicationV2 = globalThis.foundry?.applications?.api?.ApplicationV2 ?? class {};
const NATIVE_POST_RENDER = typeof ApplicationV2.prototype._postRender === 'function';
const LEGACY_CLASS = 'simulacrum-legacy-sidebar';

export class LegacySidebarTab extends ApplicationV2 {
  /** The sidebar tab key; subclasses must override. */
  static tabName = '';

  static DEFAULT_OPTIONS = {
    tag: 'section',
    classes: ['tab', 'sidebar-tab', LEGACY_CLASS],
    window: { frame: false, positioned: false },
  };

  /** Pop-out instance of this tab, if one has been created. */
  popout = null;

  /** For a pop-out instance, the sidebar instance it was created from. */
  _original = null;

  /** @override */
  _initializeApplicationOptions(options) {
    options = super._initializeApplicationOptions(options);
    if (options.window?.frame) {
      options.id = `${options.id}-popout`;
      options.classes = options.classes.filter(c => c !== 'tab');
      options.classes.push('sidebar-popout');
      options.window.resizable = true;
      options.window.minimizable = true;
      options.position = {
        width: 320,
        height: Math.min(720, Math.max(400, (globalThis.innerHeight ?? 800) - 160)),
        ...options.position,
      };
    }
    return options;
  }

  get tabName() {
    return this.constructor.tabName;
  }

  /** Is this instance the framed pop-out variant? */
  get isPopout() {
    return this.options.window?.frame === true;
  }

  /** Is this tab currently visible? */
  get active() {
    if (this.isPopout) return this.rendered;
    return getActiveSidebarTab() === this.tabName;
  }

  /** Switch the sidebar to this tab (or focus the pop-out). */
  activate() {
    if (this.isPopout) {
      (this.bringToFront ?? this.bringToTop)?.call(this);
      return;
    }
    globalThis.ui?.sidebar?.activateTab?.(this.tabName);
  }

  /** Called when the tab becomes the active sidebar tab. */
  _onActivate() {}

  /** Called when another sidebar tab replaces this one. */
  _onDeactivate() {}

  /**
   * Render (creating if needed) the pop-out variant of this tab.
   * @returns {Promise<LegacySidebarTab>} the pop-out instance
   */
  async renderPopout() {
    if (this.isPopout) {
      this.activate();
      return this;
    }
    if (!this.popout) {
      this.popout = new this.constructor({ window: { frame: true, positioned: true } });
      this.popout._original = this;
    }
    await this.popout.render({ force: true });
    this.popout.activate();
    return this.popout;
  }

  /**
   * The inline sidebar instance lives for the whole session: ignore the
   * Escape-key "close all windows" sweep, which only pop-outs should honour.
   * @override
   */
  async close(options = {}) {
    if (!this.isPopout && options?.closeKey) return this;
    return super.close(options);
  }

  /**
   * Place the inline tab into the v12 sidebar instead of the document body.
   * @override
   */
  _insertElement(element) {
    if (this.isPopout) return super._insertElement(element);

    element.dataset.tab = this.tabName;
    element.classList.toggle('active', getActiveSidebarTab() === this.tabName);

    const existing = document.getElementById(element.id);
    if (existing) {
      existing.replaceWith(element);
      return element;
    }
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
      sidebar.append(element);
      return element;
    }
    return super._insertElement(element);
  }

  /**
   * v12 ApplicationV2 has no `_postRender` step; emulate it so subclasses
   * written against v13 still get their post-render callback.
   * @override
   */
  _onRender(context, options) {
    super._onRender?.(context, options);
    if (!NATIVE_POST_RENDER && typeof this._postRender === 'function') {
      queueMicrotask(() => this._postRender(context, options));
    }
  }
}

/**
 * Add the tab button and content slot to a rendered v12 sidebar.
 * @param {HTMLElement} sidebar - the `#sidebar` element
 * @param {{tabName: string, icon: string, tooltip: string, before?: string}} config
 */
export function injectLegacySidebarTab(sidebar, { tabName, icon, tooltip, before = 'settings' }) {
  if (!sidebar) return;
  const label = globalThis.game?.i18n?.localize?.(tooltip) ?? tooltip;

  const nav = sidebar.querySelector('#sidebar-tabs');
  if (nav && !nav.querySelector(`[data-tab="${tabName}"]`)) {
    const item = document.createElement('a');
    item.className = 'item';
    item.dataset.tab = tabName;
    item.dataset.tooltip = label;
    item.setAttribute('aria-label', label);
    item.setAttribute('aria-controls', tabName);
    item.setAttribute('role', 'tab');
    item.innerHTML = `<i class="${icon}"></i>`;

    // Right-click (or any click while the sidebar is collapsed) pops the tab
    // out, matching the behaviour of the built-in v12 tabs.
    const popout = event => {
      event.preventDefault();
      globalThis.ui?.[tabName]?.renderPopout?.();
    };
    item.addEventListener('contextmenu', popout);
    item.addEventListener('click', event => {
      if (globalThis.ui?.sidebar?._collapsed) popout(event);
    });

    const anchor =
      nav.querySelector(`:scope > .item[data-tab="${before}"]`) ??
      nav.querySelector(':scope > .collapse');
    if (anchor) nav.insertBefore(item, anchor);
    else nav.append(item);
  }

  if (!sidebar.querySelector(`:scope > #${tabName}`)) {
    const slot = document.createElement('section');
    slot.id = tabName;
    slot.className = `tab sidebar-tab ${LEGACY_CLASS}`;
    slot.dataset.tab = tabName;
    slot.classList.toggle('active', getActiveSidebarTab() === tabName);
    sidebar.append(slot);
  }
}

/**
 * Wire a v12 sidebar tab into the core sidebar lifecycle.
 * @param {{tabName: string, icon: string, tooltip: string, before?: string,
 *   shouldInject?: () => boolean}} config
 */
export function registerLegacySidebarTab(config) {
  const { tabName, shouldInject = () => true } = config;

  Hooks.on('renderSidebar', (_app, html) => {
    if (!shouldInject()) return;
    const root = html?.[0] ?? html ?? document.getElementById('sidebar');
    const sidebar = root?.id === 'sidebar' ? root : document.getElementById('sidebar');
    injectLegacySidebarTab(sidebar, config);
  });

  // The v12 sidebar fires `changeSidebarTab` with `ui[activeTab]`; translate
  // that into the v13-style activate/deactivate callbacks.
  let wasActive = false;
  Hooks.on('changeSidebarTab', changed => {
    const app = globalThis.ui?.[tabName];
    if (!app || app.isPopout) return;
    const isActive = changed === app || getActiveSidebarTab() === tabName;
    if (isActive && !wasActive) app._onActivate?.();
    else if (!isActive && wasActive) app._onDeactivate?.();
    wasActive = isActive;
  });
}
