// Probe the container listener, keeping the public URL's path prefix.
// Do not probe the public domain: TLS and proxy checks are separate.
try {
  const base = new URL(process.env.RELAY_URL);
  const probe = new URL('http://127.0.0.1');
  probe.port = process.env.PORT || '8787';
  probe.pathname = `${base.pathname.replace(/\/?$/, '/')}healthz`;
  const response = await fetch(probe, {
    redirect: 'error',
    signal: AbortSignal.timeout(4000),
  });
  process.exit(response.ok && (await response.text()) === 'ok' ? 0 : 1);
} catch {
  process.exit(1);
}
