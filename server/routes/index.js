import { registerAuthRoutes } from './auth.js';
import { registerOrgRoutes } from './orgs.js';
import { registerInviteRoutes } from './invites.js';
import { registerDeviceAndGrantRoutes } from './devices.js';
import { registerSessionRoutes } from './sessions.js';

export function registerRoutes(router, deps) {
  registerAuthRoutes(router, deps);
  registerInviteRoutes(router, deps);
  registerDeviceAndGrantRoutes(router, deps);
  registerSessionRoutes(router, deps);
  registerOrgRoutes(router, deps);
}

