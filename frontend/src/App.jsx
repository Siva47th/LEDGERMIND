import { useState, useEffect } from 'react';
import { 
  LayoutDashboard, 
  FileText, 
  Upload, 
  Settings, 
  Search, 
  AlertCircle, 
  RefreshCw, 
  TrendingDown, 
  TrendingUp,
  FileCheck, 
  DollarSign, 
  CheckCircle,
  Clock,
  ArrowRight,
  ShieldAlert
} from 'lucide-react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, LineChart, Line, XAxis, YAxis, CartesianGrid, Legend } from 'recharts';
import './App.css';

const API_BASE = 'http://localhost:5000/api';

const CATEGORY_COLORS = {
  'Education': '#818cf8',    // Indigo
  'Utilities': '#2dd4bf',    // Teal
  'Software': '#60a5fa',     // Blue
  'Marketing': '#f472b6',    // Pink
  'Shopping': '#c084fc',     // Purple
  'Financial': '#34d399',    // Emerald
  'Miscellaneous': '#94a3b8' // Slate
};

const DEFAULT_COLOR = '#94a3b8';

function App() {
  const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard' | 'invoices' | 'upload' | 'forecast'
  const [forecastData, setForecastData] = useState(null);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [forecastError, setForecastError] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [stats, setStats] = useState({
    current_balance: 100000.0,
    total_spent: 0.0,
    total_invoices: 0,
    risk_status: 'healthy',
    category_spend: []
  });
  const [loading, setLoading] = useState(true);
  const [backendOffline, setBackendOffline] = useState(false);
  
  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  
  // File Upload State
  const [dragActive, setDragActive] = useState(false);
  const [uploadState, setUploadState] = useState({
    status: 'idle', // 'idle' | 'uploading' | 'success' | 'error'
    progress: 0,
    data: null,
    error: null
  });

  const fetchData = async (search = '', cat = 'All') => {
    setLoading(true);
    try {
      // 1. Fetch Stats
      const statsRes = await fetch(`${API_BASE}/dashboard/stats`);
      if (!statsRes.ok) throw new Error('Failed to load stats');
      const statsData = await statsRes.json();
      setStats(statsData);

      // 2. Fetch Invoices list
      let url = `${API_BASE}/invoices`;
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      if (cat !== 'All') params.append('category', cat);
      if (params.toString()) url += `?${params.toString()}`;

      const invoicesRes = await fetch(url);
      if (!invoicesRes.ok) throw new Error('Failed to load invoices');
      const invoicesData = await invoicesRes.json();
      setInvoices(invoicesData);
      
      setBackendOffline(false);
    } catch (err) {
      console.error(err);
      setBackendOffline(true);
    } finally {
      setLoading(false);
    }
  };

  const fetchForecast = async () => {
    setForecastLoading(true);
    setForecastError(null);
    try {
      const res = await fetch(`${API_BASE}/forecast`);
      if (!res.ok) throw new Error('Failed to run machine learning forecasting engines');
      const data = await res.json();
      setForecastData(data);
    } catch (err) {
      console.error(err);
      setForecastError(err.message || 'Connection lost during forecasting calculations');
    } finally {
      setForecastLoading(false);
    }
  };

  // Fetch forecast data when user opens the forecasting view tab
  useEffect(() => {
    if (activeTab === 'forecast') {
      fetchForecast();
    }
  }, [activeTab]);

  const getCombinedChartData = () => {
    if (!forecastData) return [];
    const combined = [];
    
    // Add historical actuals
    forecastData.historical.forEach(h => {
      combined.push({
        date: h.date,
        actual: h.balance,
        prophet: null,
        arima: null
      });
    });
    
    // Connect historical and forecast lines at the transition point
    const lastHistory = forecastData.historical[forecastData.historical.length - 1];
    
    const prophetMap = {};
    forecastData.prophet.forEach(p => {
      prophetMap[p.date] = p;
    });
    
    const arimaMap = {};
    forecastData.arima.forEach(a => {
      arimaMap[a.date] = a;
    });
    
    const forecastDates = Array.from(new Set([
      ...forecastData.prophet.map(p => p.date),
      ...forecastData.arima.map(a => a.date)
    ])).sort();
    
    // Stitch connection node
    if (lastHistory) {
      combined.push({
        date: lastHistory.date,
        actual: lastHistory.balance,
        prophet: lastHistory.balance,
        arima: lastHistory.balance
      });
    }
    
    forecastDates.forEach(date => {
      combined.push({
        date: date,
        actual: null,
        prophet: prophetMap[date]?.balance || null,
        arima: arimaMap[date]?.balance || null
      });
    });
    
    return combined;
  };

  // Fetch initial data and trigger on search/category change
  useEffect(() => {
    fetchData(searchQuery, selectedCategory);
  }, [selectedCategory]); // Fetch when category changes

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    fetchData(searchQuery, selectedCategory);
  };

  // Drag and drop handlers
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFileUpload(e.target.files[0]);
    }
  };

  const handleFileUpload = async (file) => {
    setUploadState({ status: 'uploading', progress: 10, data: null, error: null });
    
    // Simulate upload progress
    const progressInterval = setInterval(() => {
      setUploadState(prev => {
        if (prev.progress >= 85) {
          clearInterval(progressInterval);
          return prev;
        }
        return { ...prev, progress: prev.progress + 15 };
      });
    }, 150);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch(`${API_BASE}/invoices/upload`, {
        method: 'POST',
        body: formData,
      });

      clearInterval(progressInterval);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to process invoice');
      }

      const result = await response.json();
      setUploadState({
        status: 'success',
        progress: 100,
        data: result,
        error: null
      });

      // Reload background dashboard statistics
      fetchData(searchQuery, selectedCategory);

    } catch (err) {
      clearInterval(progressInterval);
      setUploadState({
        status: 'error',
        progress: 0,
        data: null,
        error: err.message || 'Network error occurred during processing'
      });
    }
  };

  return (
    <div className="app-container">
      {/* Sidebar Navigation */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-logo">FS</div>
          <h1 className="sidebar-title">FinSense</h1>
        </div>

        <nav className="sidebar-menu">
          <button 
            className={`menu-item ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            <LayoutDashboard size={18} />
            <span>Dashboard</span>
          </button>
          <button 
            className={`menu-item ${activeTab === 'invoices' ? 'active' : ''}`}
            onClick={() => setActiveTab('invoices')}
          >
            <FileText size={18} />
            <span>Invoices Ledger</span>
          </button>
          <button 
            className={`menu-item ${activeTab === 'upload' ? 'active' : ''}`}
            onClick={() => setActiveTab('upload')}
          >
            <Upload size={18} />
            <span>Upload Portal</span>
          </button>
          <button 
            className={`menu-item ${activeTab === 'forecast' ? 'active' : ''}`}
            onClick={() => setActiveTab('forecast')}
          >
            <TrendingUp size={18} />
            <span>Cash Forecasting</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-status-pill">
            <span className={`sidebar-status-dot ${backendOffline ? 'offline' : ''}`} style={{ backgroundColor: backendOffline ? '#ef4444' : '#34d399', boxShadow: backendOffline ? '0 0 8px #ef4444' : '0 0 8px #34d399' }}></span>
            <span>{backendOffline ? 'System Offline' : 'API Node Connected'}</span>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="main-content">
        
        {/* Top Header */}
        <header className="top-header">
          <div className="header-title-section">
            <h2>
              {activeTab === 'dashboard' && 'Financial Overview'}
              {activeTab === 'invoices' && 'Invoices Ledger'}
              {activeTab === 'upload' && 'Document Ingestion Portal'}
              {activeTab === 'forecast' && 'Cash Flow Forecasting'}
            </h2>
            <p>
              {activeTab === 'dashboard' && 'Real-time cash flow monitoring and spending insights.'}
              {activeTab === 'invoices' && 'View, search, and audit transaction records.'}
              {activeTab === 'upload' && 'Upload invoice receipts to trigger Tesseract OCR & NLP analysis.'}
              {activeTab === 'forecast' && '30-day future cash flow estimates comparing Prophet and ARIMA projections.'}
            </p>
          </div>

          <div className="header-actions">
            {activeTab === 'invoices' && (
              <form onSubmit={handleSearchSubmit} className="search-input-wrapper">
                <input 
                  type="text" 
                  placeholder="Search vendor..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <Search size={14} className="search-input-icon" />
              </form>
            )}
            
            <button 
              className="btn-primary" 
              onClick={() => fetchData(searchQuery, selectedCategory)} 
              disabled={loading}
              style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}
            >
              <RefreshCw size={14} className={loading ? 'loading-spinner' : ''} />
              <span>Sync</span>
            </button>
          </div>
        </header>

        {backendOffline ? (
          <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '3rem', textAlign: 'center' }}>
            <ShieldAlert size={48} color="#ef4444" style={{ marginBottom: '1rem' }} />
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Backend Server Offline</h3>
            <p style={{ color: '#64748b', maxWidth: '400px', margin: '0.5rem 0 1.5rem 0', fontSize: '0.9rem' }}>
              We could not connect to the local Flask API. Please ensure your backend server is running via <code>python backend/app.py</code> on port 5000.
            </p>
            <button className="btn-primary" onClick={() => fetchData(searchQuery, selectedCategory)}>
              Retry Connection
            </button>
          </div>
        ) : (
          <>
            {/* 1. DASHBOARD VIEW */}
            {activeTab === 'dashboard' && (
              <>
                {/* Balance + Metrics Row */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.5rem' }}>
                  
                  {/* Ledger Mesh Balance Card */}
                  <div className="mesh-balance-card" style={{ height: 'auto', minHeight: '130px' }}>
                    <div>
                      <div className="balance-label">
                        <DollarSign size={14} />
                        <span>Cash Balance Ledger</span>
                      </div>
                      <div className="balance-amount" style={{ fontSize: '1.8rem', margin: '0.25rem 0' }}>
                        Rs.{stats.current_balance ? stats.current_balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}
                      </div>
                    </div>
                    <div className="balance-footer" style={{ marginTop: '0.5rem', paddingTop: '0.5rem' }}>
                      <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Risk Threshold: Rs.10,000.00</span>
                      <span className={`balance-status-indicator ${stats.risk_status}`} style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem' }}>
                        {stats.risk_status}
                      </span>
                    </div>
                  </div>

                  {/* Summary Metric Cards */}
                  <div className="glass-card metric-mini-card">
                    <div className="metric-icon-box blue">
                      <TrendingDown size={20} />
                    </div>
                    <div className="metric-details">
                      <span className="metric-detail-label">Total Outflow</span>
                      <span className="metric-detail-value">Rs.{stats.total_spent ? stats.total_spent.toLocaleString() : '0'}</span>
                    </div>
                  </div>

                  <div className="glass-card metric-mini-card">
                    <div className="metric-icon-box indigo">
                      <FileCheck size={20} />
                    </div>
                    <div className="metric-details">
                      <span className="metric-detail-label">Total Invoices</span>
                      <span className="metric-detail-value">{stats.total_invoices}</span>
                    </div>
                  </div>

                  <div className="glass-card metric-mini-card">
                    <div className="metric-icon-box green">
                      <CheckCircle size={20} />
                    </div>
                    <div className="metric-details">
                      <span className="metric-detail-label">Safety Margin</span>
                      <span className="metric-detail-value" style={{ color: stats.risk_status === 'healthy' ? '#34d399' : '#f87171' }}>
                        {stats.risk_status === 'healthy' ? 'Sufficient' : 'Critical'}
                      </span>
                    </div>
                  </div>

                </div>

                {/* Dashboard Split Charts + Recent items */}
                <div className="dashboard-split-grid">
                  
                  {/* Left Side: Category Spend Pie Chart */}
                  <div className="glass-card chart-card">
                    <div className="grid-section-header" style={{ width: '100%' }}>
                      <h3>Expense distribution by Category</h3>
                    </div>

                    {stats.category_spend && stats.category_spend.length > 0 ? (
                      <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '2rem' }}>
                        <div style={{ width: '200px', height: '200px', flexShrink: 0, overflow: 'hidden', outline: 'none' }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={stats.category_spend}
                                dataKey="value"
                                nameKey="name"
                                cx="50%"
                                cy="50%"
                                innerRadius={60}
                                outerRadius={80}
                                paddingAngle={4}
                              >
                                {stats.category_spend.map((entry, index) => (
                                  <Cell 
                                    key={`cell-${index}`} 
                                    fill={CATEGORY_COLORS[entry.name] || DEFAULT_COLOR} 
                                  />
                                ))}
                              </Pie>
                              <Tooltip 
                                formatter={(value) => `Rs.${value.toLocaleString()}`}
                                contentStyle={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', color: '#fff' }}
                              />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>

                        {/* Legend list details */}
                        <div className="custom-legend">
                          {stats.category_spend.map((entry, idx) => (
                            <div key={idx} className="legend-item">
                              <div className="legend-label-group">
                                <span className="legend-color-dot" style={{ backgroundColor: CATEGORY_COLORS[entry.name] || DEFAULT_COLOR }}></span>
                                <span className="legend-label-name">{entry.name}</span>
                              </div>
                              <span className="legend-value">Rs.{entry.value.toLocaleString()}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="empty-state" style={{ height: '200px' }}>
                        <AlertCircle size={24} />
                        <div className="empty-state-title">No category data</div>
                        <div className="empty-state-subtitle">Sync database or upload a receipt to generate statistics.</div>
                      </div>
                    )}
                  </div>

                  {/* Right Side: Recent Activity log list */}
                  <div className="glass-card">
                    <div className="grid-section-header">
                      <h3>Recent Invoices</h3>
                      <button className="view-all-btn" onClick={() => setActiveTab('invoices')}>
                        <span>All</span>
                        <ArrowRight size={14} />
                      </button>
                    </div>

                    <div className="table-wrapper">
                      {invoices.length > 0 ? (
                        <table className="custom-table" style={{ fontSize: '0.8rem' }}>
                          <thead>
                            <tr>
                              <th>Date</th>
                              <th>Vendor</th>
                              <th style={{ textAlign: 'right' }}>Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {invoices.slice(0, 3).map((inv) => (
                              <tr key={inv.id}>
                                <td>{inv.date}</td>
                                <td style={{ fontWeight: 600 }}>{inv.vendor}</td>
                                <td style={{ textAlign: 'right', fontWeight: 600, color: '#f1f5f9' }}>
                                  Rs.{inv.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <div className="empty-state" style={{ height: '140px', padding: '1rem' }}>
                          <Clock size={20} />
                          <div className="empty-state-title">No transactions</div>
                          <div className="empty-state-subtitle">Your ledger entries will appear here.</div>
                        </div>
                      )}
                    </div>
                  </div>

                </div>
              </>
            )}

            {/* 2. INVOICE LEDGER VIEW */}
            {activeTab === 'invoices' && (
              <div className="glass-card">
                {/* Filter Header controls */}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: '1rem' }}>
                    {/* Category quick selectors */}
                    {['All', 'Education', 'Shopping', 'Utilities', 'Software', 'Financial'].map((cat) => (
                      <button
                        key={cat}
                        className={`badge ${selectedCategory === cat ? 'category' : ''}`}
                        onClick={() => setSelectedCategory(cat)}
                        style={{
                          cursor: 'pointer',
                          background: selectedCategory === cat ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255,255,255,0.02)',
                          border: selectedCategory === cat ? '1px solid rgba(99, 102, 241, 0.3)' : '1px solid rgba(255,255,255,0.04)',
                          color: selectedCategory === cat ? '#818cf8' : '#94a3b8',
                          padding: '0.4rem 0.8rem'
                        }}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                  <div style={{ color: '#64748b', fontSize: '0.85rem' }}>
                    Showing <strong>{invoices.length}</strong> entries
                  </div>
                </div>

                {/* Ledger Data Table */}
                <div className="table-wrapper">
                  {invoices.length > 0 ? (
                    <table className="custom-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Vendor</th>
                          <th>Category</th>
                          <th style={{ textAlign: 'right' }}>Amount</th>
                          <th style={{ textAlign: 'right' }}>Running Balance</th>
                          <th style={{ textAlign: 'center' }}>Outcome</th>
                        </tr>
                      </thead>
                      <tbody>
                        {invoices.map((inv) => (
                          <tr key={inv.id}>
                            <td>{inv.date}</td>
                            <td style={{ fontWeight: 700, color: '#ffffff' }}>{inv.vendor}</td>
                            <td>
                              <span className={`badge ${inv.category === 'Shopping' ? 'category-shopping' : 'category'}`}>
                                {inv.category}
                              </span>
                            </td>
                            <td style={{ textAlign: 'right', fontWeight: 600 }}>
                              Rs.{inv.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </td>
                            <td style={{ textAlign: 'right', color: inv.cash_balance_at_time < 10000 ? '#f87171' : '#94a3b8' }}>
                              Rs.{inv.cash_balance_at_time.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <span className={`badge status-${inv.outcome_label}`}>
                                {inv.outcome_label}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="empty-state">
                      <AlertCircle size={32} />
                      <div className="empty-state-title">No invoices found</div>
                      <div className="empty-state-subtitle">No entries match your search criteria or category filters.</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 3. UPLOAD PORTAL VIEW */}
            {activeTab === 'upload' && (
              <div className="glass-card" style={{ maxWidth: '780px', margin: '0 auto', width: '100%' }}>
                
                {/* Inactive Dropzone */}
                {uploadState.status === 'idle' && (
                  <div 
                    className="dropzone-container"
                    onDragEnter={handleDrag}
                    onDragOver={handleDrag}
                    onDragLeave={handleDrag}
                    onDrop={handleDrop}
                    style={{ borderStyle: dragActive ? 'solid' : 'dashed', borderColor: dragActive ? '#818cf8' : 'rgba(255,255,255,0.12)' }}
                  >
                    <input 
                      type="file" 
                      id="file-upload-input" 
                      style={{ display: 'none' }} 
                      onChange={handleFileChange}
                      accept="image/*,application/pdf"
                    />
                    <label htmlFor="file-upload-input" style={{ cursor: 'pointer' }}>
                      <Upload size={36} className="dropzone-icon" />
                      <div className="dropzone-title">Drag & Drop your invoice here</div>
                      <div className="dropzone-subtitle">Supports PDF files, PNG, or JPEG screenshots (Max 5MB)</div>
                      <button className="btn-primary" style={{ marginTop: '1.5rem', pointerEvents: 'none' }}>
                        Browse File
                      </button>
                    </label>
                  </div>
                )}

                {/* Progress bar state */}
                {uploadState.status === 'uploading' && (
                  <div className="uploading-animation-card">
                    <div className="progress-header">
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <RefreshCw size={14} className="loading-spinner" />
                        Processing document with Tesseract OCR...
                      </span>
                      <span>{uploadState.progress}%</span>
                    </div>
                    <div className="progress-track">
                      <div className="progress-bar" style={{ width: `${uploadState.progress}%` }}></div>
                    </div>
                    <span style={{ fontSize: '0.8rem', color: '#64748b', textAlign: 'left' }}>
                      Converting pages, executing OpenCV preprocessing, and extracting financial fields...
                    </span>
                  </div>
                )}

                {/* Processing Success state */}
                {uploadState.status === 'success' && uploadState.data && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: 'rgba(52, 211, 153, 0.08)', padding: '1rem 1.5rem', borderRadius: '12px', border: '1px solid rgba(52, 211, 153, 0.2)' }}>
                      <CheckCircle size={24} color="#34d399" />
                      <div style={{ textAlign: 'left' }}>
                        <h4 style={{ margin: 0, fontWeight: 700, color: 'white' }}>Extraction Succeeded!</h4>
                        <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.8rem', color: '#94a3b8' }}>
                          Invoice processed and ledger balance synced successfully.
                        </p>
                      </div>
                    </div>

                    {/* OCR Text preview pane */}
                    <div style={{ textAlign: 'left' }}>
                      <h4 style={{ fontSize: '0.85rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                        Extracted Raw Text Snippet (OCR Log)
                      </h4>
                      <div className="ocr-preview-pane">
                        {uploadState.data.raw_text_preview}
                      </div>
                    </div>

                    {/* Extracted Form validation preview */}
                    <div>
                      <h4 style={{ fontSize: '0.85rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem', textAlign: 'left' }}>
                        Parsed Ledger Fields
                      </h4>
                      <div className="fields-confirm-grid">
                        <div className="field-group">
                          <label>Vendor</label>
                          <input type="text" value={uploadState.data.vendor} readOnly />
                        </div>
                        <div className="field-group">
                          <label>Amount (Rs.)</label>
                          <input type="text" value={`Rs.${uploadState.data.amount.toFixed(2)}`} readOnly />
                        </div>
                        <div className="field-group">
                          <label>Date</label>
                          <input type="text" value={uploadState.data.date} readOnly />
                        </div>
                        <div className="field-group">
                          <label>Category</label>
                          <input type="text" value={uploadState.data.category} readOnly />
                        </div>
                        <div className="field-group" style={{ gridColumn: 'span 2', marginTop: '0.5rem' }}>
                          <label>Ledger running Balance</label>
                          <input 
                            type="text" 
                            value={`Rs.${uploadState.data.cash_balance_at_time.toLocaleString(undefined, { minimumFractionDigits: 2 })} (${uploadState.data.outcome_label})`} 
                            readOnly 
                            style={{ 
                              color: uploadState.data.outcome_label === 'healthy' ? '#34d399' : '#f87171',
                              fontWeight: 600,
                              background: 'rgba(15,23,42,0.6)'
                            }} 
                          />
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1rem' }}>
                      <button 
                        className="btn-primary" 
                        onClick={() => setUploadState({ status: 'idle', progress: 0, data: null, error: null })}
                        style={{ background: 'rgba(255,255,255,0.04)', color: 'white', border: '1px solid rgba(255,255,255,0.08)' }}
                      >
                        Upload Another
                      </button>
                      <button className="btn-primary" onClick={() => setActiveTab('dashboard')}>
                        View on Dashboard
                      </button>
                    </div>
                  </div>
                )}

                {/* Error State */}
                {uploadState.status === 'error' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', alignItems: 'center', padding: '2rem 1rem' }}>
                    <AlertCircle size={40} color="#ef4444" />
                    <div style={{ textAlign: 'center' }}>
                      <h4 style={{ margin: 0, fontWeight: 700, color: 'white' }}>Processing Failed</h4>
                      <p style={{ color: '#ef4444', fontSize: '0.85rem', margin: '0.5rem 0' }}>
                        {uploadState.error}
                      </p>
                    </div>
                    <button 
                      className="btn-primary" 
                      onClick={() => setUploadState({ status: 'idle', progress: 0, data: null, error: null })}
                    >
                      Try Again
                    </button>
                  </div>
                )}

              </div>
            )}

            {/* 4. FORECASTING VIEW */}
            {activeTab === 'forecast' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                {forecastLoading && (
                  <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '4rem 2rem', textAlign: 'center' }}>
                    <RefreshCw size={36} className="loading-spinner" style={{ marginBottom: '1rem', color: '#818cf8' }} />
                    <h3 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Training Forecasting Engine...</h3>
                    <p style={{ color: '#64748b', fontSize: '0.85rem', maxWidth: '350px', marginTop: '0.25rem' }}>
                      Fitting Prophet models and ARIMA baselines to 12 months of daily transaction records. This takes a few seconds.
                    </p>
                  </div>
                )}

                {forecastError && (
                  <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '3rem', textAlign: 'center' }}>
                    <AlertCircle size={44} color="#ef4444" style={{ marginBottom: '1rem' }} />
                    <h3 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Forecasting Failed</h3>
                    <p style={{ color: '#64748b', fontSize: '0.85rem', maxWidth: '350px', margin: '0.25rem 0 1.5rem 0' }}>
                      {forecastError}
                    </p>
                    <button className="btn-primary" onClick={fetchForecast}>
                      Retry Training
                    </button>
                  </div>
                )}

                {forecastData && !forecastLoading && (
                  <>
                    {/* Alert Banner if risk detected */}
                    {forecastData.alert?.has_risk ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.25)', padding: '1rem 1.5rem', borderRadius: '16px' }}>
                        <ShieldAlert size={24} color="#ef4444" />
                        <div style={{ textAlign: 'left' }}>
                          <h4 style={{ margin: 0, fontWeight: 700, color: 'white' }}>Liquidity Alert: Projected Cash Deficit</h4>
                          <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: '#f87171' }}>
                            Your cash balance is predicted to fall below the safety threshold of Rs.10,000.00 on <strong>{forecastData.alert.first_risk_date}</strong>. 
                            There are <strong>{forecastData.alert.risk_days_count}</strong> critical risk days projected in the next 30 days.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.2)', padding: '1rem 1.5rem', borderRadius: '16px' }}>
                        <CheckCircle size={24} color="#34d399" />
                        <div style={{ textAlign: 'left' }}>
                          <h4 style={{ margin: 0, fontWeight: 700, color: 'white' }}>Cash Flow Forecast Stable</h4>
                          <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: '#a7f3d0' }}>
                            Your cash balance is predicted to remain comfortably above the safety threshold (Rs.10,000.00) for the next 30 days.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* KPIs cards row */}
                    <div className="metrics-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                      <div className="glass-card metric-mini-card">
                        <div className="metric-icon-box indigo">
                          <TrendingUp size={20} />
                        </div>
                        <div className="metric-details">
                          <span className="metric-detail-label">Prophet Ending Cash</span>
                          <span className="metric-detail-value">
                            Rs.{forecastData.prophet[forecastData.prophet.length - 1].balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </span>
                        </div>
                      </div>

                      <div className="glass-card metric-mini-card">
                        <div className="metric-icon-box blue">
                          <DollarSign size={20} />
                        </div>
                        <div className="metric-details">
                          <span className="metric-detail-label">ARIMA Ending Cash</span>
                          <span className="metric-detail-value">
                            Rs.{forecastData.arima[forecastData.arima.length - 1].balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </span>
                        </div>
                      </div>

                      <div className="glass-card metric-mini-card">
                        <div className="metric-icon-box green">
                          <CheckCircle size={20} />
                        </div>
                        <div className="metric-details">
                          <span className="metric-detail-label">Prophet Accuracy (MAPE)</span>
                          <span className="metric-detail-value">{forecastData.metrics.prophet_mape}%</span>
                        </div>
                      </div>

                      <div className="glass-card metric-mini-card">
                        <div className="metric-icon-box blue">
                          <Clock size={20} />
                        </div>
                        <div className="metric-details">
                          <span className="metric-detail-label">ARIMA Accuracy (MAPE)</span>
                          <span className="metric-detail-value">{forecastData.metrics.arima_mape}%</span>
                        </div>
                      </div>
                    </div>

                    {/* Chart panel */}
                    <div className="glass-card" style={{ padding: '1.75rem' }}>
                      <div className="grid-section-header">
                        <h3>Prophet vs. ARIMA Forecast (30 Days Outlook)</h3>
                      </div>
                      
                      <div style={{ width: '100%', height: '350px', marginTop: '1.5rem' }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart 
                            data={getCombinedChartData()}
                            margin={{ top: 10, right: 30, left: 20, bottom: 10 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                            <XAxis 
                              dataKey="date" 
                              stroke="#64748b" 
                              fontSize={11}
                              tickLine={false}
                              axisLine={false}
                            />
                            <YAxis 
                              stroke="#64748b"
                              fontSize={11}
                              tickLine={false}
                              axisLine={false}
                              tickFormatter={(value) => `Rs.${(value/1000).toFixed(0)}k`}
                            />
                            <Tooltip 
                              formatter={(value, name) => [
                                `Rs.${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
                                name === 'actual' ? 'Historical Actual' : name === 'prophet' ? 'Prophet Forecast' : 'ARIMA Baseline'
                              ]}
                              contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', color: '#fff' }}
                            />
                            <Legend />
                            <Line 
                              type="monotone" 
                              dataKey="actual" 
                              name="Historical Actual" 
                              stroke="#3b82f6" 
                              strokeWidth={3}
                              dot={false}
                            />
                            <Line 
                              type="monotone" 
                              dataKey="prophet" 
                              name="Prophet Forecast" 
                              stroke="#818cf8" 
                              strokeWidth={2}
                              strokeDasharray="4 4"
                              dot={false}
                            />
                            <Line 
                              type="monotone" 
                              dataKey="arima" 
                              name="ARIMA Baseline" 
                              stroke="#c084fc" 
                              strokeWidth={2}
                              strokeDasharray="6 6"
                              dot={false}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default App;
