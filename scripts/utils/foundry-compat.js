/**
 * Foundry VTT cross-version compatibility helpers (v12 – v14).
 *
 * v13 moved many globals into namespaces (`foundry.applications.handlebars`,
 * `foundry.applications.sidebar`, ...) and rebuilt the sidebar on
 * ApplicationV2. These helpers resolve the right implementation at call time
 * so the rest of the module can stay version-agnostic.
 */

/**
 * True when the running core ships the ApplicationV2 sidebar (v13+).
 * v12 still uses the Application v1 `Sidebar` / `SidebarTab` classes.
 * @returns {boolean}
 */
export function hasApplicationV2Sidebar() {
  return Boolean(globalThis.foundry?.applications?.sidebar?.AbstractSidebarTab);
}

/**
 * Render a Handlebars template (v13+: namespaced, v12: global).
 * @param {string} path
 * @param {object} data
 * @returns {Promise<string>}
 */
export function renderTemplate(path, data) {
  const impl =
    globalThis.foundry?.applications?.handlebars?.renderTemplate ?? globalThis.renderTemplate;
  return impl(path, data);
}

/**
 * Preload Handlebars templates/partials (v13+: namespaced, v12: global).
 * @param {string[]} paths
 * @returns {Promise<unknown>|undefined}
 */
export function loadTemplates(paths) {
  const impl =
    globalThis.foundry?.applications?.handlebars?.loadTemplates ?? globalThis.loadTemplates;
  if (typeof impl !== 'function') return undefined;
  return impl(paths);
}

/**
 * Build a document UUID. Uses `foundry.utils.buildUuid` when available (v13+)
 * and falls back to the equivalent string form for v12.
 * @param {{documentName: string, id: string, pack?: string|null}} parts
 * @returns {string}
 */
export function buildUuid({ documentName, id, pack = null }) {
  const native = globalThis.foundry?.utils?.buildUuid;
  if (typeof native === 'function') return native({ documentName, id, pack });
  if (!documentName || !id) throw new Error('buildUuid requires documentName and id');
  return pack ? `Compendium.${pack}.${documentName}.${id}` : `${documentName}.${id}`;
}

/**
 * Name of the currently active primary sidebar tab.
 * v13+: `ui.sidebar.tabGroups.primary`; v12: `ui.sidebar.activeTab`.
 * @returns {string|undefined}
 */
export function getActiveSidebarTab() {
  const sidebar = globalThis.ui?.sidebar;
  return sidebar?.tabGroups?.primary ?? sidebar?.activeTab;
}

/**
 * Register Handlebars helpers the module's templates use that are not
 * guaranteed to exist in every core version. Never overrides a core helper.
 */
export function registerHandlebarsFallbacks() {
  const hbs = globalThis.Handlebars;
  if (!hbs?.registerHelper) return;
  if (!hbs.helpers?.formatTime) {
    hbs.registerHelper('formatTime', value => {
      if (!value) return '';
      const date = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(date.getTime())) return '';
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    });
  }
}
