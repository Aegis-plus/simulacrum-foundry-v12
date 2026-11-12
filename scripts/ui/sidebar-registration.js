/**
 * Sidebar Registration Logic
 */
import { createLogger } from '../utils/logger.js';
import { hasApplicationV2Sidebar } from '../utils/foundry-compat.js';
import { SimulacrumSidebarTab } from './simulacrum-sidebar-tab.js';
import { registerLegacySidebarTab } from './legacy-sidebar-tab.js';

const TAB_DESCRIPTOR = Object.freeze({
  tooltip: 'SIMULACRUM.SidebarTab.Title',
  icon: 'fa-solid fa-hand-sparkles',
});

export function registerSimulacrumSidebarTab() {
  const logger = createLogger('SidebarTab');

  try {
    if (hasApplicationV2Sidebar()) {
      _registerTab(logger);
    } else {
      _registerLegacyTab(logger);
    }
    _registerAppConfig(logger);
    logger.info('Sidebar tab registration completed');
  } catch (error) {
    logger.error('Failed to register sidebar tab:', error);
  }
}

function _registerTab(logger) {
  const Sidebar = globalThis.foundry?.applications?.sidebar?.Sidebar ?? globalThis.Sidebar;
  if (Sidebar && Sidebar.TABS) {
    const desc = { ...TAB_DESCRIPTOR };
    const entries = Object.entries(Sidebar.TABS).filter(([k]) => k !== 'simulacrum');
    const reordered = {};
    let inserted = false;

    const insertSimulacrum = () => {
      reordered.simulacrum = desc;
      inserted = true;
    };

    for (const [key, value] of entries) {
      if (!inserted && key === 'settings') insertSimulacrum();
      reordered[key] = value;
    }
    if (!inserted) insertSimulacrum();

    Sidebar.TABS = reordered;
    logger.info('Sidebar TABS registration successful');
  } else {
    logger.error('Sidebar class or TABS property not found');
  }
}

/**
 * Foundry v12: the sidebar has no tab registry, so the tab button and content
 * slot are injected into the rendered sidebar DOM (GM only).
 */
function _registerLegacyTab(logger) {
  registerLegacySidebarTab({
    tabName: SimulacrumSidebarTab.tabName,
    ...TAB_DESCRIPTOR,
    shouldInject: () => Boolean(game.user?.isGM),
  });
  logger.info('Legacy (v12) sidebar tab registration successful');
}

function _registerAppConfig(logger) {
  if (CONFIG && CONFIG.ui) {
    CONFIG.ui.simulacrum = SimulacrumSidebarTab;
    logger.info('CONFIG.ui registration successful');
  } else {
    logger.error('CONFIG.ui not found');
  }
}
