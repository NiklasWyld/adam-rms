const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {execFileSync} = require('node:child_process');
const {request} = require('../../e2e/node_modules/@playwright/test');

(async () => {
  assert.equal(process.env.ADAMRMS_DEVCONTAINER, 'true', 'Only run in the development container');
  assert.equal(process.env.DEV_MODE, 'true');
  assert.equal(process.env.DB_HOSTNAME, 'db');
  assert.equal(process.env.DB_DATABASE, 'db');
  const root = path.resolve(__dirname, '../..');
  const expected = process.env.EXPECTED_ROOTURL;
  assert.ok(expected && expected.startsWith('https://'), 'Set EXPECTED_ROOTURL to the private Codespace URL');
  const env = {...process.env};
  delete env.CODESPACE_NAME;
  delete env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
  delete env.ADAMRMS_LOGIN_ENV_LOADED;
  const pidFile = '/tmp/adamrms-dev/server.pid';
  if (fs.existsSync(pidFile)) {
    const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
    assert.ok(Number.isSafeInteger(pid) && pid > 1);
    let command = '';
    try { command = execFileSync('ps', ['-p', String(pid), '-o', 'args='], {encoding:'utf8'}).trim(); } catch {}
    if (command === 'php -S 0.0.0.0:8080 -t src') {
      process.kill(pid, 'SIGTERM');
      for (let attempt = 0; attempt < 50; attempt++) {
        if (!fs.existsSync('/proc/' + pid + '/cmdline') ||
            !fs.readFileSync('/proc/' + pid + '/cmdline').length) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } else {
      assert.ok(!command || command.includes('<defunct>'), 'Refusing to stop an unrelated process');
    }
  }
  execFileSync('bash', ['.devcontainer/scripts/start.sh'], {cwd:root, env, stdio:'inherit'});
  const api = await request.newContext({baseURL:'http://127.0.0.1:8080'});
  try {
    const login = await api.get('/login/');
    assert.equal(login.status(), 200);
    const html = await login.text();
    assert.ok(html.includes('id="passwordInput"'));
    assert.ok(html.includes(expected + '/static-assets/'), 'Login assets must use the Codespace URL');
    assert.ok(!html.includes('http://localhost:8080'), 'No localhost links in the hosted login page');
    const auth = await api.post('/api/login/login.php', {
      form:{formInput:'username', password:'password!'}
    });
    const result = await auth.json();
    assert.equal(result.result, true, 'The default development login must work');
    assert.equal(result.response.redirect.replace(/\/$/, ''), expected);
    const dashboard = await api.get('/');
    assert.equal(dashboard.status(), 200);
    assert.ok(/<title>Dashboard \| AdamRMS/.test(await dashboard.text()), 'Dashboard must render');
    const pid = fs.readFileSync(pidFile, 'utf8');
    execFileSync('bash', ['.devcontainer/scripts/start.sh'], {cwd:root, env, stdio:'inherit'});
    assert.equal(fs.readFileSync(pidFile, 'utf8'), pid, 'Repeated startup must reuse the server');
    console.log('PASS: non-login SSH startup, HTTPS URLs, login, dashboard and repeated startup');
  } finally { await api.dispose(); }
})().catch(error => { console.error(error.message); process.exit(1); });
