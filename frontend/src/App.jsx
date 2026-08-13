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
  ShieldAlert,
  Tag
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

const CustomTooltip = ({ active, payload }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const isForecast = data.actual === null;
    
    return (
      <div className="glass-card custom-tooltip" style={{ padding: '0.75rem 1rem', border: '1px solid rgba(255,255,255,0.08)', background: '#090d16', color: '#fff', fontSize: '0.8rem', minWidth: '180px', textAlign: 'left', borderRadius: '12px' }}>
        <div style={{ fontWeight: 600, color: '#94a3b8', marginBottom: '0.4rem' }}>{data.date}</div>
        
        {!isForecast ? (
          <>
            <div style={{ color: '#3b82f6', fontWeight: 700, margin: '0.25rem 0' }}>
              Balance: Rs.{data.actual.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', margin: '0.4rem 0' }}></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', color: '#34d399', fontSize: '0.75rem', marginBottom: '0.15rem' }}>
              <span>Received:</span>
              <span>+Rs.{data.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', color: '#f87171', fontSize: '0.75rem', marginBottom: '0.3rem' }}>
              <span>Spent:</span>
              <span>-Rs.{(data.expense + data.recurring + data.actual_invoice).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
            <div style={{ color: '#818cf8', fontSize: '0.7rem', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '0.3rem', fontStyle: 'italic' }}>
              {data.description}
            </div>
          </>
        ) : (
          <>
            {data.prophet && (
              <div style={{ color: '#818cf8', fontWeight: 600, fontSize: '0.75rem' }}>
                Prophet: Rs.{data.prophet.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
            )}
            {data.arima && (
              <div style={{ color: '#c084fc', fontWeight: 600, marginTop: '0.15rem', fontSize: '0.75rem' }}>
                ARIMA: Rs.{data.arima.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
            )}
            <div style={{ color: '#64748b', fontSize: '0.7rem', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '0.3rem', marginTop: '0.3rem' }}>
              Future Projection
            </div>
          </>
        )}
      </div>
    );
  }
  return null;
};

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
  const [uploadMode, setUploadMode] = useState('ocr'); // 'ocr' | 'manual'
  const [manualForm, setManualForm] = useState({
    vendor: '',
    amount: '',
    date: new Date().toISOString().split('T')[0],
    category: 'Miscellaneous',
    user_notes: ''
  });
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [successNotes, setSuccessNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);

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
        ...h,
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
        ...lastHistory,
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

  const downloadAuditCSV = () => {
    if (!forecastData) return;
    const headers = "Date,Description,Inflow (Rs.),Outflow (Rs.),Closing Balance (Rs.)\n";
    const rows = forecastData.historical.map(h => {
      const outflow = h.expense + h.recurring + h.actual_invoice;
      return `"${h.date}","${h.description}",${h.revenue},${outflow},${h.balance}`;
    }).join("\n");
    
    const blob = new Blob([headers + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `FinSense_Cash_Flow_Audit_Report_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadInvoicesCSV = () => {
    if (!invoices.length) return;
    const headers = "Date,Vendor,Category,Amount (Rs.),Running Balance (Rs.),System Outcome,User Outcome,Notes\n";
    const rows = invoices.map(inv => {
      return `"${inv.date}","${inv.vendor}","${inv.category}",${inv.amount},${inv.cash_balance_at_time},"${inv.outcome_label}","${inv.user_outcome || ''}","${inv.user_notes || ''}"`;
    }).join("\n");
    
    const blob = new Blob([headers + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `FinSense_Invoices_Ledger_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const saveOutcomeLabel = async (invoiceId, newOutcome) => {
    try {
      const res = await fetch(`${API_BASE}/invoices/${invoiceId}/outcome`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_outcome: newOutcome })
      });
      if (!res.ok) throw new Error('Failed to save outcome label');
      // Optimistically update the local state
      setInvoices(prev => prev.map(inv => 
        inv.id === invoiceId ? { ...inv, user_outcome: newOutcome } : inv
      ));
    } catch (err) {
      console.error('Failed to save outcome:', err);
      alert('Could not save outcome label. Please try again.');
    }
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

  const handleManualSubmit = async (e) => {
    e.preventDefault();
    if (!manualForm.vendor || !manualForm.amount || !manualForm.date) {
      alert('Please fill out all fields.');
      return;
    }
    
    setManualSubmitting(true);
    setUploadState({ status: 'uploading', progress: 20, data: null, error: null });
    
    const interval = setInterval(() => {
      setUploadState(prev => {
        if (prev.progress >= 90) {
          clearInterval(interval);
          return prev;
        }
        return { ...prev, progress: prev.progress + 20 };
      });
    }, 150);
    
    try {
      const res = await fetch(`${API_BASE}/invoices/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendor: manualForm.vendor,
          amount: parseFloat(manualForm.amount),
          date: manualForm.date,
          category: manualForm.category,
          user_notes: manualForm.user_notes
        })
      });
      
      clearInterval(interval);
      
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to submit manual cash expense');
      }
      
      const data = await res.json();
      
      // Update stats and fetch invoices to sync dashboard
      await fetchData(searchQuery, selectedCategory);
      
      setUploadState({
        status: 'success',
        progress: 100,
        data: {
          ...data,
          raw_text_preview: `[MANUAL ENTRY LOG]\nSuccessfully recorded cash payout.\nVendor: ${data.vendor}\nAmount: Rs.${data.amount.toFixed(2)}\nDate: ${data.date}\nCategory: ${data.category}\nReasoning: ${data.user_notes || 'None'}\nLedger balance updated.`
        },
        error: null
      });
      
      // Reset form
      setManualForm({
        vendor: '',
        amount: '',
        date: new Date().toISOString().split('T')[0],
        category: 'Miscellaneous',
        user_notes: ''
      });
      
    } catch (err) {
      console.error(err);
      clearInterval(interval);
      setUploadState({
        status: 'error',
        progress: 0,
        data: null,
        error: err.message || 'Error connecting to manual transaction endpoint'
      });
    } finally {
      setManualSubmitting(false);
    }
  };

  const handleSaveSuccessNotes = async () => {
    if (!uploadState.data?.id) return;
    setSavingNotes(true);
    try {
      const res = await fetch(`${API_BASE}/invoices/${uploadState.data.id}/notes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_notes: successNotes })
      });
      if (!res.ok) throw new Error('Failed to update invoice notes');
      
      setUploadState(prev => ({
        ...prev,
        data: {
          ...prev.data,
          user_notes: successNotes,
          raw_text_preview: prev.data.raw_text_preview + `\n[Notes Added]: ${successNotes}`
        }
      }));
      
      await fetchData(searchQuery, selectedCategory);
      alert('Spend experience notes saved successfully!');
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to save notes');
    } finally {
      setSavingNotes(false);
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
                    {['All', 'Education', 'Shopping', 'Utilities', 'Software', 'Financial', 'Miscellaneous'].map((cat) => (
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ color: '#64748b', fontSize: '0.85rem' }}>
                      Showing <strong>{invoices.length}</strong> entries
                    </div>
                    <button
                      className="btn-primary"
                      onClick={downloadInvoicesCSV}
                      style={{ padding: '0.4rem 1rem', fontSize: '0.8rem', background: 'rgba(255,255,255,0.04)', color: 'white', border: '1px solid rgba(255,255,255,0.08)' }}
                    >
                      Export Ledger (.CSV)
                    </button>
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
                          <th style={{ textAlign: 'left' }}>Reasoning (Spend Experience)</th>
                          <th style={{ textAlign: 'right' }}>Amount</th>
                          <th style={{ textAlign: 'right' }}>Running Balance</th>
                          <th style={{ textAlign: 'center' }}>Health</th>
                          <th style={{ textAlign: 'center' }}>Outcome Label</th>
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
                            <td style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: '0.85rem', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }} title={inv.user_notes}>
                              {inv.user_notes || '—'}
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
                            <td style={{ textAlign: 'center' }}>
                              <select
                                id={`outcome-select-${inv.id}`}
                                value={inv.user_outcome || ''}
                                onChange={(e) => saveOutcomeLabel(inv.id, e.target.value)}
                                style={{
                                  background: inv.user_outcome ? 'rgba(99, 102, 241, 0.12)' : 'rgba(255,255,255,0.04)',
                                  color: inv.user_outcome ? {
                                    'Productive': '#34d399',
                                    'Necessary': '#60a5fa',
                                    'Wasteful': '#f87171',
                                    'Pending Review': '#fbbf24',
                                    'Break-even': '#94a3b8'
                                  }[inv.user_outcome] || '#c084fc' : '#64748b',
                                  border: '1px solid rgba(255,255,255,0.08)',
                                  borderRadius: '8px',
                                  padding: '0.3rem 0.5rem',
                                  fontSize: '0.78rem',
                                  fontWeight: inv.user_outcome ? 600 : 400,
                                  cursor: 'pointer',
                                  minWidth: '120px',
                                  outline: 'none',
                                  appearance: 'none',
                                  WebkitAppearance: 'none',
                                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
                                  backgroundRepeat: 'no-repeat',
                                  backgroundPosition: 'right 0.4rem center',
                                  paddingRight: '1.5rem'
                                }}
                              >
                                <option value="" style={{ background: '#0f1629', color: '#64748b' }}>— Set Outcome —</option>
                                <option value="Productive" style={{ background: '#0f1629', color: '#34d399' }}>✅ Productive</option>
                                <option value="Necessary" style={{ background: '#0f1629', color: '#60a5fa' }}>📋 Necessary</option>
                                <option value="Wasteful" style={{ background: '#0f1629', color: '#f87171' }}>❌ Wasteful</option>
                                <option value="Pending Review" style={{ background: '#0f1629', color: '#fbbf24' }}>⏳ Pending Review</option>
                                <option value="Break-even" style={{ background: '#0f1629', color: '#94a3b8' }}>⚖️ Break-even</option>
                              </select>
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
                
                {/* Inactive Ingestion View */}
                {uploadState.status === 'idle' && (
                  <>
                    {/* Mode Toggles */}
                    <div style={{ display: 'flex', gap: '1rem', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '1rem', marginBottom: '1.5rem' }}>
                      <button 
                        className={`btn-primary ${uploadMode === 'ocr' ? 'active' : ''}`}
                        style={{ 
                          background: uploadMode === 'ocr' ? '#818cf8' : 'rgba(255,255,255,0.02)',
                          color: 'white',
                          border: uploadMode === 'ocr' ? 'none' : '1px solid rgba(255,255,255,0.08)',
                          boxShadow: uploadMode === 'ocr' ? '0 0 12px rgba(129, 140, 248, 0.3)' : 'none',
                          padding: '0.5rem 1.25rem'
                        }}
                        onClick={() => setUploadMode('ocr')}
                      >
                        Scan Receipt (OCR)
                      </button>
                      <button 
                        className={`btn-primary ${uploadMode === 'manual' ? 'active' : ''}`}
                        style={{ 
                          background: uploadMode === 'manual' ? '#818cf8' : 'rgba(255,255,255,0.02)',
                          color: 'white',
                          border: uploadMode === 'manual' ? 'none' : '1px solid rgba(255,255,255,0.08)',
                          boxShadow: uploadMode === 'manual' ? '0 0 12px rgba(129, 140, 248, 0.3)' : 'none',
                          padding: '0.5rem 1.25rem'
                        }}
                        onClick={() => setUploadMode('manual')}
                      >
                        Record Hard Cash Expense
                      </button>
                    </div>

                    {uploadMode === 'ocr' ? (
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
                    ) : (
                      <form onSubmit={handleManualSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', textAlign: 'left' }}>
                        <div className="fields-confirm-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
                          <div className="field-group">
                            <label style={{ color: '#94a3b8', fontSize: '0.85rem', fontWeight: 600, display: 'block', marginBottom: '0.5rem' }}>Vendor / Description</label>
                            <input 
                              type="text" 
                              placeholder="e.g. Tea & snacks, Office supplies"
                              value={manualForm.vendor}
                              onChange={(e) => setManualForm({ ...manualForm, vendor: e.target.value })}
                              required 
                              style={{ background: 'rgba(15,23,42,0.5)', border: '1px solid rgba(255,255,255,0.08)', color: 'white', padding: '0.65rem 0.85rem', borderRadius: '8px', fontSize: '0.9rem', width: '100%', outline: 'none' }}
                            />
                          </div>
                          <div className="field-group">
                            <label style={{ color: '#94a3b8', fontSize: '0.85rem', fontWeight: 600, display: 'block', marginBottom: '0.5rem' }}>Amount (Rs.)</label>
                            <input 
                              type="number" 
                              step="0.01"
                              placeholder="0.00"
                              value={manualForm.amount}
                              onChange={(e) => setManualForm({ ...manualForm, amount: e.target.value })}
                              required 
                              style={{ background: 'rgba(15,23,42,0.5)', border: '1px solid rgba(255,255,255,0.08)', color: 'white', padding: '0.65rem 0.85rem', borderRadius: '8px', fontSize: '0.9rem', width: '100%', outline: 'none' }}
                            />
                          </div>
                          <div className="field-group">
                            <label style={{ color: '#94a3b8', fontSize: '0.85rem', fontWeight: 600, display: 'block', marginBottom: '0.5rem' }}>Date</label>
                            <input 
                              type="date" 
                              value={manualForm.date}
                              onChange={(e) => setManualForm({ ...manualForm, date: e.target.value })}
                              required 
                              style={{ background: 'rgba(15,23,42,0.5)', border: '1px solid rgba(255,255,255,0.08)', color: 'white', padding: '0.65rem 0.85rem', borderRadius: '8px', fontSize: '0.9rem', width: '100%', outline: 'none' }}
                            />
                          </div>
                          <div className="field-group">
                            <label style={{ color: '#94a3b8', fontSize: '0.85rem', fontWeight: 600, display: 'block', marginBottom: '0.5rem' }}>Category</label>
                            <select 
                              value={manualForm.category}
                              onChange={(e) => setManualForm({ ...manualForm, category: e.target.value })}
                              style={{ background: 'rgba(15,23,42,0.5)', border: '1px solid rgba(255,255,255,0.08)', color: 'white', padding: '0.65rem 0.85rem', borderRadius: '8px', fontSize: '0.9rem', width: '100%', outline: 'none', height: '42px' }}
                            >
                              <option value="Miscellaneous">Miscellaneous</option>
                              <option value="Utilities">Utilities</option>
                              <option value="Software">Software</option>
                              <option value="Marketing">Marketing</option>
                              <option value="Shopping">Shopping</option>
                              <option value="Education">Education</option>
                              <option value="Financial">Financial</option>
                            </select>
                          </div>
                          <div className="field-group" style={{ gridColumn: 'span 2' }}>
                            <label style={{ color: '#94a3b8', fontSize: '0.85rem', fontWeight: 600, display: 'block', marginBottom: '0.5rem' }}>Reasoning / Notes (Spend Experience)</label>
                            <textarea 
                              placeholder="Explain why you spent this cash in your own words (e.g. AWS renewal, team refreshments...)"
                              value={manualForm.user_notes || ''}
                              onChange={(e) => setManualForm({ ...manualForm, user_notes: e.target.value })}
                              style={{ background: 'rgba(15,23,42,0.5)', border: '1px solid rgba(255,255,255,0.08)', color: 'white', padding: '0.65rem 0.85rem', borderRadius: '8px', fontSize: '0.9rem', width: '100%', outline: 'none', minHeight: '80px', resize: 'vertical' }}
                            />
                          </div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                          <button 
                            type="submit" 
                            className="btn-primary" 
                            disabled={manualSubmitting}
                            style={{ padding: '0.65rem 1.75rem' }}
                          >
                            {manualSubmitting ? 'Recording Expense...' : 'Record Cash Expense'}
                          </button>
                        </div>
                      </form>
                    )}
                  </>
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
                        <div className="field-group" style={{ gridColumn: 'span 2', marginTop: '0.5rem', textAlign: 'left' }}>
                          <label style={{ color: '#94a3b8', fontSize: '0.85rem', fontWeight: 600, display: 'block', marginBottom: '0.5rem' }}>Reasoning / Notes (Spend Experience)</label>
                          <textarea 
                            placeholder="Explain why this invoice was paid in your own words (e.g. software renewal, office utilities...)"
                            value={successNotes}
                            onChange={(e) => setSuccessNotes(e.target.value)}
                            style={{ background: 'rgba(15,23,42,0.6)', border: '1px solid rgba(255,255,255,0.08)', color: 'white', padding: '0.65rem 0.85rem', borderRadius: '8px', fontSize: '0.9rem', width: '100%', outline: 'none', minHeight: '60px', resize: 'vertical' }}
                          />
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1rem' }}>
                      <button 
                        className="btn-primary" 
                        onClick={handleSaveSuccessNotes}
                        disabled={savingNotes}
                        style={{ background: '#34d399', color: '#090d16', border: 'none', fontWeight: 600 }}
                      >
                        {savingNotes ? 'Saving Notes...' : 'Save Notes'}
                      </button>
                      <button 
                        className="btn-primary" 
                        onClick={() => {
                          setSuccessNotes('');
                          setUploadState({ status: 'idle', progress: 0, data: null, error: null });
                        }}
                        style={{ background: 'rgba(255,255,255,0.04)', color: 'white', border: '1px solid rgba(255,255,255,0.08)' }}
                      >
                        Upload Another
                      </button>
                      <button className="btn-primary" onClick={() => {
                        setSuccessNotes('');
                        setActiveTab('dashboard');
                      }}>
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
                          <span className="metric-detail-label">Prophet Model Accuracy</span>
                          <span className="metric-detail-value">{(100 - forecastData.metrics.prophet_mape).toFixed(2)}%</span>
                        </div>
                      </div>

                      <div className="glass-card metric-mini-card">
                        <div className="metric-icon-box blue">
                          <Clock size={20} />
                        </div>
                        <div className="metric-details">
                          <span className="metric-detail-label">ARIMA Model Accuracy</span>
                          <span className="metric-detail-value">{(100 - forecastData.metrics.arima_mape).toFixed(2)}%</span>
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
                            <Tooltip content={<CustomTooltip />} />
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

                    {/* Audit Ledger Table */}
                    <div className="glass-card" style={{ padding: '1.75rem', marginTop: '0.5rem' }}>
                      <div className="grid-section-header" style={{ marginBottom: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <h3 style={{ margin: 0, textAlign: 'left' }}>Daily Transaction Evidence Journal</h3>
                          <p style={{ color: '#64748b', fontSize: '0.8rem', margin: '0.25rem 0 0 0', textAlign: 'left' }}>
                            Audit trail showing simulated retail revenues alongside your actual uploaded invoice expenses.
                          </p>
                        </div>
                        <button
                          className="btn-primary"
                          onClick={downloadAuditCSV}
                          style={{ padding: '0.45rem 1.15rem', fontSize: '0.78rem', background: 'rgba(255,255,255,0.04)', color: 'white', border: '1px solid rgba(255,255,255,0.08)' }}
                        >
                          Export Audit Trail (.CSV)
                        </button>
                      </div>

                      <div className="ledger-table-container">
                        <table className="ledger-table">
                          <thead>
                            <tr>
                              <th style={{ textAlign: 'left' }}>Date</th>
                              <th style={{ textAlign: 'left' }}>Daily Events / Vendors</th>
                              <th style={{ textAlign: 'right' }}>Cash Inflow</th>
                              <th style={{ textAlign: 'right' }}>Cash Outflow</th>
                              <th style={{ textAlign: 'right' }}>Closing Balance</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...forecastData.historical]
                              .reverse()
                              .slice(0, 15)
                              .map((h, index) => {
                                const outflow = h.expense + h.recurring + h.actual_invoice;
                                return (
                                  <tr key={index}>
                                    <td style={{ fontWeight: 600, textAlign: 'left' }}>{h.date}</td>
                                    <td style={{ textAlign: 'left' }}>
                                      <span style={{ 
                                        color: h.actual_invoice > 0 ? '#818cf8' : h.recurring > 0 ? '#f472b6' : 'white',
                                        fontWeight: h.actual_invoice > 0 ? 600 : 'normal'
                                      }}>
                                        {h.description}
                                      </span>
                                    </td>
                                    <td style={{ color: '#34d399', fontWeight: 600, textAlign: 'right' }}>
                                      +Rs.{h.revenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                    </td>
                                    <td style={{ color: outflow > 0 ? '#f87171' : '#64748b', textAlign: 'right' }}>
                                      {outflow > 0 ? `-Rs.${outflow.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : 'Rs.0.00'}
                                    </td>
                                    <td style={{ fontWeight: 700, textAlign: 'right' }}>
                                      Rs.{h.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                    </td>
                                  </tr>
                                );
                              })}
                          </tbody>
                        </table>
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
