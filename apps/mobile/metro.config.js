/* eslint-disable @typescript-eslint/no-require-imports -- Metro requires CommonJS */
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

// The app lives in a pnpm workspace, so Metro must watch the repo root and
// resolve the hoisted node_modules as well as the app's own.
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
