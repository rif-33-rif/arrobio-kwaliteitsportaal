import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import logo from '../assets/logo.png';

export default function Login() {
  const { login, verifyMfa } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await login(email, password);
      if (result.mfaRequired) {
        setMfaToken(result.mfaToken);
      } else {
        navigate('/');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleMfaSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await verifyMfa(mfaToken, code);
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-screen">
      {!mfaToken ? (
        <form className="login-card" onSubmit={handleSubmit}>
          <div className="login-brand">
            <img src={logo} alt="Arrobio Techniek" className="login-logo" />
            <div className="login-brand-sub">KWALITEITSPORTAAL</div>
          </div>
          <p className="muted">Digitale kwaliteitsborging mutatiewoningen</p>
          {error && <div className="alert-error">{error}</div>}
          <label>
            E-mailadres
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>
            Wachtwoord
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Bezig...' : 'Inloggen'}
          </button>
        </form>
      ) : (
        <form className="login-card" onSubmit={handleMfaSubmit}>
          <div className="login-brand">
            <img src={logo} alt="Arrobio Techniek" className="login-logo" />
            <div className="login-brand-sub">KWALITEITSPORTAAL</div>
          </div>
          <p className="muted">Voer de 6-cijferige code uit je authenticator-app in</p>
          {error && <div className="alert-error">{error}</div>}
          <label>
            Verificatiecode
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={6} required autoFocus />
          </label>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Bezig...' : 'Bevestigen'}
          </button>
          <button type="button" className="btn-link" onClick={() => { setMfaToken(''); setCode(''); setError(''); }}>
            Terug naar inloggen
          </button>
        </form>
      )}
    </div>
  );
}
