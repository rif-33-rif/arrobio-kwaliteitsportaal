import { useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function Account() {
  const { user } = useAuth();
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [mfaEnabled, setMfaEnabled] = useState(user?.mfaEnabled || false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function handleStartSetup() {
    setError('');
    setMessage('');
    try {
      const data = await api.post('/auth/mfa/setup', {});
      setSetup(data);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleEnable(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      await api.post('/auth/mfa/enable', { code });
      setSetup(null);
      setCode('');
      setMfaEnabled(true);
      setMessage('MFA is ingeschakeld voor dit account.');
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDisable(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      await api.post('/auth/mfa/disable', { password });
      setPassword('');
      setMfaEnabled(false);
      setMessage('MFA is uitgeschakeld voor dit account.');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <h1>Mijn account</h1>
      <p className="muted">{user?.name} — {user?.email}</p>

      {error && <div className="alert-error">{error}</div>}
      {message && <div className="alert-warning">{message}</div>}

      <h2>Meerfactorauthenticatie (MFA)</h2>
      <p className="muted">
        {mfaEnabled ? 'MFA staat aan voor dit account.' : 'MFA staat uit. We raden aan dit in te schakelen, zeker voor beheerder- en managerrollen.'}
      </p>

      {!mfaEnabled && !setup && (
        <button className="btn-primary" onClick={handleStartSetup}>MFA instellen</button>
      )}

      {setup && (
        <form className="inline-form" onSubmit={handleEnable}>
          <p>Voeg dit account handmatig toe aan je authenticator-app (bv. Google Authenticator, Microsoft Authenticator):</p>
          <p><strong>Sleutel:</strong> <code>{setup.secret}</code></p>
          <p className="muted small">Account: {user?.email} — Uitgever: Arrobio Kwaliteitsportaal — Type: tijdgebaseerd (TOTP), 6 cijfers, 30 seconden</p>
          <label>Voer de eerste code uit de app in ter bevestiging
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={6} required />
          </label>
          <button type="submit" className="btn-primary">Bevestigen en inschakelen</button>
        </form>
      )}

      {mfaEnabled && (
        <form className="inline-form" onSubmit={handleDisable}>
          <label>Wachtwoord (ter bevestiging)
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          <button type="submit" className="btn-secondary">MFA uitschakelen</button>
        </form>
      )}
    </div>
  );
}
