import { loadConfig, webEnvSchema } from '@workspace/config';

export default async function Page() {
  const config = loadConfig(webEnvSchema);
  let healthStatus = 'Fetching...';
  let errorMsg = null;
  let envelope = null;

  try {
    // Attempt to hit the API health check
    // We disable caching to ensure we get live status on each refresh
    const res = await fetch(`${config.VITE_API_URL}/health`, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`Failed to fetch API: ${res.status}`);
    }
    const data = await res.json();
    healthStatus = data.status || 'unknown';
  } catch (error) {
    healthStatus = 'error';
    errorMsg = error.message;
  }

  // Also test our OperationalError route to verify the envelope structure
  try {
    const res2 = await fetch(`${config.VITE_API_URL}/simulate-operational-error`, {
      cache: 'no-store',
    });
    envelope = await res2.json();
  } catch (error) {
    console.error('Failed to test operational error route:', error);
  }

  return (
    <div className="container py-10 flex flex-col items-center justify-center min-h-[60vh] gap-8">
      <h1 className="text-4xl font-bold text-primary">Collaborative Workspace</h1>

      <div className="flex gap-4">
        <div className="p-6 border rounded-lg shadow-sm bg-card">
          <h2 className="text-xl font-semibold mb-2">API Health Status</h2>
          <div
            className={`px-4 py-2 rounded font-medium inline-block ${healthStatus === 'ok' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100' : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100'}`}
          >
            {healthStatus.toUpperCase()}
          </div>
          {errorMsg && <p className="text-sm text-destructive mt-2">{errorMsg}</p>}
        </div>

        <div className="p-6 border rounded-lg shadow-sm bg-card max-w-sm">
          <h2 className="text-xl font-semibold mb-2">Error Envelope Test</h2>
          {envelope ? (
            <pre className="text-xs bg-muted p-4 rounded overflow-auto">
              {JSON.stringify(envelope, null, 2)}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground">Not fetched.</p>
          )}
        </div>
      </div>
    </div>
  );
}
