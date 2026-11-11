import { describe, expect, it } from 'vitest';
import { authServerMetadata, basicAuth, canWrite, endpointOfResource, escapeHtml, knownScope, pkceMatches, publicBase, redirectHosts, redirectWith, resourceMetadata, scopeFor, sha256, userCode, validRedirectUri } from './oauth';
import { isMcpPath, isOAuthApi } from './paths.js';

describe('claude connector oauth', () => {
  it('checks PKCE S256 only', () => {
    const verifier = 'v'.repeat(43);
    expect(pkceMatches(verifier, sha256(verifier))).toBe(true);
    expect(pkceMatches(verifier, verifier)).toBe(false);
    expect(pkceMatches('short', sha256('short'))).toBe(false);
  });
  it("allows Claude's https callbacks and loopback http only", () => {
    expect(validRedirectUri('https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(validRedirectUri('https://claude.com/api/mcp/auth_callback')).toBe(true);
    expect(validRedirectUri('https://evil.example/cb')).toBe(false);
    expect(validRedirectUri('https://claude.ai.evil.example/cb')).toBe(false);
    expect(validRedirectUri('https://mcp.example/cb', redirectHosts(' MCP.example ,'))).toBe(true);
    expect(validRedirectUri('http://127.0.0.1:33418/callback')).toBe(true);
    expect(validRedirectUri('http://evil.example/cb')).toBe(false);
    expect(validRedirectUri('https://claude.ai/cb#frag')).toBe(false);
    expect(validRedirectUri('javascript:alert(1)')).toBe(false);
  });
  it('knows the scopes: read, or read and write', () => {
    expect(knownScope(null)).toBe(true);
    expect(knownScope('mcp')).toBe(true);
    expect(knownScope('mcp:read mcp:write')).toBe(true);
    expect(knownScope('admin')).toBe(false);
    expect(canWrite(scopeFor(false))).toBe(false);
    expect(canWrite(scopeFor(true))).toBe(true);
    expect(userCode()).toMatch(/^[A-Z]{4}-[A-Z]{4}$/);
  });
  it('believes the Host only for the public host name', () => {
    const origin = 'https://nas.tail1.ts.net';
    expect(publicBase('nas.tail1.ts.net:8443', origin)).toBe('https://nas.tail1.ts.net:8443');
    expect(publicBase('evil.example:8443', origin)).toBe(origin);
    expect(publicBase('web:3000', origin)).toBe(origin);
    expect(publicBase(null, origin)).toBe(origin);
  });
  it("reads the MCP address a client names as its resource", () => {
    expect(endpointOfResource('https://nas.ts.net:8443/mcp/x/eabcdefghij0123456789')).toBe('eabcdefghij0123456789');
    expect(endpointOfResource('https://nas.ts.net:8443/mcp')).toBe(null);
    expect(endpointOfResource('nonsense')).toBe(null);
    expect(resourceMetadata('https://b', '/mcp/x/eabcdefghij0123456789').resource).toBe('https://b/mcp/x/eabcdefghij0123456789');
  });
  it('publishes the discovery documents under one base', () => {
    const base = 'https://nas.tail1.ts.net:8443';
    expect(resourceMetadata(base)).toMatchObject({ resource: `${base}/mcp`, authorization_servers: [base] });
    expect(authServerMetadata(base)).toMatchObject({ issuer: base, token_endpoint: `${base}/mcp/oauth/token`, code_challenge_methods_supported: ['S256'] });
  });
  it('builds the way back and reads basic auth', () => {
    expect(redirectWith('https://x.example/cb?a=1', { code: 'c', state: 's', error: undefined })).toBe('https://x.example/cb?a=1&code=c&state=s');
    expect(basicAuth(`Basic ${Buffer.from('id:se:cret').toString('base64')}`)).toEqual(['id', 'se:cret']);
    expect(escapeHtml(`<a href="x">'`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;');
  });
  it('lets only the MCP and OAuth paths through the public listener', () => {
    for (const p of ['/mcp', '/mcp/x/eabcdefghij0123456789', '/.well-known/oauth-protected-resource/mcp/x/eabcdefghij0123456789', '/mcp/oauth/authorize', '/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-authorization-server'])
      expect(isMcpPath(p)).toBe(true);
    for (const p of ['/', '/login', '/settings', '/mcpx', '/api/kv/gym', '/.well-known/other', '/_app/immutable/x.js', '/mcp/x/short', '/mcp/x/eabcdefghij0123456789/more']) expect(isMcpPath(p)).toBe(false);
    expect(isOAuthApi('/mcp/oauth/token')).toBe(true);
    expect(isOAuthApi('/mcp/oauth/authorize')).toBe(false);
  });
});
