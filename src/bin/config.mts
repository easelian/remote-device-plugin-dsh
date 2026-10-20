/**
 * Deployment defaults for the Remote Device Hub bridge.
 *
 * Change `DIRECT_PORT` (or `DIRECT_HOST`) here to move the Hub's direct OAuth
 * origin. Every environment variable below remains an override, so a profile
 * can change one deployment without editing this file.
 *
 *   RDH_MCP_URL        full MCP endpoint
 *   RDH_PUBLIC_ORIGIN  public browser/OAuth origin
 *   RDH_DIRECT_ORIGIN  full direct OAuth/MCP origin
 *   RDH_OAUTH_PORT     preferred loopback callback port
 */

/** Public origin used by the browser authorization page and the MCP endpoint. */
export const PUBLIC_ORIGIN = 'https://mcp.xdistribute.site'

/** Host of the Hub's direct origin. */
export const DIRECT_HOST = 'https://xdistribute.site'

/** Port of the Hub's direct origin. Change this to move the direct service. */
export const DIRECT_PORT = 8090

/** Default MCP endpoint; `RDH_MCP_URL` overrides it. */
export const DEFAULT_ENDPOINT = `${PUBLIC_ORIGIN}/mcp`

/** Default direct origin; `RDH_DIRECT_ORIGIN` overrides it. */
export const DEFAULT_DIRECT_ORIGIN = `${DIRECT_HOST}:${DIRECT_PORT}`

/** Preferred loopback OAuth callback port; `RDH_OAUTH_PORT` overrides it. */
export const DEFAULT_OAUTH_PORT = 3335
