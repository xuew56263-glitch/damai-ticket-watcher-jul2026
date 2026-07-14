const token = String(process.env.GITHUB_TOKEN || '').trim();
const repository = String(process.env.LIVE_STATUS_REPOSITORY || '').trim();
const workflow = String(process.env.LIVE_STATUS_WORKFLOW || 'damai-monitor.yml').trim();
const ref = String(process.env.LIVE_STATUS_REF || 'main').trim();
const expiresAt = Date.parse(process.env.WATCHER_EXPIRES_AT || '2026-07-15T18:00:00+08:00');

async function workflowRequest(suffix, method, body) {
  const response = await fetch(`https://api.github.com/repos/${repository}/actions/workflows/${encodeURIComponent(workflow)}${suffix}`, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!response.ok) {
    throw new Error(`Workflow ${method} ${suffix || '/'} returned HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
}

async function main() {
  if (!token || !repository) throw new Error('GitHub continuation settings are missing.');
  if (!Number.isFinite(expiresAt)) throw new Error('WATCHER_EXPIRES_AT is invalid.');
  if (Date.now() >= expiresAt) {
    await workflowRequest('/disable', 'PUT');
    console.log('Monitoring deadline reached; the workflow is disabled.');
    return;
  }
  await workflowRequest('/dispatches', 'POST', { ref });
  console.log('The next continuous monitoring run was dispatched.');
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
