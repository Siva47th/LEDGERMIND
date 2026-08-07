import { useState, useEffect } from 'react'
import './App.css'

function App() {
  const [health, setHealth] = useState({
    status: 'loading', // 'loading' | 'ok' | 'error'
    data: null,
    error: null
  });
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);

  const addLog = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev.slice(-9), { timestamp, message, type }]); // Keep last 10 logs
  };

  const checkHealth = async () => {
    setLoading(true);
    addLog('Initiating backend health check...', 'info');
    
    try {
      // Flask server runs on port 5000 by default
      const response = await fetch('http://localhost:5000/api/health');
      const data = await response.json();
      
      if (response.ok && data.status === 'ok') {
        setHealth({
          status: 'ok',
          data: data,
          error: null
        });
        addLog(`Backend responded successfully. DB Status: ${data.database}`, 'success');
      } else {
        setHealth({
          status: 'error',
          data: data,
          error: `Unhealthy response: ${data.message || 'Unknown error'}`
        });
        addLog(`Backend reported unhealthy status: ${data.message || 'Unknown'}`, 'error');
      }
    } catch (err) {
      setHealth({
        status: 'error',
        data: null,
        error: err.message || 'Could not connect to Flask server'
      });
      addLog(`Failed to connect to backend server at http://localhost:5000`, 'error');
      addLog(`Error details: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Perform health check on component mount
  useEffect(() => {
    addLog('FinSense Dashboard loaded.', 'info');
    checkHealth();
  }, []);

  return (
    <div className="dashboard-container">
      {/* Brand Section */}
      <header className="brand-section">
        <div className="brand-logo-container">
          <div className="brand-logo-icon">FS</div>
        </div>
        <div className="brand-info">
          <h1>FinSense</h1>
          <p>AI-Driven Invoice Intelligence & Cash Flow Forecasting</p>
        </div>
      </header>

      {/* Status Card */}
      <main className="status-card">
        <div className="card-header">
          <h2 className="card-title">System Connectivity</h2>
          
          <div className={`pulse-badge ${health.status}`}>
            <span className="pulse-dot"></span>
            <span>
              {health.status === 'loading' && 'Checking...'}
              {health.status === 'ok' && 'Healthy'}
              {health.status === 'error' && 'Error'}
            </span>
          </div>
        </div>

        {health.status === 'error' && (
          <div className="error-message">
            <strong>Connection Failed:</strong> {health.error}
            <br />
            <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
              Ensure your Flask server is running on <code>localhost:5000</code>. Run <code>python backend/app.py</code> in your workspace.
            </span>
          </div>
        )}

        {/* Metrics Grid */}
        <div className="grid-metrics">
          <div className="metric-item">
            <div className="metric-label">API Status</div>
            <div className={`metric-value ${health.status === 'ok' ? 'highlight-green' : 'highlight-blue'}`}>
              {health.status === 'ok' ? 'Online' : health.status === 'loading' ? 'Connecting...' : 'Offline'}
            </div>
          </div>
          <div className="metric-item">
            <div className="metric-label">SQLite Database</div>
            <div className={`metric-value ${health.status === 'ok' && health.data?.database === 'connected' ? 'highlight-green' : 'highlight-blue'}`}>
              {health.status === 'ok' && health.data?.database === 'connected' ? 'Connected' : 'Disconnected'}
            </div>
          </div>
          <div className="metric-item">
            <div className="metric-label">Environment</div>
            <div className="metric-value highlight-purple">
              {health.status === 'ok' ? health.data.environment : 'Development'}
            </div>
          </div>
          <div className="metric-item">
            <div className="metric-label">Server Host</div>
            <div className="metric-value highlight-blue">
              localhost:5000
            </div>
          </div>
        </div>

        {/* Dev Console / Logger */}
        <h3 style={{ fontSize: '0.9rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'left', marginBottom: '0.5rem' }}>
          Console Log
        </h3>
        <div className="system-logs">
          {logs.map((log, index) => (
            <div key={index} className="log-line">
              <span className="timestamp">[{log.timestamp}]</span>
              <span className="prefix">&gt;</span>
              <span style={{ color: log.type === 'error' ? '#f87171' : log.type === 'success' ? '#34d399' : '#e2e8f0' }}>
                {log.message}
              </span>
            </div>
          ))}
        </div>

        {/* Action Button */}
        <div className="action-bar">
          <button 
            className="btn-primary" 
            onClick={checkHealth} 
            disabled={loading}
          >
            {loading && <span className="loading-spinner"></span>}
            {loading ? 'Verifying...' : 'Re-check Connection'}
          </button>
        </div>
      </main>

      <footer className="footer">
        FinSense Academic Project · Under Construction · Week 1 Baseline Done
      </footer>
    </div>
  );
}

export default App;
