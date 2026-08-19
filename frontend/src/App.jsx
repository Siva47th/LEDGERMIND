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
  Tag,
  Trash2,
  Sparkles,
  Bot,
  BrainCircuit,
  Lightbulb,
  Send,
  Database,
  Sliders,
  AlertTriangle,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Globe
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
  const [transactions, setTransactions] = useState([]);
  const [stats, setStats] = useState({
    current_balance: 100000.0,
    total_income: 0.0,
    total_expenses: 0.0,
    total_transactions: 0,
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
    vendor_or_client: '',
    amount: '',
    date: new Date().toISOString().split('T')[0],
    category: 'Miscellaneous',
    transaction_type: 'expense',
    user_notes: ''
  });
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [successNotes, setSuccessNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);

  // Advisor State
  const [advisorQuery, setAdvisorQuery] = useState('');
  const [advisorLoading, setAdvisorLoading] = useState(false);
  const [advisorResult, setAdvisorResult] = useState(null);
  const [advisorError, setAdvisorError] = useState(null);
  const [advisorLang, setAdvisorLang] = useState('en'); // 'en' | 'ta'
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const handleAdvisorSubmit = async (queryText) => {
    const q = queryText || advisorQuery;
    if (!q || !q.trim()) return;

    setAdvisorLoading(true);
    setAdvisorError(null);
    try {
      const res = await fetch(`${API_BASE}/advisor/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, language: advisorLang })
      });
      if (!res.ok) throw new Error('Advisor engine request failed');
      const data = await res.json();
      setAdvisorResult(data);
    } catch (err) {
      console.error(err);
      setAdvisorError(err.message || 'Failed to generate financial advice');
    } finally {
      setAdvisorLoading(false);
    }
  };

  const toggleSpeechRecognition = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Web Speech API is not supported in this browser. Please use Chrome, Edge, or Safari.');
      return;
    }

    if (isListening) {
      setIsListening(false);
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = advisorLang === 'ta' ? 'ta-IN' : 'en-US';

      recognition.onstart = () => setIsListening(true);
      recognition.onend = () => setIsListening(false);
      recognition.onerror = (e) => {
        console.error('Speech recognition error:', e);
        setIsListening(false);
      };

      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        if (transcript) {
          setAdvisorQuery(transcript);
          handleAdvisorSubmit(transcript);
        }
      };

      recognition.start();
    } catch (err) {
      console.error('Failed to start speech recognition:', err);
      setIsListening(false);
    }
  };

  const speakRecommendation = () => {
    if (!('speechSynthesis' in window)) {
      alert('Text-to-Speech is not supported in this browser.');
      return;
    }

    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }

    if (!advisorResult) return;

    const textToSpeak = `${advisorResult.verdict}. ${advisorResult.explanation} ${advisorResult.suggested_action || ''}`;
    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    utterance.lang = advisorLang === 'ta' ? 'ta-IN' : 'en-US';
    utterance.rate = 0.95;

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    window.speechSynthesis.speak(utterance);
  };

  // Case Memory Viewer State
  const [casesList, setCasesList] = useState([]);
  const [casesLoading, setCasesLoading] = useState(false);
  const [casesSearch, setCasesSearch] = useState('');

  // Anomalies State
  const [anomaliesMap, setAnomaliesMap] = useState({});

  // Settings State
  const [settingsForm, setSettingsForm] = useState({
    starting_balance: 250000,
    balance_alert_threshold: 10000,
    gemini_model: 'gemini-3.5-flash'
  });
  const [settingsSaving, setSettingsSaving] = useState(false);

  const fetchCases = async () => {
    setCasesLoading(true);
    try {
      const res = await fetch(`${API_BASE}/cases`);
      if (!res.ok) throw new Error('Failed to load case memories');
      const data = await res.json();
      setCasesList(data.cases || []);
    } catch (err) {
      console.error(err);
    } finally {
      setCasesLoading(false);
    }
  };

  const fetchAnomalies = async () => {
    try {
      const res = await fetch(`${API_BASE}/transactions/anomalies`);
      if (!res.ok) return;
      const data = await res.json();
      const map = {};
      (data.anomalies || []).forEach(a => {
        if (a.is_anomaly) {
          map[a.id] = a;
        }
      });
      setAnomaliesMap(map);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchSettings = async () => {
    try {
      const res = await fetch(`${API_BASE}/settings`);
      if (!res.ok) return;
      const data = await res.json();
      setSettingsForm({
        starting_balance: data.starting_balance || 250000,
        balance_alert_threshold: data.balance_alert_threshold || 10000,
        gemini_model: data.gemini_model || 'gemini-3.5-flash'
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleSettingsSave = async (e) => {
    e.preventDefault();
    setSettingsSaving(true);
    try {
      const res = await fetch(`${API_BASE}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settingsForm)
      });
      if (!res.ok) throw new Error('Failed to update system settings');
      await fetchData(searchQuery, selectedCategory);
      alert('System settings updated successfully!');
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to update settings');
    } finally {
      setSettingsSaving(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'cases') {
      fetchCases();
    } else if (activeTab === 'settings') {
      fetchSettings();
    }
  }, [activeTab]);

  const fetchData = async (search = '', cat = 'All') => {
    setLoading(true);
    try {
      // 1. Fetch Stats
      const statsRes = await fetch(`${API_BASE}/dashboard/stats`);
      if (!statsRes.ok) throw new Error('Failed to load stats');
      const statsData = await statsRes.json();
      setStats(statsData);

      // 2. Fetch Transactions list
      let url = `${API_BASE}/transactions`;
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      if (cat !== 'All') params.append('category', cat);
      if (params.toString()) url += `?${params.toString()}`;

      const txnRes = await fetch(url);
      if (!txnRes.ok) throw new Error('Failed to load transactions');
      const txnData = await txnRes.json();
      setTransactions(txnData);
      
      // 3. Fetch Anomalies
      fetchAnomalies();

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

  const downloadTransactionsCSV = () => {
    if (!transactions.length) return;
    const headers = "Date,Type,Vendor/Client,Category,Amount (Rs.),System Outcome,User Outcome,Notes\n";
    const rows = transactions.map(txn => {
      return `"${txn.date}","${txn.transaction_type}","${txn.vendor_or_client}","${txn.category}",${txn.amount},"${txn.outcome_label}","${txn.user_outcome || ''}","${txn.user_notes || ''}"`;
    }).join("\n");
    
    const blob = new Blob([headers + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `FinSense_Transactions_Ledger_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const saveOutcomeLabel = async (txnId, newOutcome) => {
    try {
      const res = await fetch(`${API_BASE}/transactions/${txnId}/outcome`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_outcome: newOutcome })
      });
      if (!res.ok) throw new Error('Failed to save outcome label');
      // Optimistically update the local state
      setTransactions(prev => prev.map(txn => 
        txn.id === txnId ? { ...txn, user_outcome: newOutcome } : txn
      ));
    } catch (err) {
      console.error('Failed to save outcome:', err);
      alert('Could not save outcome label. Please try again.');
    }
  };

  const updateTransactionType = async (txnId, newType) => {
    try {
      const res = await fetch(`${API_BASE}/transactions/${txnId}/type`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction_type: newType })
      });
      if (!res.ok) throw new Error('Failed to update transaction type');
      await fetchData(searchQuery, selectedCategory);
    } catch (err) {
      console.error(err);
      alert('Could not update transaction type.');
    }
  };

  const deleteTransaction = async (txnId) => {
    if (!window.confirm(`Are you sure you want to delete transaction #${txnId}?`)) return;
    try {
      const res = await fetch(`${API_BASE}/transactions/${txnId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete transaction');
      await fetchData(searchQuery, selectedCategory);
    } catch (err) {
      console.error(err);
      alert('Failed to delete transaction.');
    }
  };

  const deduplicateTransactions = async () => {
    try {
      const res = await fetch(`${API_BASE}/transactions/deduplicate`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to deduplicate');
      const data = await res.json();
      await fetchData(searchQuery, selectedCategory);
      alert(data.message || 'Duplicate check complete.');
    } catch (err) {
      console.error(err);
      alert('Failed to run deduplication.');
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
      const response = await fetch(`${API_BASE}/transactions/upload`, {
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
    if (!manualForm.vendor_or_client || !manualForm.amount || !manualForm.date) {
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
      const res = await fetch(`${API_BASE}/transactions/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendor_or_client: manualForm.vendor_or_client,
          amount: parseFloat(manualForm.amount),
          date: manualForm.date,
          category: manualForm.category,
          transaction_type: manualForm.transaction_type,
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
          raw_text_preview: `[MANUAL ENTRY LOG]\nSuccessfully recorded ${data.transaction_type} transaction.\nVendor/Client: ${data.vendor_or_client}\nType: ${data.transaction_type}\nAmount: Rs.${data.amount.toFixed(2)}\nDate: ${data.date}\nCategory: ${data.category}\nReasoning: ${data.user_notes || 'None'}\nLive balance: Rs.${data.current_balance?.toLocaleString() || '—'}`
        },
        error: null
      });
      
      // Reset form
      setManualForm({
        vendor_or_client: '',
        amount: '',
        date: new Date().toISOString().split('T')[0],
        category: 'Miscellaneous',
        transaction_type: 'expense',
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
      const res = await fetch(`${API_BASE}/transactions/${uploadState.data.id}/notes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_notes: successNotes })
      });
      if (!res.ok) throw new Error('Failed to update transaction notes');
      
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
          <button 
            className={`menu-item ${activeTab === 'advisor' ? 'active' : ''}`}
            onClick={() => setActiveTab('advisor')}
          >
            <BrainCircuit size={18} />
            <span>AI Advisor</span>
          </button>
          <button 
            className={`menu-item ${activeTab === 'cases' ? 'active' : ''}`}
            onClick={() => setActiveTab('cases')}
          >
            <Database size={18} />
            <span>Case Memory</span>
          </button>
          <button 
            className={`menu-item ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            <Sliders size={18} />
            <span>Settings</span>
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
              {activeTab === 'advisor' && 'AI Financial Advisor (RAG + Fusion)'}
              {activeTab === 'cases' && 'ChromaDB Vector Case Memory'}
              {activeTab === 'settings' && 'System & Business Settings'}
            </h2>
            <p>
              {activeTab === 'dashboard' && 'Real-time cash flow monitoring and spending insights.'}
              {activeTab === 'invoices' && 'View, search, and audit transaction records.'}
              {activeTab === 'upload' && 'Upload invoice receipts to trigger Tesseract OCR & NLP analysis.'}
              {activeTab === 'forecast' && '30-day future cash flow estimates comparing Prophet and ARIMA projections.'}
              {activeTab === 'advisor' && 'Ask spending/revenue proposals to retrieve past case memory, analyze cashflow trajectory, and get LLM reasoning.'}
              {activeTab === 'cases' && 'Browse, filter, and inspect indexed past business case memories stored in ChromaDB vector store.'}
              {activeTab === 'settings' && 'Configure starting cash balance, safety threshold, and preferred Gemini LLM reasoning model.'}
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
                    <div className="metric-icon-box green">
                      <TrendingUp size={20} />
                    </div>
                    <div className="metric-details">
                      <span className="metric-detail-label">Total Income</span>
                      <span className="metric-detail-value" style={{ color: '#34d399' }}>Rs.{stats.total_income ? stats.total_income.toLocaleString() : '0'}</span>
                    </div>
                  </div>

                  <div className="glass-card metric-mini-card">
                    <div className="metric-icon-box blue">
                      <TrendingDown size={20} />
                    </div>
                    <div className="metric-details">
                      <span className="metric-detail-label">Total Expenses</span>
                      <span className="metric-detail-value" style={{ color: '#f87171' }}>Rs.{stats.total_expenses ? stats.total_expenses.toLocaleString() : '0'}</span>
                    </div>
                  </div>

                  <div className="glass-card metric-mini-card">
                    <div className="metric-icon-box indigo">
                      <FileCheck size={20} />
                    </div>
                    <div className="metric-details">
                      <span className="metric-detail-label">Total Transactions</span>
                      <span className="metric-detail-value">{stats.total_transactions}</span>
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
                      <h3>Recent Transactions</h3>
                      <button className="view-all-btn" onClick={() => setActiveTab('invoices')}>
                        <span>All</span>
                        <ArrowRight size={14} />
                      </button>
                    </div>

                    <div className="table-wrapper">
                      {transactions.length > 0 ? (
                        <table className="custom-table" style={{ fontSize: '0.8rem' }}>
                          <thead>
                            <tr>
                              <th>Date</th>
                              <th>Type</th>
                              <th>Vendor / Client</th>
                              <th style={{ textAlign: 'right' }}>Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {transactions.slice(0, 3).map((txn) => (
                              <tr key={txn.id}>
                                <td>{txn.date}</td>
                                <td>
                                  <span className={`badge type-${txn.transaction_type}`} style={{
                                    color: txn.transaction_type === 'income' || txn.transaction_type === 'return_in' ? '#34d399' : '#f87171',
                                    background: txn.transaction_type === 'income' || txn.transaction_type === 'return_in' ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.1)',
                                    border: `1px solid ${txn.transaction_type === 'income' || txn.transaction_type === 'return_in' ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.2)'}`,
                                    fontSize: '0.7rem', padding: '0.15rem 0.5rem'
                                  }}>
                                    {txn.transaction_type === 'income' ? '↑ Income' : txn.transaction_type === 'return_in' ? '↑ Return' : txn.transaction_type === 'return_out' ? '↓ Refund' : '↓ Expense'}
                                  </span>
                                </td>
                                <td style={{ fontWeight: 600 }}>{txn.vendor_or_client}</td>
                                <td style={{ textAlign: 'right', fontWeight: 600, color: txn.transaction_type === 'income' || txn.transaction_type === 'return_in' ? '#34d399' : '#f1f5f9' }}>
                                  {txn.transaction_type === 'income' || txn.transaction_type === 'return_in' ? '+' : '-'}Rs.{txn.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
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

            {/* 2. TRANSACTIONS LEDGER VIEW */}
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ color: '#64748b', fontSize: '0.85rem' }}>
                      Showing <strong>{transactions.length}</strong> entries
                    </div>
                    <button
                      className="btn-primary"
                      onClick={deduplicateTransactions}
                      style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', background: 'rgba(239, 68, 68, 0.1)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.25)' }}
                      title="Remove identical duplicate records"
                    >
                      Clean Duplicates
                    </button>
                    <button
                      className="btn-primary"
                      onClick={downloadTransactionsCSV}
                      style={{ padding: '0.4rem 1rem', fontSize: '0.8rem', background: 'rgba(255,255,255,0.04)', color: 'white', border: '1px solid rgba(255,255,255,0.08)' }}
                    >
                      Export Ledger (.CSV)
                    </button>
                  </div>
                </div>

                {/* Ledger Data Table */}
                <div className="table-wrapper">
                  {transactions.length > 0 ? (
                    <table className="custom-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Type</th>
                          <th>Vendor / Client</th>
                          <th>Category</th>
                          <th style={{ textAlign: 'left' }}>Notes</th>
                          <th style={{ textAlign: 'right' }}>Amount</th>
                          <th style={{ textAlign: 'center' }}>Health</th>
                          <th style={{ textAlign: 'center' }}>Outcome Label</th>
                          <th style={{ textAlign: 'center' }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {transactions.map((txn) => (
                          <tr key={txn.id}>
                            <td>{txn.date}</td>
                            <td>
                              <select
                                value={txn.transaction_type}
                                onChange={(e) => updateTransactionType(txn.id, e.target.value)}
                                style={{
                                  background: txn.transaction_type === 'income' || txn.transaction_type === 'return_in' ? 'rgba(52, 211, 153, 0.12)' : 'rgba(248, 113, 113, 0.12)',
                                  color: txn.transaction_type === 'income' || txn.transaction_type === 'return_in' ? '#34d399' : '#f87171',
                                  border: `1px solid ${txn.transaction_type === 'income' || txn.transaction_type === 'return_in' ? 'rgba(52, 211, 153, 0.3)' : 'rgba(248, 113, 113, 0.3)'}`,
                                  borderRadius: '8px',
                                  padding: '0.25rem 0.5rem',
                                  fontSize: '0.75rem',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                  outline: 'none'
                                }}
                              >
                                <option value="expense" style={{ background: '#0f1629', color: '#f87171' }}>↓ Expense</option>
                                <option value="income" style={{ background: '#0f1629', color: '#34d399' }}>↑ Income</option>
                                <option value="return_in" style={{ background: '#0f1629', color: '#34d399' }}>↑ Return In</option>
                                <option value="return_out" style={{ background: '#0f1629', color: '#f87171' }}>↓ Refund Out</option>
                              </select>
                            </td>
                            <td style={{ fontWeight: 700, color: '#ffffff' }}>{txn.vendor_or_client}</td>
                            <td>
                              <span className={`badge ${txn.category === 'Shopping' ? 'category-shopping' : 'category'}`}>
                                {txn.category}
                              </span>
                            </td>
                            <td style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: '0.85rem', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }} title={txn.user_notes}>
                              {txn.user_notes || '—'}
                            </td>
                            <td style={{ textAlign: 'right', fontWeight: 600, color: txn.transaction_type === 'income' || txn.transaction_type === 'return_in' ? '#34d399' : '#f1f5f9' }}>
                              {txn.transaction_type === 'income' || txn.transaction_type === 'return_in' ? '+' : '-'}Rs.{txn.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <span className={`badge status-${txn.outcome_label}`}>
                                {txn.outcome_label}
                              </span>
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <select
                                id={`outcome-select-${txn.id}`}
                                value={txn.user_outcome || ''}
                                onChange={(e) => saveOutcomeLabel(txn.id, e.target.value)}
                                style={{
                                  background: txn.user_outcome ? 'rgba(99, 102, 241, 0.12)' : 'rgba(255,255,255,0.04)',
                                  color: txn.user_outcome ? {
                                    'Productive': '#34d399',
                                    'Necessary': '#60a5fa',
                                    'Wasteful': '#f87171',
                                    'Pending Review': '#fbbf24',
                                    'Break-even': '#94a3b8'
                                  }[txn.user_outcome] || '#c084fc' : '#64748b',
                                  border: '1px solid rgba(255,255,255,0.08)',
                                  borderRadius: '8px',
                                  padding: '0.3rem 0.5rem',
                                  fontSize: '0.78rem',
                                  fontWeight: txn.user_outcome ? 600 : 400,
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
                            <td style={{ textAlign: 'center' }}>
                              <button
                                onClick={() => deleteTransaction(txn.id)}
                                title="Delete transaction"
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  color: '#64748b',
                                  cursor: 'pointer',
                                  padding: '0.3rem',
                                  borderRadius: '6px',
                                  transition: 'color 0.2s'
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.color = '#ef4444'}
                                onMouseLeave={(e) => e.currentTarget.style.color = '#64748b'}
                              >
                                <Trash2 size={16} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="empty-state">
                      <AlertCircle size={32} />
                      <div className="empty-state-title">No transactions found</div>
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
                        Manual Entry
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
                            <label style={{ color: '#94a3b8', fontSize: '0.85rem', fontWeight: 600, display: 'block', marginBottom: '0.5rem' }}>Vendor / Client</label>
                            <input 
                              type="text" 
                              placeholder="e.g. ABC Traders, Client XYZ"
                              value={manualForm.vendor_or_client}
                              onChange={(e) => setManualForm({ ...manualForm, vendor_or_client: e.target.value })}
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
                          <div className="field-group">
                            <label style={{ color: '#94a3b8', fontSize: '0.85rem', fontWeight: 600, display: 'block', marginBottom: '0.5rem' }}>Transaction Type</label>
                            <select 
                              value={manualForm.transaction_type}
                              onChange={(e) => setManualForm({ ...manualForm, transaction_type: e.target.value })}
                              style={{ background: 'rgba(15,23,42,0.5)', border: '1px solid rgba(255,255,255,0.08)', color: 'white', padding: '0.65rem 0.85rem', borderRadius: '8px', fontSize: '0.9rem', width: '100%', outline: 'none', height: '42px' }}
                            >
                              <option value="expense">↓ Expense (Money Out)</option>
                              <option value="income">↑ Income (Money In)</option>
                              <option value="return_in">↑ Refund Received</option>
                              <option value="return_out">↓ Refund Given</option>
                            </select>
                          </div>
                          <div className="field-group" style={{ gridColumn: 'span 2' }}>
                            <label style={{ color: '#94a3b8', fontSize: '0.85rem', fontWeight: 600, display: 'block', marginBottom: '0.5rem' }}>Reasoning / Notes</label>
                            <textarea 
                              placeholder="Explain the purpose of this transaction (e.g. AWS renewal, client payment for services...)"
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
                            {manualSubmitting ? 'Recording...' : 'Record Transaction'}
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
                          <label>Vendor / Client</label>
                          <input type="text" value={uploadState.data.vendor_or_client || uploadState.data.vendor || ''} readOnly />
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
                        <div className="field-group">
                          <label>Transaction Type</label>
                          <select 
                            value={uploadState.data.transaction_type || 'expense'} 
                            onChange={(e) => {
                              const newType = e.target.value;
                              setUploadState(prev => ({
                                ...prev,
                                data: { ...prev.data, transaction_type: newType }
                              }));
                              if (uploadState.data?.id) {
                                updateTransactionType(uploadState.data.id, newType);
                              }
                            }}
                            style={{ 
                              color: uploadState.data.transaction_type === 'income' || uploadState.data.transaction_type === 'return_in' ? '#34d399' : '#f87171',
                              fontWeight: 600,
                              background: 'rgba(15,23,42,0.6)',
                              border: '1px solid rgba(255,255,255,0.08)',
                              borderRadius: '8px',
                              padding: '0.65rem 0.85rem',
                              fontSize: '0.9rem',
                              width: '100%',
                              outline: 'none',
                              cursor: 'pointer'
                            }} 
                          >
                            <option value="expense" style={{ background: '#0f1629', color: '#f87171' }}>↓ Expense (Money Out)</option>
                            <option value="income" style={{ background: '#0f1629', color: '#34d399' }}>↑ Income (Money In)</option>
                            <option value="return_in" style={{ background: '#0f1629', color: '#34d399' }}>↑ Return In (Refund Received)</option>
                            <option value="return_out" style={{ background: '#0f1629', color: '#f87171' }}>↓ Refund Out (Refund Given)</option>
                          </select>
                        </div>
                        <div className="field-group">
                          <label>Live Balance</label>
                          <input 
                            type="text" 
                            value={`Rs.${(uploadState.data.current_balance || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })} (${uploadState.data.outcome_label})`} 
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

            {/* Advisor View Tab */}
            {activeTab === 'advisor' && (
              <div className="tab-content fade-in">
                {/* Advisor Hero Query Box */}
                <div className="glass-card" style={{ padding: '2rem', marginBottom: '2rem', background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.8), rgba(30, 41, 59, 0.5))', borderRadius: '20px', border: '1px solid rgba(99, 102, 241, 0.2)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <div style={{ padding: '0.5rem', background: 'linear-gradient(135deg, #6366f1, #3b82f6)', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                        <BrainCircuit size={24} />
                      </div>
                      <div>
                        <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#fff' }}>RAG Fusion Financial Advisor</h3>
                        <p style={{ margin: 0, fontSize: '0.85rem', color: '#94a3b8' }}>Propose spending or revenue decisions to analyze against live cash reserves, 30-day forecasting models, and ChromaDB past case memories.</p>
                      </div>
                    </div>

                    {/* Language Selector Toggle */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'rgba(0,0,0,0.3)', padding: '0.3rem', borderRadius: '14px', border: '1px solid rgba(255,255,255,0.08)' }}>
                      <Globe size={16} color="#818cf8" style={{ marginLeft: '0.4rem' }} />
                      <button
                        type="button"
                        onClick={() => setAdvisorLang('en')}
                        style={{
                          background: advisorLang === 'en' ? 'linear-gradient(135deg, #6366f1, #3b82f6)' : 'transparent',
                          color: advisorLang === 'en' ? '#fff' : '#94a3b8',
                          border: 'none',
                          padding: '0.35rem 0.75rem',
                          borderRadius: '10px',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          cursor: 'pointer'
                        }}
                      >
                        English
                      </button>
                      <button
                        type="button"
                        onClick={() => setAdvisorLang('ta')}
                        style={{
                          background: advisorLang === 'ta' ? 'linear-gradient(135deg, #6366f1, #3b82f6)' : 'transparent',
                          color: advisorLang === 'ta' ? '#fff' : '#94a3b8',
                          border: 'none',
                          padding: '0.35rem 0.75rem',
                          borderRadius: '10px',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          cursor: 'pointer'
                        }}
                      >
                        Tamil (தமிழ்)
                      </button>
                    </div>
                  </div>

                  {/* Input Form with Mic Button */}
                  <form onSubmit={(e) => { e.preventDefault(); handleAdvisorSubmit(); }} style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
                    <div style={{ flexGrow: 1, position: 'relative', display: 'flex', alignItems: 'center' }}>
                      <input 
                        type="text"
                        className="search-input"
                        placeholder={advisorLang === 'ta' ? "உதாரணம்: 5 புதிய லேப்டாப்கள் ₹75,000க்கு வாங்கலாமா?" : "e.g. Should I spend Rs. 75,000 on 5 development laptops for our engineering team?"}
                        value={advisorQuery}
                        onChange={(e) => setAdvisorQuery(e.target.value)}
                        style={{ width: '100%', padding: '0.9rem 3.5rem 0.9rem 1.2rem', fontSize: '0.95rem', borderRadius: '14px', background: 'rgba(15, 23, 42, 0.7)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}
                      />
                      <button
                        type="button"
                        onClick={toggleSpeechRecognition}
                        style={{
                          position: 'absolute',
                          right: '0.6rem',
                          background: isListening ? 'rgba(239, 68, 68, 0.25)' : 'rgba(255,255,255,0.06)',
                          border: `1px solid ${isListening ? '#ef4444' : 'rgba(255,255,255,0.1)'}`,
                          color: isListening ? '#ef4444' : '#818cf8',
                          borderRadius: '10px',
                          padding: '0.5rem',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          animation: isListening ? 'pulse 1.5s infinite' : 'none'
                        }}
                        title={isListening ? "Listening to your voice... Speak now!" : "Click to speak your question using microphone"}
                      >
                        {isListening ? <MicOff size={18} /> : <Mic size={18} />}
                      </button>
                    </div>

                    <button 
                      type="submit"
                      className="filter-pill active"
                      disabled={advisorLoading || !advisorQuery.trim()}
                      style={{ padding: '0.9rem 1.75rem', borderRadius: '14px', display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, cursor: advisorLoading ? 'not-allowed' : 'pointer', opacity: advisorLoading ? 0.7 : 1, background: 'linear-gradient(135deg, #6366f1, #3b82f6)' }}
                    >
                      {advisorLoading ? (
                        <>
                          <RefreshCw size={18} className="spin" />
                          <span>Reasoning...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles size={18} />
                          <span>Get Advice</span>
                        </>
                      )}
                    </button>
                  </form>

                  {/* Sample Query Suggestions */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '1rem', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                      <Lightbulb size={14} color="#f59e0b" /> Sample Queries:
                    </span>
                    {[
                      'Should I buy 5 new laptops for Rs. 75,000?',
                      'Can we afford Rs. 35,000 for Google Ads search marketing?',
                      'Will paying office lease rent of Rs. 45,000 strain our cash balance?',
                      'Should I purchase an Enterprise ERP software subscription for Rs. 85,000?'
                    ].map((sample, idx) => (
                      <button
                        key={idx}
                        onClick={() => {
                          setAdvisorQuery(sample);
                          handleAdvisorSubmit(sample);
                        }}
                        style={{
                          background: 'rgba(255, 255, 255, 0.04)',
                          border: '1px solid rgba(255, 255, 255, 0.08)',
                          borderRadius: '20px',
                          color: '#cbd5e1',
                          fontSize: '0.75rem',
                          padding: '0.35rem 0.75rem',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease'
                        }}
                      >
                        {sample}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Error Banner */}
                {advisorError && (
                  <div className="alert alert-error" style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <AlertCircle size={20} />
                    <span>{advisorError}</span>
                  </div>
                )}

                {/* Advisor Recommendation Result Display */}
                {advisorResult && (
                  <div className="fade-in">
                    {/* Top Row: Verdict Banner & Adaptive Blending Card */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem', marginBottom: '1.5rem' }}>
                      
                      {/* Verdict Banner Card */}
                      <div className="glass-card" style={{ padding: '1.75rem', borderRadius: '20px', border: `1px solid ${advisorResult.verdict === 'Recommended' ? '#34d399' : advisorResult.verdict === 'Proceed with Caution' ? '#fbbf24' : '#ef4444'}`, background: 'rgba(15, 23, 42, 0.65)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                          <div>
                            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>AI Recommendation</span>
                            <h4 style={{ 
                              margin: '0.25rem 0 0 0', 
                              fontSize: '1.6rem', 
                              fontWeight: 800, 
                              color: advisorResult.verdict === 'Recommended' ? '#34d399' : advisorResult.verdict === 'Proceed with Caution' ? '#fbbf24' : '#ef4444',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.5rem'
                            }}>
                              {advisorResult.verdict === 'Recommended' && <CheckCircle size={24} />}
                              {advisorResult.verdict === 'Proceed with Caution' && <ShieldAlert size={24} />}
                              {advisorResult.verdict === 'Not Recommended' && <AlertCircle size={24} />}
                              {advisorResult.verdict}
                            </h4>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            {/* Read Aloud Text-to-Speech Button */}
                            <button
                              type="button"
                              onClick={speakRecommendation}
                              style={{
                                background: isSpeaking ? 'rgba(99, 102, 241, 0.25)' : 'rgba(255,255,255,0.06)',
                                border: '1px solid rgba(99, 102, 241, 0.3)',
                                color: '#818cf8',
                                borderRadius: '12px',
                                padding: '0.4rem 0.75rem',
                                fontSize: '0.75rem',
                                fontWeight: 700,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.35rem'
                              }}
                              title="Listen to recommendation out loud (Text-to-Speech)"
                            >
                              {isSpeaking ? <VolumeX size={16} /> : <Volume2 size={16} />}
                              <span>{isSpeaking ? 'Stop' : 'Listen'}</span>
                            </button>

                            <span style={{ 
                              padding: '0.35rem 0.85rem', 
                              borderRadius: '20px', 
                              fontSize: '0.75rem', 
                              fontWeight: 700,
                              background: advisorResult.risk_level === 'Low' ? 'rgba(52, 211, 153, 0.15)' : advisorResult.risk_level === 'Medium' ? 'rgba(251, 191, 36, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                              color: advisorResult.risk_level === 'Low' ? '#34d399' : advisorResult.risk_level === 'Medium' ? '#fbbf24' : '#ef4444',
                              border: `1px solid ${advisorResult.risk_level === 'Low' ? '#34d399' : advisorResult.risk_level === 'Medium' ? '#fbbf24' : '#ef4444'}`
                            }}>
                              {advisorResult.risk_level} Risk Profile
                            </span>
                          </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', padding: '1rem', background: 'rgba(0,0,0,0.25)', borderRadius: '14px', marginBottom: '1rem' }}>
                          <div>
                            <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Current Cash Balance</div>
                            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#fff' }}>Rs.{advisorResult.current_balance?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Est. Post-Transaction Reserve</div>
                            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: advisorResult.estimated_post_balance >= 10000 ? '#34d399' : '#ef4444' }}>
                              Rs.{advisorResult.estimated_post_balance?.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </div>
                          </div>
                        </div>

                        {advisorResult.suggested_action && (
                          <div style={{ fontSize: '0.85rem', color: '#cbd5e1', background: 'rgba(99, 102, 241, 0.08)', padding: '0.75rem 1rem', borderRadius: '12px', borderLeft: '3px solid #6366f1' }}>
                            <strong>Suggested Next Step:</strong> {advisorResult.suggested_action}
                          </div>
                        )}
                      </div>

                      {/* Adaptive Blending Algorithm Card */}
                      <div className="glass-card" style={{ padding: '1.75rem', borderRadius: '20px', background: 'rgba(15, 23, 42, 0.65)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                          <Bot size={20} color="#818cf8" />
                          <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#fff' }}>Adaptive Blending Calibration</h4>
                        </div>
                        
                        <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '1rem', lineHeight: 1.4 }}>
                          FinSense dynamically balances vector case memory vs. baseline financial rules based on case history volume.
                        </p>

                        <div style={{ marginBottom: '1.25rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontWeight: 700, color: '#fff', marginBottom: '0.4rem' }}>
                            <span>Case Memory Weight ({Math.round(advisorResult.blend_weight * 100)}%)</span>
                            <span>Rule Baseline ({Math.round((1 - advisorResult.blend_weight) * 100)}%)</span>
                          </div>
                          <div style={{ height: '10px', background: 'rgba(255,255,255,0.08)', borderRadius: '10px', overflow: 'hidden', display: 'flex' }}>
                            <div style={{ width: `${advisorResult.blend_weight * 100}%`, background: 'linear-gradient(90deg, #6366f1, #818cf8)', transition: 'width 0.5s ease' }}></div>
                            <div style={{ width: `${(1 - advisorResult.blend_weight) * 100}%`, background: 'rgba(255,255,255,0.15)' }}></div>
                          </div>
                        </div>

                        <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.75rem', color: '#cbd5e1' }}>
                          <div style={{ flex: 1, padding: '0.6rem', background: 'rgba(255,255,255,0.03)', borderRadius: '10px', textAlign: 'center' }}>
                            <div style={{ color: '#818cf8', fontWeight: 700, fontSize: '0.95rem' }}>{advisorResult.retrieved_cases?.length || 0}</div>
                            <div style={{ color: '#64748b' }}>Retrieved Cases</div>
                          </div>
                          <div style={{ flex: 1, padding: '0.6rem', background: 'rgba(255,255,255,0.03)', borderRadius: '10px', textAlign: 'center' }}>
                            <div style={{ color: '#34d399', fontWeight: 700, fontSize: '0.95rem' }}>ChromaDB</div>
                            <div style={{ color: '#64748b' }}>Vector Index</div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Middle Row: Explainable LLM Reasoning & Key Rationale */}
                    <div className="glass-card" style={{ padding: '2rem', borderRadius: '20px', marginBottom: '1.5rem', background: 'rgba(15, 23, 42, 0.65)' }}>
                      <h4 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Sparkles size={20} color="#6366f1" />
                        Explainable Recommendation Rationale
                      </h4>
                      
                      <p style={{ fontSize: '0.95rem', color: '#e2e8f0', lineHeight: 1.6, marginBottom: '1.25rem' }}>
                        {advisorResult.explanation}
                      </p>

                      {advisorResult.key_factors && advisorResult.key_factors.length > 0 && (
                        <div>
                          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.6rem' }}>
                            Key Decision Factors
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {advisorResult.key_factors.map((factor, idx) => (
                              <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.85rem', color: '#cbd5e1', background: 'rgba(255,255,255,0.02)', padding: '0.6rem 0.85rem', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.04)' }}>
                                <CheckCircle size={16} color="#34d399" />
                                <span>{factor}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Bottom Row: Retrieved Vector Case Memories from ChromaDB */}
                    <div className="glass-card" style={{ padding: '2rem', borderRadius: '20px', background: 'rgba(15, 23, 42, 0.65)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                        <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <Tag size={20} color="#818cf8" />
                          Retrieved Case Memories (Cosine Similarity)
                        </h4>
                        <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Matched from 60+ Indexed Small Business Transactions</span>
                      </div>

                      {advisorResult.retrieved_cases && advisorResult.retrieved_cases.length > 0 ? (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
                          {advisorResult.retrieved_cases.map((c, idx) => (
                            <div key={idx} style={{ padding: '1rem 1.2rem', borderRadius: '14px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                                <span style={{ fontWeight: 700, color: '#fff', fontSize: '0.9rem' }}>{c.vendor_or_client}</span>
                                <span style={{ 
                                  fontSize: '0.7rem', 
                                  fontWeight: 700, 
                                  padding: '0.2rem 0.5rem', 
                                  borderRadius: '12px',
                                  background: c.outcome === 'healthy' ? 'rgba(52, 211, 153, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                                  color: c.outcome === 'healthy' ? '#34d399' : '#ef4444'
                                }}>
                                  {c.outcome}
                                </span>
                              </div>

                              <div style={{ fontSize: '1rem', fontWeight: 800, color: c.transaction_type === 'income' || c.transaction_type === 'return_in' ? '#34d399' : '#f87171', marginBottom: '0.4rem' }}>
                                {c.transaction_type === 'income' || c.transaction_type === 'return_in' ? '+' : '-'}Rs.{c.amount?.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              </div>

                              <div style={{ fontSize: '0.75rem', color: '#94a3b8', fontStyle: 'italic', marginBottom: '0.6rem', lineHeight: 1.3 }}>
                                "{c.notes || c.summary_text || 'Past business transaction record'}"
                              </div>

                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.7rem', color: '#64748b', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '0.4rem' }}>
                                <span>Category: {c.category}</span>
                                <span style={{ color: '#818cf8', fontWeight: 600 }}>Score: {c.similarity_score}%</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p style={{ color: '#64748b', fontSize: '0.85rem' }}>No similar past case memories found in ChromaDB.</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Case Memory Viewer Tab */}
            {activeTab === 'cases' && (
              <div className="tab-content fade-in">
                <div className="glass-card" style={{ padding: '2rem', borderRadius: '20px', marginBottom: '1.5rem', background: 'rgba(15, 23, 42, 0.65)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Database size={22} color="#818cf8" />
                        ChromaDB Vector Store Explorer
                      </h3>
                      <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: '#94a3b8' }}>
                        Indexed historical case memory dataset ({casesList.length} total entries). Used by RAG fusion for semantic cosine retrieval.
                      </p>
                    </div>

                    <input 
                      type="text"
                      className="search-input"
                      placeholder="Search cases by vendor, category, or notes..."
                      value={casesSearch}
                      onChange={(e) => setCasesSearch(e.target.value)}
                      style={{ width: '280px', padding: '0.6rem 1rem', fontSize: '0.85rem', borderRadius: '12px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff' }}
                    />
                  </div>

                  {casesLoading ? (
                    <div style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>
                      <RefreshCw size={24} className="spin" style={{ marginBottom: '0.5rem' }} />
                      <div>Loading ChromaDB vector case memories...</div>
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
                      {casesList
                        .filter(c => !casesSearch || (c.vendor_or_client + ' ' + c.category + ' ' + c.notes).toLowerCase().includes(casesSearch.toLowerCase()))
                        .map((c, idx) => (
                          <div key={idx} style={{ padding: '1.2rem', borderRadius: '16px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                            <div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                                <span style={{ fontWeight: 700, color: '#fff', fontSize: '0.95rem' }}>{c.vendor_or_client}</span>
                                <span style={{ 
                                  fontSize: '0.7rem', 
                                  fontWeight: 700, 
                                  padding: '0.25rem 0.6rem', 
                                  borderRadius: '12px',
                                  background: c.outcome === 'healthy' ? 'rgba(52, 211, 153, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                                  color: c.outcome === 'healthy' ? '#34d399' : '#ef4444'
                                }}>
                                  {c.outcome}
                                </span>
                              </div>

                              <div style={{ fontSize: '1.1rem', fontWeight: 800, color: c.transaction_type === 'income' || c.transaction_type === 'return_in' ? '#34d399' : '#f87171', marginBottom: '0.5rem' }}>
                                {c.transaction_type === 'income' || c.transaction_type === 'return_in' ? '+' : '-'}Rs.{c.amount?.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              </div>

                              <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: '0 0 0.8rem 0', lineHeight: 1.4 }}>
                                {c.notes || c.summary_text || 'Past business transaction decision memory'}
                              </p>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', color: '#64748b', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '0.5rem' }}>
                              <span>Category: {c.category}</span>
                              <span style={{ color: '#818cf8', fontWeight: 600 }}>Case #{c.id}</span>
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* System Settings Tab */}
            {activeTab === 'settings' && (
              <div className="tab-content fade-in">
                <div className="glass-card" style={{ padding: '2rem', maxWidth: '650px', margin: '0 auto', borderRadius: '20px', background: 'rgba(15, 23, 42, 0.75)' }}>
                  <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.25rem', fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Sliders size={22} color="#6366f1" />
                    System & Business Configuration
                  </h3>
                  <p style={{ margin: '0 0 1.75rem 0', fontSize: '0.85rem', color: '#94a3b8' }}>
                    Manage baseline liquidity settings, safety threshold alerts, and LLM reasoning models.
                  </p>

                  <form onSubmit={handleSettingsSave} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: '#cbd5e1', marginBottom: '0.4rem' }}>
                        Starting Business Cash Balance (Rs.)
                      </label>
                      <input 
                        type="number"
                        step="0.01"
                        className="search-input"
                        value={settingsForm.starting_balance}
                        onChange={(e) => setSettingsForm(prev => ({ ...prev, starting_balance: parseFloat(e.target.value) || 0 }))}
                        style={{ width: '100%', padding: '0.8rem 1rem', borderRadius: '12px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}
                      />
                      <span style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.2rem', display: 'block' }}>
                        Live balance is calculated as: Starting Balance + Σ(Income) - Σ(Expenses).
                      </span>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: '#cbd5e1', marginBottom: '0.4rem' }}>
                        Financial Safety Alert Threshold (Rs.)
                      </label>
                      <input 
                        type="number"
                        step="0.01"
                        className="search-input"
                        value={settingsForm.balance_alert_threshold}
                        onChange={(e) => setSettingsForm(prev => ({ ...prev, balance_alert_threshold: parseFloat(e.target.value) || 0 }))}
                        style={{ width: '100%', padding: '0.8rem 1rem', borderRadius: '12px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}
                      />
                      <span style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.2rem', display: 'block' }}>
                        Triggers "Strained" risk warnings when cash reserve drops below this amount.
                      </span>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: '#cbd5e1', marginBottom: '0.4rem' }}>
                        Preferred Gemini AI Reasoning Model
                      </label>
                      <select
                        className="search-input"
                        value={settingsForm.gemini_model}
                        onChange={(e) => setSettingsForm(prev => ({ ...prev, gemini_model: e.target.value }))}
                        style={{ width: '100%', padding: '0.8rem 1rem', borderRadius: '12px', background: 'rgba(15,23,42,0.9)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}
                      >
                        <option value="gemini-3.5-flash">Gemini 3.5 Flash (Recommended - Latest & Fast)</option>
                        <option value="gemini-2.5-pro">Gemini 2.5 Pro (Deep Complex Reasoning)</option>
                        <option value="gemini-2.5-flash">Gemini 2.5 Flash (Standard Baseline)</option>
                      </select>
                      <span style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.2rem', display: 'block' }}>
                        Used by RAG Fusion engine for generating explainable advice.
                      </span>
                    </div>

                    <button 
                      type="submit"
                      className="filter-pill active"
                      disabled={settingsSaving}
                      style={{ padding: '0.85rem 1.5rem', borderRadius: '12px', fontWeight: 700, cursor: 'pointer', marginTop: '0.5rem', background: 'linear-gradient(135deg, #6366f1, #3b82f6)' }}
                    >
                      {settingsSaving ? 'Saving Settings...' : 'Save System Settings'}
                    </button>
                  </form>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default App;
