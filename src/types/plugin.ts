export interface InstalledPlugin {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  homepage?: string | null;
  repository?: string | null;
  license?: string | null;
  sourceType?: string;
  packagePath?: string | null;
  manifestPath?: string | null;
  packageSizeBytes?: number | null;
  menuEnabled?: boolean;
  menuTitle?: string | null;
  menuRoutePath?: string | null;
  menuIcon?: string | null;
  menuGroup?: string | null;
  enabled: boolean;
  installedAt: number;
}

export interface PluginImportPrecheckResult {
  filePath: string;
  fileExtension: string;
  packageSizeBytes: number;
  manifestPath: string;
  pluginId: string;
  pluginName: string;
  pluginVersion: string;
  pluginAuthor: string;
  menuEnabled: boolean;
  menuTitle: string | null;
  menuRoutePath: string | null;
  menuIcon: string | null;
  menuGroup: string | null;
  routeConflictWith: string | null;
  titleConflictWith: string | null;
  suggestedMenuTitle: string | null;
  suggestedMenuRoutePath: string | null;
  upgradeFromVersion: string | null;
  isUpgrade: boolean;
  warnings: string[];
}

export type PluginImportVersionPolicy = 'allowOverwrite' | 'upgradeOnly';

export interface PluginImportOptions {
  versionPolicy: PluginImportVersionPolicy;
  menuTitleOverride?: string | null;
  menuRoutePathOverride?: string | null;
}

export interface DiscoverPlugin {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  downloads: string;
  rating: number;
}
