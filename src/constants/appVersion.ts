const pkg = require('../../package.json') as { version?: string };

const rawVersion = typeof pkg.version === 'string' && pkg.version.trim() ? pkg.version.trim() : '0.0.0';

export const APP_VERSION = rawVersion;
export const APP_VERSION_LABEL = `v${APP_VERSION}`;
