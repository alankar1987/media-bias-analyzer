const SUPABASE_URL = 'https://cxvjuokolqjesxcppovt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN4dmp1b2tvbHFqZXN4Y3Bwb3Z0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3MzU3MzEsImV4cCI6MjA5MjMxMTczMX0.8BpUKM1sdPHBaMOXxV2HpPseMkBPrK-QuBSBjwfNyAk';

const _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let _session = null;

async function authInit() {
  const { data } = await _sb.auth.getSession();
  _session = data.session;
  _sb.auth.onAuthStateChange((_event, session) => {
    _session = session;
    renderAuthUI();
  });
  renderAuthUI();

  if (window.location.search.includes('upgraded=1')) {
    showToast('Subscription activated! You now have 30 analyses/month.', 'success');
    history.replaceState(null, '', window.location.pathname);
  }
}

function getSession() {
  return _session;
}

function getToken() {
  return _session?.access_token ?? null;
}

async function signInWithGoogle() {
  await _sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  });
}

async function signOut() {
  await _sb.auth.signOut();
}

function renderAuthUI() {
  const container = document.getElementById('nav-right');
  if (!container) return;
  if (_session) {
    const email = _session.user.email;
    const initial = email[0].toUpperCase();
    container.innerHTML = `<div class="nav-avatar" id="nav-avatar-btn" title="${email}">${initial}</div>`;
    document.getElementById('nav-avatar-btn').addEventListener('click', () => {
      if (typeof showPage === 'function') showPage('account');
      if (typeof loadAccountUsage === 'function') loadAccountUsage();
    });
  } else {
    container.innerHTML = `<button class="nav-signin-btn" onclick="signInWithGoogle()">Sign in</button>`;
  }
}

async function authSignOut() {
  await signOut();
  if (typeof showPage === 'function') showPage('home');
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

document.addEventListener('DOMContentLoaded', authInit);
