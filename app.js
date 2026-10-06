(function () {
  const STORAGE_KEY = 'fy_supabase_config';

  function readConfig() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return {
        url: String(saved.url || window.SUPABASE_URL || '').trim(),
        anonKey: String(saved.anonKey || window.SUPABASE_ANON_KEY || '').trim(),
      };
    } catch (error) {
      return { url: '', anonKey: '' };
    }
  }

  function isConfigured(cfg) {
    return !!(
      cfg.url &&
      cfg.url.includes('supabase.co') &&
      cfg.anonKey &&
      !cfg.anonKey.includes('YOUR-ANON-KEY') &&
      !cfg.url.includes('YOUR-PROJECT')
    );
  }

  function saveConfig(cfg) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      url: cfg.url,
      anonKey: cfg.anonKey,
    }));
  }

  function renderConfigScreen(message = 'Set your Supabase URL and anonymous key to continue.') {
    const app = document.getElementById('app');
    if (!app) return;

    app.innerHTML = `
      <main style="max-width:720px;margin:48px auto;padding:24px;font-family:system-ui,sans-serif;line-height:1.5;">
        <h1 style="margin-bottom:12px;">Fy setup</h1>
        <p style="margin-bottom:20px;color:#444;">${message}</p>
        <form id="supabase-config-form" style="display:grid;gap:12px;">
          <label>
            <div style="font-weight:600;margin-bottom:6px;">Supabase URL</div>
            <input name="url" value="${(readConfig().url || '').replace(/"/g, '&quot;')}" placeholder="https://xyzcompany.supabase.co" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;" />
          </label>
          <label>
            <div style="font-weight:600;margin-bottom:6px;">Supabase anon key</div>
            <textarea name="anonKey" rows="4" placeholder="Paste your anon/public key here" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;resize:vertical;">${(readConfig().anonKey || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</textarea>
          </label>
          <button type="submit" style="padding:12px 18px;border:none;border-radius:8px;background:#111827;color:white;cursor:pointer;">Save configuration</button>
        </form>
      </main>
    `;

    const form = document.getElementById('supabase-config-form');
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      const cfg = {
        url: String(formData.get('url') || '').trim(),
        anonKey: String(formData.get('anonKey') || '').trim(),
      };

      if (!isConfigured(cfg)) {
        renderConfigScreen('Please enter a real Supabase project URL and anon key.');
        return;
      }

      saveConfig(cfg);
      window.location.reload();
    });
  }

  function boot() {
    const cfg = readConfig();

    if (!window.supabase) {
      renderConfigScreen('The Supabase client library is missing. Add your project config and reload the page.');
      return;
    }

    if (!isConfigured(cfg)) {
      renderConfigScreen('This app is not configured yet. Add your Supabase project URL and anon key.');
      return;
    }

    const sb = supabase.createClient(cfg.url, cfg.anonKey);
    const app = document.getElementById('app');
    if (!app) return;

    app.innerHTML = `
      <main style="max-width:720px;margin:48px auto;padding:24px;font-family:system-ui,sans-serif;line-height:1.5;">
        <h1 style="margin-bottom:12px;">Fy is ready</h1>
        <p style="margin-bottom:20px;">Supabase is configured successfully. You can now continue with the app logic.</p>
        <button id="continue-btn" style="padding:12px 18px;border:none;border-radius:8px;background:#2563eb;color:white;cursor:pointer;">Continue</button>
      </main>
    `;

    document.getElementById('continue-btn').addEventListener('click', async () => {
      try {
        const { data: { session }, error } = await sb.auth.getSession();
        if (error) {
          throw error;
        }

        app.innerHTML = `
          <main style="max-width:720px;margin:48px auto;padding:24px;font-family:system-ui,sans-serif;line-height:1.5;">
            <h2>Session check</h2>
            <p>${session ? 'Signed in successfully.' : 'No active session. The app is connected to Supabase.'}</p>
          </main>
        `;
      } catch (error) {
        app.innerHTML = `
          <main style="max-width:720px;margin:48px auto;padding:24px;font-family:system-ui,sans-serif;line-height:1.5;">
            <h2>Supabase connection error</h2>
            <p>${error?.message || 'Unable to connect to Supabase.'}</p>
          </main>
        `;
      }
    });
  }

  boot();
})();
