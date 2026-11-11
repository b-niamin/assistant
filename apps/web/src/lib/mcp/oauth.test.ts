import { describe, expect, it } from 'vitest';
import { authServerMetadata, basicAuth, escapeHtml, pkceMatches, publicBase, redirectWith, resourceMetadata, sha256, validRedirectUri } from './oauth';
import { isMcpPath, isOAuthApi } from './paths.js';

describe('claude connector oauth', () => {
  it('checks PKCE S256 only', () => {
    const verifier = 'v'.repeat(43);
    expect(pkceMatches(verifier, sha256(verifier))).toBe(true);
    expect(pkceMatches(verifier, verifier)).toBe(false);
    expect(pkceMatches('short', sha256('short'))).toBe(false);
  });
  it('allows https callbacks and loopback http only', () => {
    expect(validRedirectUri('https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(validRedirectUri('http://127.0.0.1:33418/callback')).toBe(true);
    expect(validRedirectUri('http://evil.example/cb')).toBe(false);
    expect(validRedirectUri('https://x.example/cb#frag')).toBe(false);
    expect(validRedirectUri('javascript:alert(1)')).toBe(false);
  });
  it('believes the Host only for the public host name', () => {
    const origin = 'https://nas.tail1.ts.net';
    expect(publicBase('nas.tail1.ts.net:8443', origin)).toBe('https://nas.tail1.ts.net:8443');
    expect(publicBase('evil.example:8443', origin)).toBe(origin);
    expect(publicBase('web:3000', origin)).toBe(origin);
    expect(publicBase(null, origin)).toBe(origin);
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
    for (const p of ['/mcp', '/mcp/oauth/authorize', '/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-authorization-server'])
      expect(isMcpPath(p)).toBe(true);
    for (const p of ['/', '/login', '/settings', '/mcpx', '/api/kv/gym', '/.well-known/other', '/_app/immutable/x.js']) expect(isMcpPath(p)).toBe(false);
    expect(isOAuthApi('/mcp/oauth/token')).toBe(true);
    expect(isOAuthApi('/mcp/oauth/authorize')).toBe(false);
  });
});
