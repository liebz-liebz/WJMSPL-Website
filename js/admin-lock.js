// The admin "lock" (data/admin.json) and the League admin → Settings tab.
//
// data/admin.json holds the GitHub connection, encrypted so it can only be read with a password:
//   - The connection is encrypted with a random data key (AES-GCM).
//   - That data key is stored twice: once locked with the admin password (shared with everyone who
//     enters results) and once with the super secret key (known only to the site owner).
// Either one signs in. Changing the admin password, the secret key or the GitHub token needs the
// secret key. (Version 1 files, from before the secret key existed, lock the connection with the
// admin password directly; Settings offers to upgrade them.)

const PBKDF2_ITERATIONS = 600000;

function bytesToB64(bytes) {
  let bin = '';
  bytes.forEach(b => (bin += String.fromCharCode(b)));
  return btoa(bin);
}
function b64ToBytes(b64) {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}
async function passwordKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function aesEncrypt(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return { iv: bytesToB64(iv), data: bytesToB64(new Uint8Array(data)) };
}
async function aesDecrypt(key, { iv, data }) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(iv) }, key, b64ToBytes(data)));
}
function dataKey(dekBytes) {
  return crypto.subtle.importKey('raw', dekBytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

// Lock the data key with a password.
async function wrapDek(dek, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: bytesToB64(salt), iterations: PBKDF2_ITERATIONS, ...await aesEncrypt(await passwordKey(password, salt, PBKDF2_ITERATIONS), dek) };
}
// Throws if the password is wrong.
async function unwrapDek(entry, password) {
  return aesDecrypt(await passwordKey(password, b64ToBytes(entry.salt), entry.iterations), entry);
}

// Only the connection details get encrypted, never session extras.
function connectionOnly(c) {
  return { token: c.token, owner: c.owner, repo: c.repo, branch: c.branch };
}
async function encryptConnection(dek, creds) {
  return aesEncrypt(await dataKey(dek), new TextEncoder().encode(JSON.stringify(connectionOnly(creds))));
}
async function decryptConnection(dek, lock) {
  return JSON.parse(new TextDecoder().decode(await aesDecrypt(await dataKey(dek), lock)));
}

async function buildLock(dek, creds, adminEntry, secretEntry) {
  return { version: 2, ...await encryptConnection(dek, creds), keys: { admin: adminEntry, secret: secretEntry } };
}

// Sign in with the admin password or the secret key. Returns the connection plus the data key
// (kept in the session so a replaced GitHub token can be picked up without signing in again).
async function unlock(lock, password) {
  if (lock.version !== 2) {
    const v1 = await aesDecrypt(await passwordKey(password, b64ToBytes(lock.salt), lock.iterations), lock);
    return JSON.parse(new TextDecoder().decode(v1));
  }
  for (const entry of [lock.keys.admin, lock.keys.secret]) {
    try {
      const dek = await unwrapDek(entry, password);
      return { ...await decryptConnection(dek, lock), dek: bytesToB64(dek) };
    } catch { /* try the other key */ }
  }
  throw new Error('Wrong password');
}

function checkNewPassword(pw, pw2, what) {
  if (!pw || pw.length < 8) throw new Error(`The ${what} must be at least 8 characters.`);
  if (pw !== pw2) throw new Error(`The two ${what} entries don't match.`);
}
async function unwrapSecret(lock, secret) {
  if (!lock || lock.version !== 2) throw new Error('No super secret key has been set yet.');
  try {
    return await unwrapDek(lock.keys.secret, secret);
  } catch {
    throw new Error('The super secret key is incorrect.');
  }
}

// Reads data/admin.json from GitHub, lets `change` build the new lock, and commits it with `creds`.
async function updateLock(creds, change, message) {
  try {
    return JSON.parse(await ghUpdateFile(creds, 'data/admin.json',
      async remote => JSON.stringify(await change(remote ? JSON.parse(remote) : null), null, 2) + '\n', message));
  } catch (e) {
    if (e.status === 403) throw new Error(`The GitHub token can't write to ${creds.owner}/${creds.repo}. Make sure it has access to that repository with Contents set to “Read and write”.`);
    throw e;
  }
}

// First-time setup: new data key, locked with both passwords.
async function createLock(creds, adminPw, secret) {
  if (!creds.token) throw new Error('Enter a GitHub token.');
  const dek = crypto.getRandomValues(new Uint8Array(32));
  await updateLock(creds, async () => buildLock(dek, creds, await wrapDek(dek, adminPw), await wrapDek(dek, secret)),
    'Set up league admin passwords');
  return { ...connectionOnly(creds), dek: bytesToB64(dek) };
}

// Keep the session in sync after a change, in whichever storage it lives.
function refreshSession(creds) {
  let remembered = false;
  try { remembered = !!localStorage.getItem(SESSION_KEY); } catch { /* storage blocked */ }
  admin.creds = creds;
  storeSession(creds, remembered);
}

// Another admin replaced the GitHub token: pick up the new one from the lock using the session's data key.
async function refreshTokenFromLock() {
  if (!admin.creds || !admin.creds.dek) return false;
  try {
    const lock = await fetchJSON('data/admin.json');
    if (lock.version !== 2) return false;
    const creds = await decryptConnection(b64ToBytes(admin.creds.dek), lock);
    if (creds.token === admin.creds.token) return false;
    refreshSession({ ...creds, dek: admin.creds.dek });
    return true;
  } catch {
    return false;
  }
}

// The lock as saved: from GitHub when the session's token works, else from the website.
async function currentLock() {
  try {
    return JSON.parse((await ghReadFile(admin.creds, 'data/admin.json')).text);
  } catch {
    return fetchJSON('data/admin.json');
  }
}

// ---------- settings tab ----------

async function renderSettingsTab() {
  const body = document.getElementById('admin-body');
  body.innerHTML = '<p class="muted">Loading…</p>';
  let lock = null;
  try { lock = await currentLock(); } catch { /* treated as no secret key yet */ }
  if (admin.tab !== 'settings' || !document.getElementById('admin-body')) return;
  const c = admin.creds;
  const hasSecret = lock && lock.version === 2;

  const who = `<section class="card">
      <h2>Who can update the site</h2>
      <p>Anyone with the admin password. Send them the website link and the password; they click
        <strong>League admin</strong> at the bottom of any page and sign in. No GitHub account needed.</p>
      ${hasSecret ? `<p class="muted small" style="margin-bottom:0">Changing the admin password or the GitHub connection needs the
        <strong>super secret key</strong>, which only the site owner should know. The secret key also signs in, so the owner can
        always get back in and reset a forgotten admin password.</p>` : ''}
    </section>`;

  if (!hasSecret) {
    body.innerHTML = `${who}
      <section class="card">
        <h2>Set the super secret key</h2>
        <p>Right now anyone with the admin password can change it. Set a super secret key that only you know;
          after that, changing the admin password or the GitHub connection requires it.</p>
        <form id="secret-setup" class="form-stack">
          <label class="field">Current admin password<input type="password" id="ss-admin" autocomplete="current-password" required></label>
          <div class="form-grid">
            <label>Super secret key<input type="password" id="ss-secret" autocomplete="new-password" required minlength="8"></label>
            <label>Confirm super secret key<input type="password" id="ss-secret2" autocomplete="new-password" required></label>
          </div>
          <div><button class="btn" type="submit">Set secret key</button></div>
        </form>
        <p class="muted small">Use something different from the admin password, and keep it somewhere safe. If both are lost,
          the site owner has to redo the admin setup with a new GitHub token.</p>
      </section>`;
    document.getElementById('secret-setup').onsubmit = e => {
      e.preventDefault();
      const v = id => document.getElementById(id).value;
      runLockChange(e.target, async () => {
        checkNewPassword(v('ss-secret'), v('ss-secret2'), 'super secret key');
        if (v('ss-secret') === v('ss-admin')) throw new Error('Use a secret key that is different from the admin password.');
        let dek;
        const saved = await updateLock(admin.creds, async remote => {
          if (!remote) throw new Error("Couldn't read the current admin settings.");
          if (remote.version === 2) throw new Error('A super secret key has already been set.');
          let creds;
          try { creds = await unlock(remote, v('ss-admin')); } catch { throw new Error('The admin password is incorrect.'); }
          dek = crypto.getRandomValues(new Uint8Array(32));
          return buildLock(dek, creds, await wrapDek(dek, v('ss-admin')), await wrapDek(dek, v('ss-secret')));
        }, 'Set league admin secret key');
        refreshSession({ ...await decryptConnection(dek, saved), dek: bytesToB64(dek) });
        return '<strong>Super secret key set.</strong> From now on it is needed to change the admin password or the GitHub connection.';
      });
    };
    return;
  }

  body.innerHTML = `${who}
    <section class="card">
      <h2>Change the admin password</h2>
      <form id="pw-form" class="form-stack">
        <label class="field">Super secret key to change admin password<input type="password" id="pw-secret" autocomplete="off" required></label>
        <div class="form-grid">
          <label>New admin password<input type="password" id="np" autocomplete="new-password" required minlength="8"></label>
          <label>Confirm new admin password<input type="password" id="np2" autocomplete="new-password" required></label>
        </div>
        <div><button class="btn" type="submit">Change admin password</button></div>
      </form>
      <p class="muted small">Everyone already signed in stays signed in. New sign-ins need the new password
        (it takes a few minutes for the change to reach the live site).</p>
    </section>
    <section class="card">
      <h2>Change the super secret key</h2>
      <form id="secret-form" class="form-stack">
        <label class="field">Current super secret key<input type="password" id="sk-old" autocomplete="off" required></label>
        <div class="form-grid">
          <label>New super secret key<input type="password" id="sk-new" autocomplete="new-password" required minlength="8"></label>
          <label>Confirm new super secret key<input type="password" id="sk-new2" autocomplete="new-password" required></label>
        </div>
        <div><button class="btn" type="submit">Change secret key</button></div>
      </form>
    </section>
    <section class="card">
      <h2>GitHub connection</h2>
      <p>Saving to <code>${esc(c.owner)}/${esc(c.repo)}</code> on branch <code>${esc(c.branch)}</code>.
        GitHub tokens expire; when this one does, saving stops working until the owner creates a new token
        (same steps as the first setup: <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">new fine-grained token</a>,
        this repository only, <em>Contents: Read and write</em>) and enters it here. Other admins pick up the new token automatically.</p>
      <form id="tok-form" class="form-stack">
        <label class="field">Super secret key<input type="password" id="tk-secret" autocomplete="off" required></label>
        <label class="field">New GitHub token<input type="password" id="nt" placeholder="github_pat_…" autocomplete="off" required></label>
        <div><button class="btn" type="submit">Update token</button></div>
      </form>
    </section>`;

  const v = id => document.getElementById(id).value;
  document.getElementById('pw-form').onsubmit = e => {
    e.preventDefault();
    runLockChange(e.target, async () => {
      checkNewPassword(v('np'), v('np2'), 'admin password');
      await updateLock(admin.creds, async remote => {
        const dek = await unwrapSecret(remote, v('pw-secret'));
        if (v('np') === v('pw-secret')) throw new Error('Use an admin password that is different from the secret key.');
        return { ...remote, keys: { ...remote.keys, admin: await wrapDek(dek, v('np')) } };
      }, 'Change league admin password');
      return '<strong>Admin password changed.</strong> Remember to tell the other admins.';
    });
  };
  document.getElementById('secret-form').onsubmit = e => {
    e.preventDefault();
    runLockChange(e.target, async () => {
      checkNewPassword(v('sk-new'), v('sk-new2'), 'super secret key');
      await updateLock(admin.creds, async remote => {
        const dek = await unwrapSecret(remote, v('sk-old'));
        return { ...remote, keys: { ...remote.keys, secret: await wrapDek(dek, v('sk-new')) } };
      }, 'Change league admin secret key');
      return '<strong>Super secret key changed.</strong>';
    });
  };
  document.getElementById('tok-form').onsubmit = e => {
    e.preventDefault();
    runLockChange(e.target, async () => {
      const token = v('nt').trim();
      if (!token) throw new Error('Enter the new GitHub token.');
      const next = { ...connectionOnly(admin.creds), token };
      // Check the secret key before touching GitHub with the new token.
      await unwrapSecret(await currentLock(), v('tk-secret'));
      let dek;
      // Written with the new token, which also proves it can save to the repository.
      await updateLock(next, async remote => {
        dek = await unwrapSecret(remote, v('tk-secret'));
        return { ...remote, ...await encryptConnection(dek, next) };
      }, 'Update league admin GitHub token');
      refreshSession({ ...next, dek: bytesToB64(dek) });
      if (admin.loadError) admin.ready = false;
      return '<strong>GitHub token updated.</strong> Saving works again.';
    });
  };
}

// Runs one of the Settings forms: busy state, success message, errors.
async function runLockChange(form, fn) {
  setBusy(true);
  try {
    const okMsg = await fn();
    form.reset();
    admin.message = { kind: 'ok', html: okMsg };
    if (!admin.ready) return renderAdmin();
    await renderSettingsTab();
    showMessage(okMsg, 'ok');
  } catch (e) {
    showMessage(`<strong>Couldn't save:</strong> ${esc(e.message)}`);
  } finally {
    setBusy(false);
  }
}
