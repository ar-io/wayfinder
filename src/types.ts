export type RedirectedTabInfo = {
    originalGateway: string; // The original gateway FQDN (e.g., "permagate.io")
    expectedSandboxRedirect: boolean; // Whether we expect a sandbox redirect
    sandboxRedirectUrl?: string; // The final redirected URL (if applicable)
    startTime: number; // Timestamp of when the request started
  };
