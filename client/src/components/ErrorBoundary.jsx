import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Onverwachte fout in de applicatie:', error, info);
  }

  handleReload = () => {
    this.setState({ error: null });
    window.location.href = '/';
  };

  render() {
    if (this.state.error) {
      return (
        <div className="login-screen">
          <div className="login-card">
            <h1>Er is iets misgegaan</h1>
            <p className="muted">
              Er trad een onverwachte fout op. Je werk in het systeem is niet verloren; probeer de pagina opnieuw te laden.
            </p>
            <button className="btn-primary" onClick={this.handleReload}>Terug naar het dashboard</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
