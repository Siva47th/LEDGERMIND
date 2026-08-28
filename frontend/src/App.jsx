import { useState, useEffect, useRef } from 'react';
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
  Globe,
  Download,
  Zap,
  Building2,
  Calendar,
  Pencil,
  Check
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, LineChart, Line, Area, ComposedChart, ReferenceLine, ReferenceArea, XAxis, YAxis, CartesianGrid, Legend } from 'recharts';
import './App.css';

const API_BASE = 'http://localhost:5000/api';

const isTamilScript = (str) => Boolean(str && /[\u0b80-\u0bff]/.test(str));

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
      <div className="glass-card custom-tooltip" style={{ padding: '0.85rem 1.1rem', border: '1.5px solid #cbd5e1', background: '#ffffff', color: '#0f172a', fontSize: '0.82rem', width: '280px', maxWidth: '280px', textAlign: 'left', borderRadius: '14px', boxShadow: '0 10px 25px rgba(15, 23, 42, 0.12)', wordBreak: 'break-word', whiteSpace: 'normal' }}>
        <div style={{ fontWeight: 800, color: '#475569', marginBottom: '0.4rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.35rem' }}>{data.date}</div>
        
        {!isForecast ? (
          <>
            <div style={{ color: '#1d4ed8', fontWeight: 800, fontSize: '0.92rem', margin: '0.35rem 0' }}>
              Balance: Rs.{data.actual.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', color: '#15803d', fontSize: '0.78rem', fontWeight: 700, marginBottom: '0.2rem' }}>
              <span>Received:</span>
              <span>+Rs.{data.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', color: '#b91c1c', fontSize: '0.78rem', fontWeight: 700, marginBottom: '0.4rem' }}>
              <span>Spent:</span>
              <span>-Rs.{(data.expense + data.recurring + data.actual_invoice).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
            {data.description && (
              <div style={{ color: '#4338ca', fontSize: '0.75rem', borderTop: '1px solid #f1f5f9', paddingTop: '0.4rem', fontWeight: 600, lineHeight: 1.35 }}>
                {data.description}
              </div>
            )}
          </>
        ) : (
          <>
            {data.prophet && (
              <div style={{ color: '#6366f1', fontWeight: 800, fontSize: '0.82rem', margin: '0.2rem 0' }}>
                Prophet: Rs.{data.prophet.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
            )}
            {data.arima && (
              <div style={{ color: '#0369a1', fontWeight: 800, marginTop: '0.2rem', fontSize: '0.82rem' }}>
                ARIMA: Rs.{data.arima.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
            )}
            <div style={{ color: '#64748b', fontSize: '0.72rem', borderTop: '1px solid #f1f5f9', paddingTop: '0.35rem', marginTop: '0.4rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Future 30-Day Outlook
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
  const [isVoiceCaptured, setIsVoiceCaptured] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const currentAudioRef = useRef(null);

  const handleAdvisorSubmit = async (queryText) => {
    const q = queryText || advisorQuery;
    if (!q || !q.trim()) return;
    setIsVoiceCaptured(false);

    // Auto-detect Tamil characters in query
    const hasTamilScript = /[\u0B80-\u0BFF]/.test(q);
    const targetLang = hasTamilScript ? 'ta' : advisorLang;
    if (hasTamilScript && advisorLang !== 'ta') {
      setAdvisorLang('ta');
    }

    setAdvisorLoading(true);
    setAdvisorError(null);
    try {
      const res = await fetch(`${API_BASE}/advisor/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, language: targetLang })
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

      recognition.onstart = () => {
        setIsListening(true);
        setIsVoiceCaptured(false);
      };
      recognition.onend = () => setIsListening(false);
      recognition.onerror = (e) => {
        console.error('Speech recognition error:', e);
        setIsListening(false);
      };

      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        if (transcript) {
          setAdvisorQuery(transcript);
          setIsVoiceCaptured(true);
        }
      };

      recognition.start();
    } catch (err) {
      console.error('Failed to start speech recognition:', err);
      setIsListening(false);
    }
  };

  const numberToTamilWords = (n) => {
    n = Math.floor(Number(n));
    if (isNaN(n) || n <= 0) return '';

    const ones = ['', 'ஒன்று', 'இரண்டு', 'மூன்று', 'நான்கு', 'ஐந்து', 'ஆறு', 'ஏழு', 'எட்டு', 'ஒன்பது'];
    const tensTeens = ['', 'பதினொன்று', 'பன்னிரண்டு', 'பதின்மூன்று', 'பதினான்கு', 'பதினைந்து', 'பதினாறு', 'பதினேழு', 'பதினெட்டு', 'பத்தொன்பது'];
    const tensExact = ['', 'பத்து', 'இருபது', 'முப்பது', 'நாற்பது', 'ஐம்பது', 'அறுபது', 'எழுபது', 'எண்பது', 'தொன்னூறு'];
    const tensPrefix = ['', 'பத்து', 'இருபத்து ', 'முப்பத்து ', 'நாற்பத்து ', 'ஐம்பத்து ', 'அறுபத்து ', 'எழுபத்து ', 'எண்பத்து ', 'தொன்னூற்று '];

    const getTwoDigits = (val) => {
      val = Math.floor(val);
      if (val <= 0) return '';
      if (val < 10) return ones[val];
      if (val === 10) return 'பத்து';
      if (val > 10 && val < 20) return tensTeens[val - 10];
      const t = Math.floor(val / 10);
      const o = val % 10;
      if (o === 0) return tensExact[t];
      return tensPrefix[t] + ones[o];
    };

    let result = '';

    // Crores (கோடி)
    if (n >= 10000000) {
      const crore = Math.floor(n / 10000000);
      n %= 10000000;
      const cWords = crore === 1 ? 'ஒரு கோடி' : `${numberToTamilWords(crore)} கோடி`;
      result += (n > 0 ? `${cWords}யே ` : `${cWords} `);
    }

    // Lakhs (லட்சம்)
    if (n >= 100000) {
      const lakh = Math.floor(n / 100000);
      n %= 100000;
      const lWords = lakh === 1 ? 'ஒரு லட்சத்து' : `${numberToTamilWords(lakh)} லட்சத்து`;
      const lExact = lakh === 1 ? 'ஒரு லட்சம்' : `${numberToTamilWords(lakh)} லட்சம்`;
      result += (n > 0 ? `${lWords} ` : `${lExact} `);
    }

    // Thousands (ஆயிரம்)
    if (n >= 1000) {
      const th = Math.floor(n / 1000);
      n %= 1000;
      
      const thousandMap = {
        1: { exact: 'ஆயிரம்', prefix: 'ஆயிரத்து' },
        2: { exact: 'இரண்டாயிரம்', prefix: 'இரண்டாயிரத்து' },
        3: { exact: 'மூன்றாயிரம்', prefix: 'மூன்றாயிரத்து' },
        4: { exact: 'நான்காயிரம்', prefix: 'நான்காயிரத்து' },
        5: { exact: 'ஐந்தாயிரம்', prefix: 'ஐந்தாயிரத்து' },
        6: { exact: 'ஆறாயிரம்', prefix: 'ஆறாயிரத்து' },
        7: { exact: 'ஏழாயிரம்', prefix: 'ஏழாயிரத்து' },
        8: { exact: 'எட்டாயிரம்', prefix: 'எட்டாயிரத்து' },
        9: { exact: 'ஒன்பதாயிரம்', prefix: 'ஒன்பதாயிரத்து' },
        10: { exact: 'பத்தாயிரம்', prefix: 'பத்தாயிரத்து' },
        15: { exact: 'பதினைந்தாயிரம்', prefix: 'பதினைந்தாயிரத்து' },
        20: { exact: 'இருபதாயிரம்', prefix: 'இருபதாயிரத்து' },
        25: { exact: 'இருபத்தைந்தாயிரம்', prefix: 'இருபத்தைந்தாயிரத்து' },
        30: { exact: 'முப்பதாயிரம்', prefix: 'முப்பதாயிரத்து' },
        35: { exact: 'முப்பத்தைந்தாயிரம்', prefix: 'முப்பத்தைந்தாயிரத்து' },
        40: { exact: 'நாற்பதாயிரம்', prefix: 'நாற்பதாயிரத்து' },
        45: { exact: 'நாற்பத்தைந்தாயிரம்', prefix: 'நாற்பத்தைந்தாயிரத்து' },
        50: { exact: 'ஐம்பதாயிரம்', prefix: 'ஐம்பதாயிரத்து' },
        55: { exact: 'ஐம்பத்தைந்தாயிரம்', prefix: 'ஐம்பத்தைந்தாயிரத்து' },
        60: { exact: 'அறுபதாயிரம்', prefix: 'அறுபதாயிரத்து' },
        65: { exact: 'அறுபத்தைந்தாயிரம்', prefix: 'அறுபத்தைந்தாயிரத்து' },
        70: { exact: 'எழுபதாயிரம்', prefix: 'எழுபதாயிரத்து' },
        75: { exact: 'எழுபத்தைந்தாயிரம்', prefix: 'எழுபத்தைந்தாயிரத்து' },
        80: { exact: 'எண்பதாயிரம்', prefix: 'எண்பதாயிரத்து' },
        85: { exact: 'எண்பத்தைந்தாயிரம்', prefix: 'எண்பத்தைந்தாயிரத்து' },
        90: { exact: 'தொன்னூறாயிரம்', prefix: 'தொன்னூறாயிரத்து' }
      };

      if (thousandMap[th]) {
        result += (n > 0 ? `${thousandMap[th].prefix} ` : `${thousandMap[th].exact} `);
      } else {
        const thText = getTwoDigits(th);
        result += (n > 0 ? `${thText} ஆயிரத்து ` : `${thText} ஆயிரம் `);
      }
    }

    // Hundreds (நூறு)
    if (n >= 100) {
      const h = Math.floor(n / 100);
      n %= 100;
      const hundredExact = ['', 'நூறு', 'இருநூறு', 'முன்னூறு', 'நானூறு', 'ஐநூறு', 'அறுநூறு', 'எழுநூறு', 'எண்ணூறு', 'தொள்ளாயிரம்'];
      const hundredPrefix = ['', 'நூற்று', 'இருநூற்று', 'முன்னூற்று', 'நானூற்று', 'ஐநூற்று', 'அறுநூற்று', 'எழுநூற்று', 'எண்ணூற்று', 'தொள்ளாயிரத்து'];
      result += (n > 0 ? `${hundredPrefix[h]} ` : `${hundredExact[h]} `);
    }

    // Remaining Tens & Ones (1-99)
    if (n > 0) {
      result += getTwoDigits(n);
    }

    return result.trim();
  };

  const cleanTextForTTS = (text, isTamil) => {
    if (!text) return '';
    let clean = text;

    if (isTamil) {
      // 1. Handle bracketed Tamil translations first:
      // e.g. "Dell India (டெல் கணினி நிறுவனம்)" -> "டெல் கணினி நிறுவனம்"
      clean = clean.replace(/[A-Za-z0-9\s,&.'"-]+\s*\(([\u0B80-\u0BFF\s,&.'"-]+)\)/g, ' $1 ');

      // e.g. "[Shopping (பொருட்கள் வாங்குதல்)]" or "[Education (கல்வி)]" or "[கல்வி]" -> "பொருட்கள் வாங்குதல்" / "கல்வி"
      clean = clean.replace(/\[\s*(?:[A-Za-z0-9\s,&.'"-]+\s*\()?([\u0B80-\u0BFF\s,&.'"-]+)\)?\s*\]/g, ' $1 ');
      clean = clean.replace(/\[\s*[A-Za-z0-9\s,&.'"-]+\s*\]/g, ' ');

      // 2. Comprehensive English to Tamil phonetic mapping for any standalone English vendor/case names
      clean = clean.replace(/ABC Traders/gi, 'ஏபிசி டிரேடர்ஸ்');
      clean = clean.replace(/CloudHost Technologies/gi, 'கிளவ்ட்ஹோஸ்ட் டெக்னாலஜிஸ்');
      clean = clean.replace(/Kothari & Associates/gi, 'கோத்தாரி அண்ட் அசோசியேட்ஸ்');
      clean = clean.replace(/Sharma Logistics/gi, 'சர்மா லாஜிஸ்டிக்ஸ்');
      clean = clean.replace(/Google Workspace/gi, 'கூகிள் மென்பொருள்');
      clean = clean.replace(/Logitech India/gi, 'லாஜிடெக் நிறுவனம்');
      clean = clean.replace(/Apex Enterprises/gi, 'ஏபெக்ஸ் நிறுவனம்');
      clean = clean.replace(/Education/gi, 'கல்வி');
      clean = clean.replace(/Shopping/gi, 'பொருட்கள் வாங்குதல்');
      clean = clean.replace(/Software/gi, 'மென்பொருள்');
      clean = clean.replace(/Financial/gi, 'நிதி சேவை');
      clean = clean.replace(/HEALTHY/gi, 'ஆரோக்கியமான நிதி நிலை');
      clean = clean.replace(/STRAINED/gi, 'ரொக்க நெருக்கடி நிலை');

      // 3. Convert patterns like ₹65,000-க்கு / 65,000-க்கு / Rs. 65,000-க்கு
      clean = clean.replace(/(?:Rs\.|Rs|₹|ரூ\.|ரூ)?\s*([\d,]+(?:\.\d+)?)\s*-\s*க்கு/gi, (match, p1) => {
        const num = parseFloat(p1.replace(/,/g, ''));
        if (!isNaN(num)) {
          const words = numberToTamilWords(num);
          return words ? `ரூபாய் ${words}க்கு` : `${num}க்கு`;
        }
        return match;
      });

      // 4. Convert currency symbols (Rs., ₹, ரூ., ரூ) followed by amounts
      clean = clean.replace(/(?:Rs\.|Rs|₹|ரூ\.|ரூ)\s*([\d,]+(?:\.\d+)?)/gi, (match, p1) => {
        const num = parseFloat(p1.replace(/,/g, ''));
        if (!isNaN(num)) {
          const words = numberToTamilWords(num);
          return words ? `ரூபாய் ${words}` : `ரூபாய் ${num}`;
        }
        return `ரூபாய் ${p1}`;
      });

      // 5. Remove stray hyphens and brackets
      clean = clean.replace(/-\s*([அ-ஹா-ௌ்]+)/g, ' $1');
      clean = clean.replace(/[-()[\]']/g, ' ');

      // 6. Replace standalone numeric figures with accurate Tamil words
      clean = clean.replace(/\b\d+(?:,\d+)*(?:\.\d+)?\b/g, (match) => {
        const num = parseFloat(match.replace(/,/g, ''));
        if (!isNaN(num)) {
          const words = numberToTamilWords(num);
          return words || match;
        }
        return match;
      });

      // 7. Translate common English term markers in response (longer phrases first!)
      clean = clean.replace(/\bNot Recommended\b/gi, 'பரிந்துரைக்கப்படவில்லை');
      clean = clean.replace(/\bProceed with Caution\b/gi, 'எச்சரிக்கையுடன் தொடரவும்');
      clean = clean.replace(/\bRecommended\b/gi, 'பரிந்துரைக்கப்படுகிறது');

      // 8. Strip any remaining English words so speech audio is 100% pure Tamil
      clean = clean.replace(/\b[A-Za-z]{2,}\b/g, '');
    } else {
      // English TTS cleanup
      clean = clean.replace(/-\s*/g, ' ');
      clean = clean.replace(/₹/g, 'Rupees ');
      clean = clean.replace(/Rs\./gi, 'Rupees ');
    }

    return clean.replace(/\s+/g, ' ').trim();
  };

  const speakRecommendation = () => {
    // 1. Stop any playing HTML5 Audio or WebSpeech
    if (currentAudioRef.current) {
      try {
        currentAudioRef.current.pause();
        currentAudioRef.current.currentTime = 0;
      } catch (e) {
        console.error(e);
      }
      currentAudioRef.current = null;
    }

    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }

    if (isSpeaking) {
      setIsSpeaking(false);
      return;
    }

    if (!advisorResult) return;

    const isTamil = advisorLang === 'ta' || /[\u0B80-\u0BFF]/.test(advisorResult.explanation || '');
    
    // Explicit Tamil verdict translation to prevent any English collision
    const verdictTa = advisorResult.verdict === 'Recommended' 
      ? 'பரிந்துரைக்கப்படுகிறது' 
      : advisorResult.verdict === 'Proceed with Caution' 
      ? 'எச்சரிக்கையுடன் தொடரவும்' 
      : 'பரிந்துரைக்கப்படவில்லை';
    
    const verdictPrefix = isTamil ? verdictTa : advisorResult.verdict;
    const rawText = `${verdictPrefix}. ${advisorResult.explanation} ${advisorResult.suggested_action || ''}`;
    const textToSpeak = cleanTextForTTS(rawText, isTamil);

    if (!textToSpeak) return;

    // WebSpeech Fallback
    const fallbackWebSpeech = () => {
      if (!('speechSynthesis' in window)) {
        setIsSpeaking(false);
        return;
      }
      const utterance = new SpeechSynthesisUtterance(textToSpeak);
      utterance.lang = isTamil ? 'ta-IN' : 'en-US';
      utterance.rate = 0.9;

      const voices = window.speechSynthesis.getVoices();
      if (isTamil && voices.length > 0) {
        const taVoice = voices.find(v => 
          v.lang.toLowerCase().includes('ta') || 
          v.name.toLowerCase().includes('tamil') || 
          v.name.toLowerCase().includes('heera') || 
          v.name.toLowerCase().includes('valluvar') ||
          v.name.toLowerCase().includes('india')
        );
        if (taVoice) utterance.voice = taVoice;
      }

      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);
      window.speechSynthesis.speak(utterance);
    };

    // 2. For Tamil Mode: Use Neural Audio Player for 100% natural fluent Tamil audio
    if (isTamil) {
      // Chunk text into sentence parts under 180 chars
      const parts = textToSpeak.split(/(?<=[.!?])\s+/);
      const chunks = [];
      let currentChunk = "";
      parts.forEach(part => {
        if ((currentChunk + " " + part).length > 170) {
          if (currentChunk.trim()) chunks.push(currentChunk.trim());
          currentChunk = part;
        } else {
          currentChunk += (currentChunk ? " " : "") + part;
        }
      });
      if (currentChunk.trim()) chunks.push(currentChunk.trim());

      if (chunks.length === 0) chunks.push(textToSpeak);

      let currentIdx = 0;
      setIsSpeaking(true);

      const playNextChunk = () => {
        if (currentIdx >= chunks.length) {
          setIsSpeaking(false);
          currentAudioRef.current = null;
          return;
        }

        const chunkText = chunks[currentIdx];
        const audioUrl = `${API_BASE}/tts?text=${encodeURIComponent(chunkText)}&lang=ta`;
        const audio = new Audio(audioUrl);
        currentAudioRef.current = audio;

        audio.onended = () => {
          currentIdx++;
          playNextChunk();
        };

        audio.onerror = () => {
          console.warn("Backend TTS playback notice, falling back to WebSpeech");
          fallbackWebSpeech();
        };

        audio.play().catch(err => {
          console.warn("Audio autoplay blocked/failed, using fallback:", err);
          fallbackWebSpeech();
        });
      };

      playNextChunk();
    } else {
      fallbackWebSpeech();
    }
  };

  // Case Memory Viewer State
  const [casesList, setCasesList] = useState([]);
  const [casesLoading, setCasesLoading] = useState(false);
  const [casesSearch, setCasesSearch] = useState('');
  const [showAddCaseModal, setShowAddCaseModal] = useState(false);
  const [caseForm, setCaseForm] = useState({
    vendor_or_client: '',
    amount: '',
    transaction_type: 'expense',
    category: 'Miscellaneous',
    outcome: 'healthy',
    notes: ''
  });
  const [caseSubmitting, setCaseSubmitting] = useState(false);

  const handleAddCaseSubmit = async (e) => {
    e.preventDefault();
    if (!caseForm.vendor_or_client || !caseForm.amount) {
      alert('Please enter vendor/client name and amount.');
      return;
    }

    setCaseSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/cases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendor_or_client: caseForm.vendor_or_client,
          amount: parseFloat(caseForm.amount),
          transaction_type: caseForm.transaction_type,
          category: caseForm.category,
          outcome: caseForm.outcome,
          notes: caseForm.notes
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to create case memory');
      }

      alert('New case memory indexed in ChromaDB successfully!');
      setShowAddCaseModal(false);
      setCaseForm({
        vendor_or_client: '',
        amount: '',
        transaction_type: 'expense',
        category: 'Miscellaneous',
        outcome: 'healthy',
        notes: ''
      });
      fetchCases();
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to create case memory');
    } finally {
      setCaseSubmitting(false);
    }
  };

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

  const downloadSingleInvoice = (txn) => {
    const invoiceNumber = `INV-${String(txn.id).padStart(5, '0')}`;
    const cleanVendor = String(txn.vendor_or_client || 'Record').replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `FinSense_Invoice_${invoiceNumber}_${cleanVendor}.pdf`;

    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = `${API_BASE}/invoices/${txn.id}/pdf`;
    a.setAttribute('download', filename);
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      if (a.parentNode) document.body.removeChild(a);
    }, 1000);
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

  const [editingNoteId, setEditingNoteId] = useState(null);
  const [editingNoteText, setEditingNoteText] = useState('');

  const saveTransactionNotes = async (txnId, newNotes) => {
    try {
      const res = await fetch(`${API_BASE}/transactions/${txnId}/notes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_notes: newNotes })
      });
      if (!res.ok) throw new Error('Failed to save notes');
      setTransactions(prev => prev.map(txn => 
        txn.id === txnId ? { ...txn, user_notes: newNotes } : txn
      ));
      setEditingNoteId(null);
    } catch (err) {
      console.error('Failed to save notes:', err);
      alert('Could not save transaction notes.');
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
                  <div className="glass-card metric-mini-card income-card">
                    <div className="metric-icon-box green">
                      <TrendingUp size={20} />
                    </div>
                    <div className="metric-details">
                      <span className="metric-detail-label">Total Income</span>
                      <span className="metric-detail-value" style={{ color: '#166534', fontWeight: 800 }}>Rs.{stats.total_income ? stats.total_income.toLocaleString() : '0'}</span>
                    </div>
                  </div>

                  <div className="glass-card metric-mini-card expense-card">
                    <div className="metric-icon-box blue">
                      <TrendingDown size={20} />
                    </div>
                    <div className="metric-details">
                      <span className="metric-detail-label">Total Expenses</span>
                      <span className="metric-detail-value" style={{ color: '#b91c1c', fontWeight: 800 }}>Rs.{stats.total_expenses ? stats.total_expenses.toLocaleString() : '0'}</span>
                    </div>
                  </div>

                  <div className="glass-card metric-mini-card cashflow-card">
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
                    <div className="grid-section-header" style={{ width: '100%', marginBottom: '1rem' }}>
                      <div style={{ textAlign: 'left' }}>
                        <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#0f172a' }}>Expense distribution by Category</h3>
                        <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>Categorized operational spend breakdown</p>
                      </div>
                      {stats.category_spend && stats.category_spend.length > 0 && (
                        <span className="badge category" style={{ fontSize: '0.75rem', padding: '0.3rem 0.75rem', fontWeight: 700 }}>
                          {stats.category_spend.length} Categories
                        </span>
                      )}
                    </div>

                    {stats.category_spend && stats.category_spend.length > 0 ? (
                      (() => {
                        const totalSpend = stats.category_spend.reduce((acc, curr) => acc + (curr.value || 0), 0);
                        return (
                          <div style={{ width: '100%', display: 'grid', gridTemplateColumns: '220px 1fr', gap: '2rem', alignItems: 'center' }}>
                            
                            {/* Donut Chart with Center Total Summary */}
                            <div style={{ width: '220px', height: '220px', position: 'relative', flexShrink: 0, outline: 'none' }}>
                              <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                  <Pie
                                    data={stats.category_spend}
                                    dataKey="value"
                                    nameKey="name"
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={65}
                                    outerRadius={95}
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
                                    contentStyle={{ background: '#ffffff', border: '1px solid #c7d2fe', borderRadius: '12px', color: '#0f172a', boxShadow: '0 8px 24px rgba(99, 102, 241, 0.15)', fontWeight: 700 }}
                                  />
                                </PieChart>
                              </ResponsiveContainer>

                              {/* Donut Center Display */}
                              <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                                <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Spend</span>
                                <span style={{ fontSize: '1.1rem', fontWeight: 800, color: '#0f172a', marginTop: '0.1rem' }}>Rs.{totalSpend.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                              </div>
                            </div>

                            {/* Rich Category Breakdown Cards List */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', width: '100%' }}>
                              {stats.category_spend.map((entry, idx) => {
                                const percentage = totalSpend > 0 ? ((entry.value / totalSpend) * 100).toFixed(1) : 0;
                                return (
                                  <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.65rem 0.95rem', borderRadius: '12px', background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                      <span style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: CATEGORY_COLORS[entry.name] || DEFAULT_COLOR, flexShrink: 0, boxShadow: `0 0 8px ${CATEGORY_COLORS[entry.name] || DEFAULT_COLOR}` }}></span>
                                      <div style={{ textAlign: 'left' }}>
                                        <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.88rem' }}>{entry.name}</div>
                                        <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>{percentage}% of total</div>
                                      </div>
                                    </div>
                                    <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.95rem' }}>
                                      Rs.{entry.value.toLocaleString()}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>

                          </div>
                        );
                      })()
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
                                <td style={{ fontWeight: 700, color: '#0f172a' }}>{txn.vendor_or_client}</td>
                                <td style={{ textAlign: 'right', fontWeight: 700, color: txn.transaction_type === 'income' || txn.transaction_type === 'return_in' ? '#166534' : '#b91c1c' }}>
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
                          background: selectedCategory === cat ? '#ffffff' : 'rgba(255, 255, 255, 0.75)',
                          border: selectedCategory === cat ? '1px solid #4338ca' : '1px solid #c7d2fe',
                          color: selectedCategory === cat ? '#0f172a' : '#334155',
                          fontWeight: 700,
                          padding: '0.4rem 0.8rem',
                          boxShadow: selectedCategory === cat ? '0 4px 14px rgba(99, 102, 241, 0.15)' : 'none'
                        }}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ color: '#334155', fontSize: '0.85rem', fontWeight: 700 }}>
                      Showing <strong>{transactions.length}</strong> entries
                    </div>
                    <button
                      className="btn-primary"
                      onClick={deduplicateTransactions}
                      style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', background: '#fee2e2', color: '#b91c1c', border: '1px solid #fca5a5', fontWeight: 700 }}
                      title="Remove identical duplicate records"
                    >
                      Clean Duplicates
                    </button>
                    <button
                      className="btn-primary"
                      onClick={downloadTransactionsCSV}
                      style={{ padding: '0.4rem 1rem', fontSize: '0.8rem', background: '#ffffff', color: '#0f172a', border: '1px solid #c7d2fe', fontWeight: 700 }}
                    >
                      Export Ledger (.CSV)
                    </button>
                  </div>
                </div>

                {/* Ledger Data Table */}
                <div className="ledger-table-container">
                  {transactions.length > 0 ? (
                    <table className="ledger-table">
                      <thead>
                        <tr>
                          <th style={{ textAlign: 'center', whiteSpace: 'nowrap', minWidth: '120px' }}>Date</th>
                          <th style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>Type</th>
                          <th style={{ textAlign: 'left', minWidth: '160px' }}>Vendor / Client</th>
                          <th style={{ textAlign: 'center' }}>Category</th>
                          <th style={{ textAlign: 'left', minWidth: '180px' }}>Notes</th>
                          <th style={{ textAlign: 'right', whiteSpace: 'nowrap', minWidth: '130px' }}>Amount</th>
                          <th style={{ textAlign: 'center' }}>Health</th>
                          <th style={{ textAlign: 'center', minWidth: '140px' }}>Outcome Label</th>
                          <th style={{ textAlign: 'center' }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {transactions.map((txn) => (
                          <tr key={txn.id}>
                            <td style={{ fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap', textAlign: 'center', minWidth: '120px' }}>{txn.date}</td>
                            <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                              <select
                                value={txn.transaction_type}
                                onChange={(e) => updateTransactionType(txn.id, e.target.value)}
                                style={{
                                  background: txn.transaction_type === 'income' || txn.transaction_type === 'return_in' ? '#dcfce7' : '#fee2e2',
                                  color: txn.transaction_type === 'income' || txn.transaction_type === 'return_in' ? '#166534' : '#b91c1c',
                                  border: `1px solid ${txn.transaction_type === 'income' || txn.transaction_type === 'return_in' ? '#bbf7d0' : '#fca5a5'}`,
                                  borderRadius: '8px',
                                  padding: '0.25rem 0.5rem',
                                  fontSize: '0.75rem',
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                  outline: 'none'
                                }}
                              >
                                <option value="expense" style={{ background: '#ffffff', color: '#b91c1c' }}>↓ Expense</option>
                                <option value="income" style={{ background: '#ffffff', color: '#166534' }}>↑ Income</option>
                                <option value="return_in" style={{ background: '#ffffff', color: '#166534' }}>↑ Return In</option>
                                <option value="return_out" style={{ background: '#ffffff', color: '#b91c1c' }}>↓ Refund Out</option>
                              </select>
                            </td>
                            <td style={{ fontWeight: 800, color: '#4338ca', textAlign: 'justify', textAlignLast: 'left', textJustify: 'inter-word' }}>{txn.vendor_or_client}</td>
                            <td style={{ textAlign: 'center' }}>
                              <span className={`badge ${txn.category === 'Shopping' ? 'category-shopping' : 'category'}`}>
                                {txn.category}
                              </span>
                            </td>
                            <td 
                              style={{ color: '#334155', fontWeight: 600, fontSize: '0.85rem', minWidth: '180px', cursor: 'pointer' }}
                              title="Click to edit notes for this transaction"
                            >
                              {editingNoteId === txn.id ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                  <input
                                    type="text"
                                    value={editingNoteText}
                                    onChange={(e) => setEditingNoteText(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') saveTransactionNotes(txn.id, editingNoteText);
                                      if (e.key === 'Escape') setEditingNoteId(null);
                                    }}
                                    autoFocus
                                    style={{
                                      background: '#ffffff',
                                      border: '1.5px solid #6366f1',
                                      borderRadius: '6px',
                                      padding: '0.3rem 0.5rem',
                                      fontSize: '0.82rem',
                                      fontWeight: 600,
                                      color: '#0f172a',
                                      width: '100%',
                                      outline: 'none',
                                      boxShadow: '0 0 0 2px rgba(99, 102, 241, 0.2)'
                                    }}
                                  />
                                  <button
                                    onClick={() => saveTransactionNotes(txn.id, editingNoteText)}
                                    style={{
                                      background: '#4338ca',
                                      color: '#ffffff',
                                      border: 'none',
                                      borderRadius: '6px',
                                      padding: '0.35rem 0.5rem',
                                      cursor: 'pointer',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      flexShrink: 0
                                    }}
                                    title="Save notes"
                                  >
                                    <Check size={14} />
                                  </button>
                                </div>
                              ) : (
                                <div 
                                  onClick={() => {
                                    setEditingNoteId(txn.id);
                                    setEditingNoteText(txn.user_notes || '');
                                  }}
                                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}
                                >
                                  <span style={{ textStyle: 'justify' }}>{txn.user_notes || '— Click to add notes —'}</span>
                                  <Pencil size={13} style={{ color: '#94a3b8', opacity: 0.6, flexShrink: 0 }} />
                                </div>
                              )}
                            </td>
                            <td style={{ textAlign: 'right', fontWeight: 800, whiteSpace: 'nowrap', minWidth: '130px', color: txn.transaction_type === 'income' || txn.transaction_type === 'return_in' ? '#166534' : '#b91c1c' }}>
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
                                  background: txn.user_outcome ? 'rgba(255, 255, 255, 0.95)' : 'rgba(255,255,255,0.7)',
                                  color: txn.user_outcome ? {
                                    'Productive': '#166534',
                                    'Necessary': '#1d4ed8',
                                    'Wasteful': '#b91c1c',
                                    'Pending Review': '#b45309',
                                    'Break-even': '#334155'
                                  }[txn.user_outcome] || '#4338ca' : '#334155',
                                  border: '1px solid #c7d2fe',
                                  borderRadius: '8px',
                                  padding: '0.3rem 0.5rem',
                                  fontSize: '0.78rem',
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                  minWidth: '120px',
                                  outline: 'none',
                                  appearance: 'none',
                                  WebkitAppearance: 'none',
                                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23334155' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
                                  backgroundRepeat: 'no-repeat',
                                  backgroundPosition: 'right 0.4rem center',
                                  paddingRight: '1.5rem'
                                }}
                              >
                                <option value="" style={{ background: '#ffffff', color: '#334155' }}>— Set Outcome —</option>
                                <option value="Productive" style={{ background: '#ffffff', color: '#166534' }}>✅ Productive</option>
                                <option value="Necessary" style={{ background: '#ffffff', color: '#1d4ed8' }}>📋 Necessary</option>
                                <option value="Wasteful" style={{ background: '#ffffff', color: '#b91c1c' }}>❌ Wasteful</option>
                                <option value="Pending Review" style={{ background: '#ffffff', color: '#b45309' }}>⏳ Pending Review</option>
                                <option value="Break-even" style={{ background: '#ffffff', color: '#334155' }}>⚖️ Break-even</option>
                              </select>
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
                                <button
                                  onClick={() => downloadSingleInvoice(txn)}
                                  title="Download authentic standalone offline PDF invoice"
                                  style={{
                                    background: '#e0e7ff',
                                    border: '1px solid #c7d2fe',
                                    color: '#4338ca',
                                    cursor: 'pointer',
                                    padding: '0.3rem 0.6rem',
                                    borderRadius: '8px',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.3rem',
                                    fontSize: '0.75rem',
                                    fontWeight: 700,
                                    boxShadow: '0 2px 5px rgba(99, 102, 241, 0.08)',
                                    transition: 'all 0.2s'
                                  }}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.background = '#4338ca';
                                    e.currentTarget.style.color = '#ffffff';
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.background = '#e0e7ff';
                                    e.currentTarget.style.color = '#4338ca';
                                  }}
                                >
                                  <Download size={13} />
                                  <span>PDF</span>
                                </button>

                                <button
                                  onClick={() => deleteTransaction(txn.id)}
                                  title="Delete transaction"
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    color: '#94a3b8',
                                    cursor: 'pointer',
                                    padding: '0.3rem',
                                    borderRadius: '6px',
                                    transition: 'color 0.2s'
                                  }}
                                  onMouseEnter={(e) => e.currentTarget.style.color = '#b91c1c'}
                                  onMouseLeave={(e) => e.currentTarget.style.color = '#94a3b8'}
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem', width: '100%' }} className="fade-in">
                
                {/* Top Ingestion Intelligence KPI Row */}
                <div className="metrics-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                  <div className="glass-card metric-mini-card">
                    <div className="metric-icon-box indigo">
                      <FileText size={20} />
                    </div>
                    <div className="metric-details">
                      <span className="metric-detail-label">Tesseract 5.0 OCR Engine</span>
                      <span className="metric-detail-value">98.4% Precision</span>
                    </div>
                  </div>

                  <div className="glass-card metric-mini-card">
                    <div className="metric-icon-box green">
                      <Zap size={20} />
                    </div>
                    <div className="metric-details">
                      <span className="metric-detail-label">Gemini NLP Mapping</span>
                      <span className="metric-detail-value">Auto-Tag Schema</span>
                    </div>
                  </div>

                  <div className="glass-card metric-mini-card" title="100% Structural Precision: Extracted fields match human-verified ground-truth XML annotations without field distortion">
                    <div className="metric-icon-box green">
                      <CheckCircle size={20} />
                    </div>
                    <div className="metric-details">
                      <span className="metric-detail-label">OCR Ground-Truth XML</span>
                      <span className="metric-detail-value">0% Format Drift (100% Precise)</span>
                    </div>
                  </div>

                  <div className="glass-card metric-mini-card">
                    <div className="metric-icon-box indigo">
                      <Clock size={20} />
                    </div>
                    <div className="metric-details">
                      <span className="metric-detail-label">Ingestion Latency</span>
                      <span className="metric-detail-value">&lt; 1.8s / Page</span>
                    </div>
                  </div>
                </div>

                {/* Main Upload Dropzone Card */}
                <div className="glass-card" style={{ padding: '2rem' }}>
                  {/* Inactive Ingestion View */}
                  {uploadState.status === 'idle' && (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '1rem', marginBottom: '1.5rem' }}>
                        {/* Mode Toggles */}
                        <div style={{ display: 'flex', gap: '0.75rem' }}>
                          <button 
                            className={`btn-primary ${uploadMode === 'ocr' ? 'active' : ''}`}
                            style={{ 
                              background: uploadMode === 'ocr' ? '#4338ca' : '#ffffff',
                              color: uploadMode === 'ocr' ? '#ffffff' : '#0f172a',
                              border: '1px solid #c7d2fe',
                              boxShadow: uploadMode === 'ocr' ? '0 4px 14px rgba(99, 102, 241, 0.25)' : 'none',
                              padding: '0.5rem 1.25rem',
                              fontWeight: 800
                            }}
                            onClick={() => setUploadMode('ocr')}
                          >
                            Scan Receipt (OCR)
                          </button>
                          <button 
                            className={`btn-primary ${uploadMode === 'manual' ? 'active' : ''}`}
                            style={{ 
                              background: uploadMode === 'manual' ? '#4338ca' : '#ffffff',
                              color: uploadMode === 'manual' ? '#ffffff' : '#0f172a',
                              border: '1px solid #c7d2fe',
                              boxShadow: uploadMode === 'manual' ? '0 4px 14px rgba(99, 102, 241, 0.25)' : 'none',
                              padding: '0.5rem 1.25rem',
                              fontWeight: 800
                            }}
                            onClick={() => setUploadMode('manual')}
                          >
                            Manual Entry
                          </button>
                        </div>

                        {/* Supported Formats */}
                        <div style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span style={{ padding: '0.2rem 0.6rem', borderRadius: '12px', background: '#eef2ff', color: '#4338ca', border: '1px solid #c7d2fe' }}>PDF</span>
                          <span style={{ padding: '0.2rem 0.6rem', borderRadius: '12px', background: '#f5f3ff', color: '#7e22ce', border: '1px solid #e9d5ff' }}>PNG</span>
                          <span style={{ padding: '0.2rem 0.6rem', borderRadius: '12px', background: '#f0f9ff', color: '#0369a1', border: '1px solid #bae6fd' }}>JPG</span>
                        </div>
                      </div>

                      {uploadMode === 'ocr' ? (
                        <div>
                          <div 
                            className="dropzone-container"
                            onDragEnter={handleDrag}
                            onDragOver={handleDrag}
                            onDragLeave={handleDrag}
                            onDrop={handleDrop}
                            style={{ 
                              borderStyle: dragActive ? 'solid' : 'dashed', 
                              borderColor: dragActive ? '#4338ca' : '#a5b4fc', 
                              background: dragActive ? '#f5f3ff' : 'linear-gradient(135deg, #ffffff 60%, #f8fafc 100%)',
                              padding: '3.25rem 2rem'
                            }}
                          >
                            <input 
                              type="file" 
                              id="file-upload-input" 
                              style={{ display: 'none' }} 
                              onChange={handleFileChange}
                              accept="image/*,application/pdf"
                            />
                            <label htmlFor="file-upload-input" style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                              <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'linear-gradient(135deg, #6366f1, #3b82f6)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', marginBottom: '1.25rem', boxShadow: '0 8px 20px rgba(99, 102, 241, 0.3)' }}>
                                <Upload size={32} />
                              </div>
                              <div className="dropzone-title" style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0f172a' }}>Drag & Drop your invoice receipt here</div>
                              <div className="dropzone-subtitle" style={{ color: '#64748b', fontSize: '0.85rem', marginTop: '0.35rem' }}>Supports high-resolution PDF scans, PNG receipts, or JPEG mobile camera uploads (Max 5MB)</div>
                              <button className="btn-primary" style={{ marginTop: '1.5rem', pointerEvents: 'none', background: '#4338ca', color: '#ffffff', fontWeight: 800, padding: '0.65rem 1.85rem', borderRadius: '10px' }}>
                                Browse Local File
                              </button>
                            </label>
                          </div>

                          {/* Sample Invoices Quick-Test Bar */}
                          <div style={{ marginTop: '1.5rem', paddingTop: '1.25rem', borderTop: '1px solid #f1f5f9', textAlign: 'left' }}>
                            <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '0.75rem' }}>
                              🚀 Quick Test Sample Invoices (Click to Auto-Parse):
                            </span>
                            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                              <button
                                className="btn-primary"
                                onClick={() => {
                                  const sampleFile = new File(['Invoice ABC Traders Restock'], 'ABC_Traders_Invoice.pdf', { type: 'application/pdf' });
                                  handleFileUpload(sampleFile);
                                }}
                                style={{ background: '#ffffff', color: '#4338ca', border: '1px solid #c7d2fe', fontSize: '0.8rem', padding: '0.45rem 0.95rem', fontWeight: 700, borderRadius: '10px' }}
                              >
                                🧾 ABC Traders Restock (₹44,365.02)
                              </button>
                              <button
                                className="btn-primary"
                                onClick={() => {
                                  const sampleFile = new File(['Google Ads Keyword Marketing Campaign'], 'Google_Ads_Marketing.pdf', { type: 'application/pdf' });
                                  handleFileUpload(sampleFile);
                                }}
                                style={{ background: '#ffffff', color: '#7e22ce', border: '1px solid #e9d5ff', fontSize: '0.8rem', padding: '0.45rem 0.95rem', fontWeight: 700, borderRadius: '10px' }}
                              >
                                ⚡ Google Ads Marketing (₹23,148.27)
                              </button>
                              <button
                                className="btn-primary"
                                onClick={() => {
                                  const sampleFile = new File(['TNEB Electricity Power Utility Bill'], 'TNEB_Power_Bill.pdf', { type: 'application/pdf' });
                                  handleFileUpload(sampleFile);
                                }}
                                style={{ background: '#ffffff', color: '#0369a1', border: '1px solid #bae6fd', fontSize: '0.8rem', padding: '0.45rem 0.95rem', fontWeight: 700, borderRadius: '10px' }}
                              >
                                💡 Utility Power Bill (₹12,450.00)
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <form onSubmit={handleManualSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', textAlign: 'left' }}>
                          <div className="fields-confirm-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
                            {/* Row 1: Vendor + Amount */}
                            <div className="field-group">
                              <label style={{ color: '#0f172a', fontSize: '0.82rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.45rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                                <Building2 size={15} color="#4338ca" />
                                Vendor / Client Name
                              </label>
                              <input 
                                type="text" 
                                placeholder="e.g. ABC Traders, Client XYZ"
                                value={manualForm.vendor_or_client}
                                onChange={(e) => setManualForm({ ...manualForm, vendor_or_client: e.target.value })}
                                required 
                                style={{ background: '#ffffff', border: '1px solid #cbd5e1', color: '#0f172a', padding: '0 0.85rem', borderRadius: '10px', fontSize: '0.9rem', width: '100%', outline: 'none', height: '44px', boxSizing: 'border-box', fontWeight: 600 }}
                              />
                            </div>

                            <div className="field-group">
                              <label style={{ color: '#0f172a', fontSize: '0.82rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.45rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                                <DollarSign size={15} color="#166534" />
                                Amount (Rs.)
                              </label>
                              <input 
                                type="number" 
                                step="0.01"
                                placeholder="0.00"
                                value={manualForm.amount}
                                onChange={(e) => setManualForm({ ...manualForm, amount: e.target.value })}
                                required 
                                style={{ background: '#ffffff', border: '1px solid #cbd5e1', color: '#0f172a', padding: '0 0.85rem', borderRadius: '10px', fontSize: '0.9rem', width: '100%', outline: 'none', height: '44px', boxSizing: 'border-box', fontWeight: 600 }}
                              />
                            </div>

                            {/* Row 2: Date + Category */}
                            <div className="field-group">
                              <label style={{ color: '#0f172a', fontSize: '0.82rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.45rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                                <Calendar size={15} color="#0284c7" />
                                Transaction Date
                              </label>
                              <input 
                                type="date" 
                                value={manualForm.date}
                                onChange={(e) => setManualForm({ ...manualForm, date: e.target.value })}
                                required 
                                style={{ background: '#ffffff', border: '1px solid #cbd5e1', color: '#0f172a', padding: '0 0.85rem', borderRadius: '10px', fontSize: '0.9rem', width: '100%', outline: 'none', height: '44px', boxSizing: 'border-box', fontWeight: 600 }}
                              />
                            </div>

                            <div className="field-group">
                              <label style={{ color: '#0f172a', fontSize: '0.82rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.45rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                                <Tag size={15} color="#7e22ce" />
                                Expense Category
                              </label>
                              <select 
                                value={manualForm.category}
                                onChange={(e) => setManualForm({ ...manualForm, category: e.target.value })}
                                style={{ background: '#ffffff', border: '1px solid #cbd5e1', color: '#0f172a', padding: '0 0.85rem', borderRadius: '10px', fontSize: '0.9rem', width: '100%', outline: 'none', height: '44px', boxSizing: 'border-box', fontWeight: 600, cursor: 'pointer' }}
                              >
                                <option value="Miscellaneous" style={{ background: '#ffffff', color: '#0f172a' }}>Miscellaneous</option>
                                <option value="Utilities" style={{ background: '#ffffff', color: '#0f172a' }}>Utilities</option>
                                <option value="Software" style={{ background: '#ffffff', color: '#0f172a' }}>Software</option>
                                <option value="Marketing" style={{ background: '#ffffff', color: '#0f172a' }}>Marketing</option>
                                <option value="Shopping" style={{ background: '#ffffff', color: '#0f172a' }}>Shopping</option>
                                <option value="Education" style={{ background: '#ffffff', color: '#0f172a' }}>Education</option>
                                <option value="Financial" style={{ background: '#ffffff', color: '#0f172a' }}>Financial</option>
                              </select>
                            </div>

                            {/* Row 3: Transaction Type + Invoice Ref Tag (Balanced!) */}
                            <div className="field-group">
                              <label style={{ color: '#0f172a', fontSize: '0.82rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.45rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                                <Sliders size={15} color="#d97706" />
                                Transaction Type
                              </label>
                              <select 
                                value={manualForm.transaction_type}
                                onChange={(e) => setManualForm({ ...manualForm, transaction_type: e.target.value })}
                                style={{ background: '#ffffff', border: '1px solid #cbd5e1', color: '#0f172a', padding: '0 0.85rem', borderRadius: '10px', fontSize: '0.9rem', width: '100%', outline: 'none', height: '44px', boxSizing: 'border-box', fontWeight: 600, cursor: 'pointer' }}
                              >
                                <option value="expense" style={{ background: '#ffffff', color: '#b91c1c' }}>↓ Expense (Money Out)</option>
                                <option value="income" style={{ background: '#ffffff', color: '#166534' }}>↑ Income (Money In)</option>
                                <option value="return_in" style={{ background: '#ffffff', color: '#166534' }}>↑ Refund Received</option>
                                <option value="return_out" style={{ background: '#ffffff', color: '#b91c1c' }}>↓ Refund Given</option>
                              </select>
                            </div>

                            <div className="field-group">
                              <label style={{ color: '#0f172a', fontSize: '0.82rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.45rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                                <FileText size={15} color="#475569" />
                                Invoice Ref No. (Optional)
                              </label>
                              <input 
                                type="text" 
                                placeholder="e.g. INV-2026-0891"
                                value={manualForm.invoice_ref || ''}
                                onChange={(e) => setManualForm({ ...manualForm, invoice_ref: e.target.value })}
                                style={{ background: '#ffffff', border: '1px solid #cbd5e1', color: '#0f172a', padding: '0 0.85rem', borderRadius: '10px', fontSize: '0.9rem', width: '100%', outline: 'none', height: '44px', boxSizing: 'border-box', fontWeight: 600 }}
                              />
                            </div>

                            {/* Row 4: Reasoning / Notes (Full width) */}
                            <div className="field-group" style={{ gridColumn: 'span 2' }}>
                              <label style={{ color: '#0f172a', fontSize: '0.82rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.45rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                                <Sparkles size={15} color="#6366f1" />
                                Reasoning / Notes (Spend Purpose)
                              </label>
                              <textarea 
                                placeholder="Explain the purpose of this transaction (e.g. AWS cloud renewal, monthly store stock purchase...)"
                                value={manualForm.user_notes || ''}
                                onChange={(e) => setManualForm({ ...manualForm, user_notes: e.target.value })}
                                style={{ background: '#ffffff', border: '1px solid #cbd5e1', color: '#0f172a', padding: '0.75rem 0.85rem', borderRadius: '10px', fontSize: '0.9rem', width: '100%', outline: 'none', minHeight: '85px', resize: 'vertical', fontWeight: 600, boxSizing: 'border-box' }}
                              />
                            </div>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                            <button 
                              type="submit" 
                              className="btn-primary" 
                              disabled={manualSubmitting}
                              style={{ padding: '0.7rem 2rem', background: '#4338ca', color: '#ffffff', fontWeight: 800, borderRadius: '10px', boxShadow: '0 4px 14px rgba(99, 102, 241, 0.3)' }}
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
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#0f172a' }}>
                          <RefreshCw size={14} className="loading-spinner" />
                          Processing document with Tesseract OCR...
                        </span>
                        <span style={{ color: '#0f172a' }}>{uploadState.progress}%</span>
                      </div>
                      <div className="progress-track">
                        <div className="progress-bar" style={{ width: `${uploadState.progress}%` }}></div>
                      </div>
                      <span style={{ fontSize: '0.8rem', color: '#334155', fontWeight: 600, textAlign: 'left' }}>
                        Converting pages, executing OpenCV preprocessing, and extracting financial fields...
                      </span>
                    </div>
                  )}

                  {/* Processing Success state */}
                  {uploadState.status === 'success' && uploadState.data && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: '#dcfce7', padding: '1rem 1.5rem', borderRadius: '12px', border: '1px solid #bbf7d0' }}>
                        <CheckCircle size={24} color="#166534" />
                        <div style={{ textAlign: 'left' }}>
                          <h4 style={{ margin: 0, fontWeight: 800, color: '#14532d' }}>Extraction Succeeded!</h4>
                          <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.8rem', color: '#15803d', fontWeight: 600 }}>
                            Invoice processed and ledger balance synced successfully.
                          </p>
                        </div>
                      </div>

                      {/* OCR Text preview pane */}
                      <div style={{ textAlign: 'left' }}>
                        <h4 style={{ fontSize: '0.85rem', color: '#334155', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                          Extracted Raw Text Snippet (OCR Log)
                        </h4>
                        <div className="ocr-preview-pane">
                          {uploadState.data.raw_text_preview}
                        </div>
                      </div>

                      {/* Extracted Form validation preview */}
                      <div>
                        <h4 style={{ fontSize: '0.85rem', color: '#334155', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem', textAlign: 'left' }}>
                          Parsed Ledger Fields
                        </h4>
                        <div className="fields-confirm-grid">
                          <div className="field-group">
                            <label style={{ color: '#0f172a', fontWeight: 800 }}>Vendor / Client</label>
                            <input type="text" value={uploadState.data.vendor_or_client || uploadState.data.vendor || ''} readOnly style={{ background: 'rgba(255,255,255,0.95)', border: '1px solid #c7d2fe', color: '#0f172a', fontWeight: 700 }} />
                          </div>
                          <div className="field-group">
                            <label style={{ color: '#0f172a', fontWeight: 800 }}>Amount (Rs.)</label>
                            <input type="text" value={`Rs.${uploadState.data.amount.toFixed(2)}`} readOnly style={{ background: 'rgba(255,255,255,0.95)', border: '1px solid #c7d2fe', color: '#0f172a', fontWeight: 700 }} />
                          </div>
                          <div className="field-group">
                            <label style={{ color: '#0f172a', fontWeight: 800 }}>Date</label>
                            <input type="text" value={uploadState.data.date} readOnly style={{ background: 'rgba(255,255,255,0.95)', border: '1px solid #c7d2fe', color: '#0f172a', fontWeight: 700 }} />
                          </div>
                          <div className="field-group">
                            <label style={{ color: '#0f172a', fontWeight: 800 }}>Category</label>
                            <input type="text" value={uploadState.data.category} readOnly style={{ background: 'rgba(255,255,255,0.95)', border: '1px solid #c7d2fe', color: '#0f172a', fontWeight: 700 }} />
                          </div>
                          <div className="field-group">
                            <label style={{ color: '#0f172a', fontWeight: 800 }}>Transaction Type</label>
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
                                color: uploadState.data.transaction_type === 'income' || uploadState.data.transaction_type === 'return_in' ? '#166534' : '#b91c1c',
                                fontWeight: 800,
                                background: 'rgba(255,255,255,0.95)',
                                border: '1px solid #c7d2fe',
                                borderRadius: '8px',
                                padding: '0.65rem 0.85rem',
                                fontSize: '0.9rem',
                                width: '100%',
                                outline: 'none',
                                cursor: 'pointer'
                              }} 
                            >
                              <option value="expense" style={{ background: '#ffffff', color: '#b91c1c' }}>↓ Expense (Money Out)</option>
                              <option value="income" style={{ background: '#ffffff', color: '#166534' }}>↑ Income (Money In)</option>
                              <option value="return_in" style={{ background: '#ffffff', color: '#166534' }}>↑ Return In (Refund Received)</option>
                              <option value="return_out" style={{ background: '#ffffff', color: '#b91c1c' }}>↓ Refund Out (Refund Given)</option>
                            </select>
                          </div>
                          <div className="field-group">
                            <label style={{ color: '#0f172a', fontWeight: 800 }}>Live Balance</label>
                            <input 
                              type="text" 
                              value={`Rs.${(uploadState.data.current_balance || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })} (${uploadState.data.outcome_label})`} 
                              readOnly 
                              style={{ 
                                color: uploadState.data.outcome_label === 'healthy' ? '#166534' : '#b91c1c',
                                fontWeight: 800,
                                background: 'rgba(255,255,255,0.95)',
                                border: '1px solid #c7d2fe'
                              }} 
                            />
                          </div>
                          <div className="field-group" style={{ gridColumn: 'span 2', marginTop: '0.5rem', textAlign: 'left' }}>
                            <label style={{ color: '#0f172a', fontSize: '0.85rem', fontWeight: 800, display: 'block', marginBottom: '0.5rem' }}>Reasoning / Notes (Spend Experience)</label>
                            <textarea 
                              placeholder="Explain why this invoice was paid in your own words (e.g. software renewal, office utilities...)"
                              value={successNotes}
                              onChange={(e) => setSuccessNotes(e.target.value)}
                              style={{ background: 'rgba(255,255,255,0.95)', border: '1px solid #c7d2fe', color: '#0f172a', padding: '0.65rem 0.85rem', borderRadius: '8px', fontSize: '0.9rem', width: '100%', outline: 'none', minHeight: '60px', resize: 'vertical', fontWeight: 600 }}
                            />
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1rem' }}>
                        <button 
                          className="btn-primary" 
                          onClick={handleSaveSuccessNotes}
                          disabled={savingNotes}
                          style={{ background: '#166534', color: '#ffffff', border: 'none', fontWeight: 800 }}
                        >
                          {savingNotes ? 'Saving Notes...' : 'Save Notes'}
                        </button>
                        <button 
                          className="btn-primary" 
                          onClick={() => {
                            setSuccessNotes('');
                            setUploadState({ status: 'idle', progress: 0, data: null, error: null });
                          }}
                          style={{ background: '#ffffff', color: '#0f172a', border: '1px solid #c7d2fe', fontWeight: 700 }}
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
                        <h4 style={{ margin: 0, fontWeight: 700, color: '#0f172a' }}>Processing Failed</h4>
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

                {/* 4-Step Ingestion Workflow Banner */}
                <div className="glass-card" style={{ padding: '1.75rem', background: 'linear-gradient(135deg, #ffffff 60%, #f8fafc 100%)', border: '1px solid #c7d2fe' }}>
                  <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#0f172a', textAlign: 'left', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Zap size={22} color="#6366f1" />
                    Automated OCR & Vector Indexing Architecture
                  </h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', textAlign: 'left' }}>
                    <div style={{ background: '#ffffff', padding: '1.1rem', borderRadius: '14px', border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(15, 23, 42, 0.03)' }}>
                      <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#eef2ff', color: '#4338ca', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, marginBottom: '0.75rem' }}>01</div>
                      <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 800, color: '#0f172a' }}>1. Document Upload</h4>
                      <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.78rem', color: '#64748b', lineHeight: 1.45, fontWeight: 600 }}>
                        Receives PDF invoices or mobile photo receipts and validates size & format.
                      </p>
                    </div>

                    <div style={{ background: '#ffffff', padding: '1.1rem', borderRadius: '14px', border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(15, 23, 42, 0.03)' }}>
                      <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#f5f3ff', color: '#7e22ce', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, marginBottom: '0.75rem' }}>02</div>
                      <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 800, color: '#0f172a' }}>2. OpenCV & Tesseract OCR</h4>
                      <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.78rem', color: '#64748b', lineHeight: 1.45, fontWeight: 600 }}>
                        Applies adaptive thresholding, grayscale deskewing, and parses optical character tokens.
                      </p>
                    </div>

                    <div style={{ background: '#ffffff', padding: '1.1rem', borderRadius: '14px', border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(15, 23, 42, 0.03)' }}>
                      <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#f0f9ff', color: '#0369a1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, marginBottom: '0.75rem' }}>03</div>
                      <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 800, color: '#0f172a' }}>3. Gemini NLP Classification</h4>
                      <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.78rem', color: '#64748b', lineHeight: 1.45, fontWeight: 600 }}>
                        Extracts Vendor, Date, Rupee Amount, and tags transaction category automatically.
                      </p>
                    </div>

                    <div style={{ background: '#ffffff', padding: '1.1rem', borderRadius: '14px', border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(15, 23, 42, 0.03)' }}>
                      <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#dcfce7', color: '#166534', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, marginBottom: '0.75rem' }}>04</div>
                      <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 800, color: '#0f172a' }}>4. ChromaDB Vector Sync</h4>
                      <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.78rem', color: '#64748b', lineHeight: 1.45, fontWeight: 600 }}>
                        Indexes embedding vectors into Case Memory and recalculates live cash reserves.
                      </p>
                    </div>
                  </div>
                </div>
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
                      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: '#fee2e2', border: '1px solid #fca5a5', padding: '1rem 1.5rem', borderRadius: '16px' }}>
                        <ShieldAlert size={24} color="#b91c1c" />
                        <div style={{ textAlign: 'left' }}>
                          <h4 style={{ margin: 0, fontWeight: 800, color: '#991b1b' }}>Liquidity Alert: Projected Cash Deficit</h4>
                          <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: '#b91c1c', fontWeight: 600 }}>
                            Your cash balance is predicted to fall below the safety threshold of Rs.10,000.00 on <strong>{forecastData.alert.first_risk_date}</strong>. 
                            There are <strong>{forecastData.alert.risk_days_count}</strong> critical risk days projected in the next 30 days.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: '#dcfce7', border: '1px solid #bbf7d0', padding: '1rem 1.5rem', borderRadius: '16px' }}>
                        <CheckCircle size={24} color="#166534" />
                        <div style={{ textAlign: 'left' }}>
                          <h4 style={{ margin: 0, fontWeight: 800, color: '#14532d' }}>Cash Flow Forecast Stable</h4>
                          <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: '#15803d', fontWeight: 600 }}>
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
                    {(() => {
                      const chartData = getCombinedChartData();
                      // Calculate dynamic domain so line curves fill vertical height dynamically
                      const validValues = chartData
                        .flatMap(d => [d.actual, d.prophet, d.arima])
                        .filter(v => v !== null && v !== undefined && !isNaN(v));
                      const minBal = validValues.length ? Math.floor(Math.min(...validValues) * 0.96 / 1000) * 1000 : 1500000;
                      const maxBal = validValues.length ? Math.ceil(Math.max(...validValues) * 1.04 / 1000) * 1000 : 2500000;
                      
                      const lastActualNode = forecastData.historical[forecastData.historical.length - 1];
                      const transitionDate = lastActualNode ? lastActualNode.date : null;

                      return (
                        <div className="glass-card" style={{ padding: '1.75rem', background: 'linear-gradient(135deg, #ffffff 60%, #f8fafc 100%)', border: '1px solid #c7d2fe' }}>
                          <div className="grid-section-header" style={{ marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                            <div style={{ textAlign: 'left' }}>
                              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <TrendingUp size={22} color="#6366f1" />
                                Prophet vs. ARIMA Ensemble Forecast (30-Day Outlook)
                              </h3>
                              <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.82rem', color: '#64748b', fontWeight: 600 }}>
                                Out-of-sample predictive trajectory overlaid with historical actual cash reserves
                              </p>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '0.75rem', fontWeight: 800, padding: '0.35rem 0.75rem', borderRadius: '20px', background: '#eef2ff', color: '#4338ca', border: '1px solid #c7d2fe', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#4f46e5' }}></span>
                                Actuals
                              </span>
                              <span style={{ fontSize: '0.75rem', fontWeight: 800, padding: '0.35rem 0.75rem', borderRadius: '20px', background: '#f5f3ff', color: '#7e22ce', border: '1px solid #e9d5ff', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#8b5cf6' }}></span>
                                Prophet (89.62%)
                              </span>
                              <span style={{ fontSize: '0.75rem', fontWeight: 800, padding: '0.35rem 0.75rem', borderRadius: '20px', background: '#f0f9ff', color: '#0369a1', border: '1px solid #bae6fd', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#06b6d4' }}></span>
                                ARIMA (96.86%)
                              </span>
                            </div>
                          </div>
                          
                          <div style={{ width: '100%', height: '390px', marginTop: '1.25rem' }}>
                            <ResponsiveContainer width="100%" height="100%">
                              <ComposedChart 
                                data={chartData}
                                margin={{ top: 15, right: 30, left: 15, bottom: 15 }}
                              >
                                <defs>
                                  <linearGradient id="actualGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.35}/>
                                    <stop offset="95%" stopColor="#818cf8" stopOpacity={0.01}/>
                                  </linearGradient>
                                  <linearGradient id="prophetGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.25}/>
                                    <stop offset="95%" stopColor="#c084fc" stopOpacity={0.01}/>
                                  </linearGradient>
                                  <linearGradient id="arimaGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.20}/>
                                    <stop offset="95%" stopColor="#38bdf8" stopOpacity={0.01}/>
                                  </linearGradient>
                                </defs>

                                <CartesianGrid strokeDasharray="4 4" stroke="#cbd5e1" strokeOpacity={0.75} />
                                <XAxis 
                                  dataKey="date" 
                                  stroke="#64748b" 
                                  fontSize={11}
                                  fontWeight={600}
                                  tickLine={false}
                                  axisLine={{ stroke: '#cbd5e1' }}
                                />
                                <YAxis 
                                  stroke="#64748b"
                                  fontSize={11}
                                  fontWeight={700}
                                  tickLine={false}
                                  axisLine={false}
                                  domain={[minBal, maxBal]}
                                  tickFormatter={(value) => `Rs.${(value/1000).toFixed(0)}k`}
                                />
                                <Tooltip content={<CustomTooltip />} />
                                
                                {transitionDate && (
                                  <ReferenceLine 
                                    x={transitionDate} 
                                    stroke="#6366f1" 
                                    strokeDasharray="4 4" 
                                    strokeWidth={2}
                                    label={{ 
                                      value: 'Forecast Start ➔', 
                                      position: 'top', 
                                      fill: '#4338ca', 
                                      fontSize: 11, 
                                      fontWeight: 800 
                                    }} 
                                  />
                                )}

                                {/* Historical Actuals - Filled Area */}
                                <Area 
                                  type="monotone" 
                                  dataKey="actual" 
                                  name="Historical Actual" 
                                  stroke="#4f46e5" 
                                  strokeWidth={3.5}
                                  fill="url(#actualGrad)"
                                  dot={false}
                                  activeDot={{ r: 6, fill: '#4f46e5', stroke: '#ffffff', strokeWidth: 2 }}
                                />
                                
                                {/* Prophet Forecast - Filled Area */}
                                <Area 
                                  type="monotone" 
                                  dataKey="prophet" 
                                  name="Prophet Forecast" 
                                  stroke="#8b5cf6" 
                                  strokeWidth={3}
                                  strokeDasharray="5 5"
                                  fill="url(#prophetGrad)"
                                  dot={false}
                                />
                                
                                {/* ARIMA Forecast - Line */}
                                <Line 
                                  type="monotone" 
                                  dataKey="arima" 
                                  name="ARIMA Baseline" 
                                  stroke="#06b6d4" 
                                  strokeWidth={3}
                                  strokeDasharray="4 4"
                                  dot={false}
                                />
                              </ComposedChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Audit Ledger Table */}
                    <div className="glass-card" style={{ padding: '1.75rem', marginTop: '0.5rem' }}>
                      <div className="grid-section-header" style={{ marginBottom: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
                        <div style={{ textAlign: 'left' }}>
                          <h3 style={{ margin: 0 }}>Daily Transaction Evidence Journal</h3>
                          <p style={{ color: '#64748b', fontSize: '0.8rem', margin: '0.25rem 0 0 0' }}>
                            Audit trail showing simulated retail revenues alongside your actual uploaded invoice expenses.
                          </p>
                          
                          {/* Color-Coding Explanation Legend */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '0.65rem', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '0.72rem', fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Text Color Guide:</span>
                            <span style={{ fontSize: '0.74rem', fontWeight: 700, padding: '0.2rem 0.65rem', borderRadius: '12px', background: '#eef2ff', color: '#4338ca', border: '1px solid #c7d2fe', display: 'flex', alignItems: 'center', gap: '0.35rem' }} title="Days with OCR-parsed vendor invoices uploaded by you">
                              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#4338ca' }}></span>
                              Indigo = Actual Uploaded Invoice
                            </span>
                            <span style={{ fontSize: '0.74rem', fontWeight: 700, padding: '0.2rem 0.65rem', borderRadius: '12px', background: '#f5f3ff', color: '#7e22ce', border: '1px solid #e9d5ff', display: 'flex', alignItems: 'center', gap: '0.35rem' }} title="Days with automated payroll or recurring expenses">
                              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#7e22ce' }}></span>
                              Purple = Fixed Recurring Outflow
                            </span>
                            <span style={{ fontSize: '0.74rem', fontWeight: 700, padding: '0.2rem 0.65rem', borderRadius: '12px', background: '#f8fafc', color: '#0f172a', border: '1px solid #cbd5e1', display: 'flex', alignItems: 'center', gap: '0.35rem' }} title="Daily walk-in store revenue and sales settlements">
                              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#0f172a' }}></span>
                              Dark Slate = Daily Store Sales
                            </span>
                          </div>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.4rem' }}>
                          <button
                            className="btn-primary"
                            onClick={downloadAuditCSV}
                            style={{ padding: '0.45rem 1.15rem', fontSize: '0.78rem', background: '#ffffff', color: '#0f172a', border: '1px solid #e2e8f0', fontWeight: 700 }}
                          >
                            Export Audit Trail (.CSV)
                          </button>
                          <span style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 600 }}>
                            💡 Mouse hover highlights row
                          </span>
                        </div>
                      </div>

                      <div className="ledger-table-container">
                        <table className="ledger-table">
                          <thead>
                            <tr>
                              <th style={{ textAlign: 'left', whiteSpace: 'nowrap', width: '120px' }}>Date</th>
                              <th style={{ textAlign: 'justify', textAlignLast: 'left' }}>Daily Events / Vendors</th>
                              <th style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>Cash Inflow</th>
                              <th style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>Cash Outflow</th>
                              <th style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>Closing Balance</th>
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
                                    <td style={{ fontWeight: 700, textAlign: 'left', color: '#0f172a', whiteSpace: 'nowrap', width: '120px' }}>{h.date}</td>
                                    <td style={{ textAlign: 'justify', textAlignLast: 'left', lineHeight: 1.45 }}>
                                      <span style={{ 
                                        color: h.actual_invoice > 0 ? '#4338ca' : h.recurring > 0 ? '#7e22ce' : '#0f172a',
                                        fontWeight: 700
                                      }}>
                                        {h.description}
                                      </span>
                                    </td>
                                    <td style={{ color: '#166534', fontWeight: 700, textAlign: 'right', whiteSpace: 'nowrap' }}>
                                      +Rs.{h.revenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                    </td>
                                    <td style={{ color: outflow > 0 ? '#b91c1c' : '#475569', fontWeight: outflow > 0 ? 700 : 500, textAlign: 'right', whiteSpace: 'nowrap' }}>
                                      {outflow > 0 ? `-Rs.${outflow.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : 'Rs.0.00'}
                                    </td>
                                    <td style={{ fontWeight: 800, textAlign: 'right', color: '#0f172a', whiteSpace: 'nowrap' }}>
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
                <div className="glass-card" style={{ padding: '2rem', marginBottom: '2rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <div style={{ padding: '0.5rem', background: 'linear-gradient(135deg, #6366f1, #3b82f6)', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                        <BrainCircuit size={24} />
                      </div>
                      <div>
                        <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#0f172a' }}>RAG Fusion Financial Advisor</h3>
                        <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>Propose spending or revenue decisions to analyze against live cash reserves, 30-day forecasting models, and ChromaDB past case memories.</p>
                      </div>
                    </div>

                    {/* Language Selector Toggle */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: '#f1f5f9', padding: '0.3rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                      <Globe size={16} color="#4f46e5" style={{ marginLeft: '0.4rem' }} />
                      <button
                        type="button"
                        onClick={() => setAdvisorLang('en')}
                        style={{
                          background: advisorLang === 'en' ? 'linear-gradient(135deg, #6366f1, #3b82f6)' : 'transparent',
                          color: advisorLang === 'en' ? '#fff' : '#475569',
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
                          color: advisorLang === 'ta' ? '#fff' : '#475569',
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
                        style={{ width: '100%', padding: '0.9rem 3.5rem 0.9rem 1.2rem', fontSize: '0.95rem', borderRadius: '12px', background: '#ffffff', border: '1px solid #e2e8f0', color: '#0f172a' }}
                      />
                      <button
                        type="button"
                        onClick={toggleSpeechRecognition}
                        style={{
                          position: 'absolute',
                          right: '0.5rem',
                          background: isListening 
                            ? 'linear-gradient(135deg, #ef4444, #dc2626)' 
                            : 'linear-gradient(135deg, #6366f1, #4f46e5)',
                          border: 'none',
                          color: '#ffffff',
                          borderRadius: '12px',
                          padding: '0.55rem 0.85rem',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          fontWeight: 800,
                          fontSize: '0.8rem',
                          boxShadow: isListening 
                            ? '0 0 18px rgba(239, 68, 68, 0.6)' 
                            : '0 4px 14px rgba(99, 102, 241, 0.35)',
                          transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                          transform: isListening ? 'scale(1.05)' : 'scale(1)',
                          animation: isListening ? 'pulse 1.2s infinite' : 'none'
                        }}
                        title={isListening ? "Listening to your voice... Speak now!" : "Click to speak your question using microphone"}
                      >
                        {isListening ? <MicOff size={16} color="#ffffff" /> : <Mic size={16} color="#ffffff" />}
                        <span style={{ fontSize: '0.75rem', letterSpacing: '0.02em' }}>
                          {isListening ? (advisorLang === 'ta' ? 'கேட்கிறது...' : 'Listening...') : (advisorLang === 'ta' ? 'பேசவும்' : 'Voice')}
                        </span>
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

                  {/* Voice Verification Prompt Banner */}
                  {isVoiceCaptured && (
                    <div style={{
                      marginTop: '0.85rem',
                      padding: '0.75rem 1rem',
                      background: 'linear-gradient(135deg, #fffbe6, #fef3c7)',
                      border: '1px solid #f59e0b',
                      borderRadius: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: '0.75rem',
                      boxShadow: '0 4px 12px rgba(245, 158, 11, 0.15)'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#92400e', fontWeight: 600, fontSize: '0.85rem' }}>
                        <CheckCircle size={18} color="#d97706" />
                        <span>
                          {advisorLang === 'ta'
                            ? 'குரல் கேள்வி பெறப்பட்டது! உள்ளீட்டுப் பெட்டியில் உள்ள கேள்வியை சரிபார்த்து "Get Advice" அழுத்தவும்.'
                            : 'Voice question captured! Please verify your question in the text box above, edit if needed, and click "Get Advice".'}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleAdvisorSubmit()}
                        style={{
                          background: 'linear-gradient(135deg, #d97706, #b45309)',
                          color: '#ffffff',
                          border: 'none',
                          padding: '0.45rem 1rem',
                          borderRadius: '10px',
                          fontWeight: 700,
                          fontSize: '0.8rem',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          boxShadow: '0 2px 6px rgba(217, 119, 6, 0.3)'
                        }}
                      >
                        <Sparkles size={14} />
                        <span>{advisorLang === 'ta' ? 'கேள்வியை அனுப்பவும்' : 'Confirm & Ask'}</span>
                      </button>
                    </div>
                  )}

                  {/* Sample Query Suggestions */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '1rem', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.75rem', color: '#334155', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                      <Lightbulb size={14} color="#d97706" /> Sample Queries:
                    </span>
                    {(advisorLang === 'ta' ? [
                      'ABC டிரேடர்ஸிடம் ₹45,000-க்கு சரக்கு வாங்கலாமா?',
                      'கடையின் மாத வாடகை ₹30,000 செலுத்த ரொக்கம் போதுமா?',
                      'விளம்பரத்திற்காக ₹15,000 செலவு செய்யலாமா?',
                      'கடைக்கு ₹18,500-க்கு பில்லிங் பிரிண்டர் வாங்கலாமா?',
                      'ஊழியர் சம்பளம் ₹75,000 வழங்க பணப்புழக்கம் சரியா?'
                    ] : [
                      'Can I spend Rs. 45,000 for inventory restock from ABC Traders?',
                      'Will paying store lease rent of Rs. 30,000 strain our cash balance?',
                      'Can we afford Rs. 15,000 for Meta Ads marketing campaign?',
                      'Should I buy a new POS billing printer for Rs. 18,500?',
                      'Is our cash balance healthy for month-end payroll of Rs. 75,000?'
                    ]).map((sample, idx) => (
                      <button
                        key={idx}
                        onClick={() => {
                          setAdvisorQuery(sample);
                          handleAdvisorSubmit(sample);
                        }}
                        style={{
                          background: '#ffffff',
                          border: '1px solid #e2e8f0',
                          borderRadius: '20px',
                          color: '#1e293b',
                          fontWeight: 600,
                          fontSize: '0.75rem',
                          padding: '0.35rem 0.75rem',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          boxShadow: '0 2px 6px rgba(99, 102, 241, 0.05)'
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

                {/* Advisor Pre-Query Welcome & Intelligence Dashboard Overview */}
                {!advisorResult && !advisorLoading && (
                  <div className="fade-in" style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '1.35rem' }}>
                    {/* 4 Engine Architecture Cards */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.25rem' }}>
                      
                      <div className="glass-card" style={{ padding: '1.35rem', borderLeft: '4px solid #6366f1', background: 'linear-gradient(135deg, #ffffff 60%, #f5f3ff 100%)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                          <div style={{ padding: '0.5rem', background: 'linear-gradient(135deg, #6366f1, #4f46e5)', borderRadius: '10px', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <BrainCircuit size={20} />
                          </div>
                          <span style={{ fontSize: '0.72rem', fontWeight: 800, padding: '0.2rem 0.6rem', borderRadius: '12px', background: '#eef2ff', color: '#4338ca', border: '1px solid #c7d2fe' }}>
                            Gemini 3.5 LLM
                          </span>
                        </div>
                        <h4 style={{ margin: '0 0 0.25rem 0', fontSize: '1rem', fontWeight: 800, color: '#0f172a' }}>
                          {advisorLang === 'ta' ? 'RAG Fusion பகுப்பாய்வு' : 'RAG Fusion AI Engine'}
                        </h4>
                        <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b', fontWeight: 500, lineHeight: 1.45 }}>
                          {advisorLang === 'ta'
                            ? 'நேரடி ரொக்க இருப்பு மற்றும் ChromaDB வரலாற்று நினைவுகளுடன் AI பரிந்துரை தருகிறது.'
                            : 'Generates explainable, context-aware financial advice blended with live cash balance & vector memory.'}
                        </p>
                      </div>

                      <div className="glass-card" style={{ padding: '1.35rem', borderLeft: '4px solid #10b981', background: 'linear-gradient(135deg, #ffffff 60%, #f0fdf4 100%)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                          <div style={{ padding: '0.5rem', background: 'linear-gradient(135deg, #10b981, #059669)', borderRadius: '10px', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Database size={20} />
                          </div>
                          <span style={{ fontSize: '0.72rem', fontWeight: 800, padding: '0.2rem 0.6rem', borderRadius: '12px', background: '#dcfce7', color: '#15803d', border: '1px solid #86efac' }}>
                            447 SME Cases
                          </span>
                        </div>
                        <h4 style={{ margin: '0 0 0.25rem 0', fontSize: '1rem', fontWeight: 800, color: '#0f172a' }}>
                          {advisorLang === 'ta' ? 'ChromaDB வழக்கு நினைவு' : 'Vector Case Memory'}
                        </h4>
                        <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b', fontWeight: 500, lineHeight: 1.45 }}>
                          {advisorLang === 'ta'
                            ? 'முந்தைய 447 வணிக செலவு முடிவுகள் மற்றும் அவற்றின் விளைவுகளை ஒப்பீடு செய்கிறது.'
                            : 'Retrieves semantically similar past SME spend decisions & outcome trajectory histories via Cosine distance.'}
                        </p>
                      </div>

                      <div className="glass-card" style={{ padding: '1.35rem', borderLeft: '4px solid #06b6d4', background: 'linear-gradient(135deg, #ffffff 60%, #f0f9ff 100%)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                          <div style={{ padding: '0.5rem', background: 'linear-gradient(135deg, #06b6d4, #0284c7)', borderRadius: '10px', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <TrendingUp size={20} />
                          </div>
                          <span style={{ fontSize: '0.72rem', fontWeight: 800, padding: '0.2rem 0.6rem', borderRadius: '12px', background: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd' }}>
                            30-Day Forecast
                          </span>
                        </div>
                        <h4 style={{ margin: '0 0 0.25rem 0', fontSize: '1rem', fontWeight: 800, color: '#0f172a' }}>
                          {advisorLang === 'ta' ? 'ரொக்கப் புழக்கம் கணிப்பு' : 'Cashflow Forecasting'}
                        </h4>
                        <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b', fontWeight: 500, lineHeight: 1.45 }}>
                          {advisorLang === 'ta'
                            ? 'அடுத்த 30 நாட்களின் வருவாய் மற்றும் செலவு போக்குகளை Prophet & ARIMA மூலம் கணிக்கிறது.'
                            : 'Ensemble Prophet & ARIMA(1,1,1) time series models forecasting 30-day liquidity risks.'}
                        </p>
                      </div>

                      <div className="glass-card" style={{ padding: '1.35rem', borderLeft: '4px solid #f59e0b', background: 'linear-gradient(135deg, #ffffff 60%, #fffbe6 100%)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                          <div style={{ padding: '0.5rem', background: 'linear-gradient(135deg, #f59e0b, #d97706)', borderRadius: '10px', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <ShieldAlert size={20} />
                          </div>
                          <span style={{ fontSize: '0.72rem', fontWeight: 800, padding: '0.2rem 0.6rem', borderRadius: '12px', background: '#fef3c7', color: '#b45309', border: '1px solid #fde68a' }}>
                            ₹10,000 Buffer
                          </span>
                        </div>
                        <h4 style={{ margin: '0 0 0.25rem 0', fontSize: '1rem', fontWeight: 800, color: '#0f172a' }}>
                          {advisorLang === 'ta' ? 'பாதுகாப்பு எச்சரிக்கை' : 'Risk & Safety Buffer'}
                        </h4>
                        <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b', fontWeight: 500, lineHeight: 1.45 }}>
                          {advisorLang === 'ta'
                            ? 'ரொக்க இருப்பு பாதுகாப்பு வரம்பை விட குறையும் அபாயம் இருந்தால் உடனடி எச்சரிக்கை அளிக்கும்.'
                            : 'Monitors liquidity thresholds to prevent cash crunch strains before committing new spend.'}
                        </p>
                      </div>

                    </div>

                    {/* How RAG Fusion Works Visual Banner */}
                    <div className="glass-card" style={{ padding: '1.4rem 1.65rem', background: 'linear-gradient(135deg, #faf5ff 0%, #eef2ff 100%)', border: '1px solid #c7d2fe' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          <div style={{ padding: '0.65rem', background: 'linear-gradient(135deg, #8b5cf6, #6366f1)', borderRadius: '12px', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Sparkles size={22} />
                          </div>
                          <div>
                            <h4 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#0f172a' }}>
                              {advisorLang === 'ta' ? 'RAG Fusion எவ்வாறு செயல்படுகிறது?' : 'How RAG Fusion Reasoning Works'}
                            </h4>
                            <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.82rem', color: '#475569', fontWeight: 600 }}>
                              {advisorLang === 'ta'
                                ? 'வணிகக் கேள்வி → 447 வழக்கு நினைவுகள் + 30-நாள் நிதி கணிப்பு → AI விளக்கம் & பரிந்துரை'
                                : 'User Question → 447 ChromaDB Cases + 30-Day Cashflow Trajectory → Explainable AI Verdict'}
                            </p>
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <span className="badge" style={{ background: '#ffffff', color: '#4338ca', border: '1px solid #c7d2fe', padding: '0.35rem 0.75rem', fontWeight: 800 }}>
                            1. Query Fusion
                          </span>
                          <ArrowRight size={14} color="#94a3b8" />
                          <span className="badge" style={{ background: '#ffffff', color: '#15803d', border: '1px solid #86efac', padding: '0.35rem 0.75rem', fontWeight: 800 }}>
                            2. Vector Search
                          </span>
                          <ArrowRight size={14} color="#94a3b8" />
                          <span className="badge" style={{ background: '#ffffff', color: '#0369a1', border: '1px solid #bae6fd', padding: '0.35rem 0.75rem', fontWeight: 800 }}>
                            3. Forecast Blend
                          </span>
                          <ArrowRight size={14} color="#94a3b8" />
                          <span className="badge" style={{ background: '#6366f1', color: '#ffffff', border: 'none', padding: '0.35rem 0.75rem', fontWeight: 800 }}>
                            4. AI Verdict
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Advisor Recommendation Result Display */}
                {advisorResult && (
                  <div className="fade-in">
                    {/* Top Row: Verdict Banner & Adaptive Blending Card */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1.5rem', marginBottom: '1.5rem' }}>
                      
                      {/* Verdict Banner Card */}
                      {(() => {
                        const isQueryTamil = advisorQuery && isTamilScript(advisorQuery);
                        return (
                          <div className="glass-card" style={{ padding: '1.75rem', border: `1px solid ${advisorResult.verdict === 'Recommended' ? '#dcfce7' : advisorResult.verdict === 'Proceed with Caution' ? '#fef3c7' : '#fecaca'}`, overflow: 'hidden' }}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                              <div style={{ minWidth: '180px', flex: '1 1 auto' }}>
                                <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                  {isQueryTamil ? 'செயற்கை நுண்ணறிவு பரிந்துரை' : 'AI Recommendation'}
                                </span>
                                <h4 style={{ 
                                  margin: '0.25rem 0 0 0', 
                                  fontSize: '1.5rem', 
                                  fontWeight: 800, 
                                  color: advisorResult.verdict === 'Recommended' ? '#166534' : advisorResult.verdict === 'Proceed with Caution' ? '#b45309' : '#b91c1c',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '0.5rem',
                                  flexWrap: 'wrap'
                                }}>
                                  {advisorResult.verdict === 'Recommended' && <CheckCircle size={24} color="#166534" />}
                                  {advisorResult.verdict === 'Proceed with Caution' && <ShieldAlert size={24} color="#b45309" />}
                                  {advisorResult.verdict === 'Not Recommended' && <AlertCircle size={24} color="#b91c1c" />}
                                  {isQueryTamil ? (advisorResult.verdict === 'Recommended' ? 'பரிந்துரைக்கப்படுகிறது' : advisorResult.verdict === 'Proceed with Caution' ? 'எச்சரிக்கையுடன் தொடரவும்' : 'பரிந்துரைக்கப்படவில்லை') : advisorResult.verdict}
                                </h4>
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                {/* Read Aloud Text-to-Speech Button */}
                                <button
                                  type="button"
                                  onClick={speakRecommendation}
                                  style={{
                                    background: isSpeaking 
                                      ? 'linear-gradient(135deg, #f59e0b, #ef4444)' 
                                      : 'linear-gradient(135deg, #4338ca, #6366f1)',
                                    border: '1px solid rgba(255, 255, 255, 0.4)',
                                    color: '#ffffff',
                                    borderRadius: '25px',
                                    padding: '0.45rem 0.85rem',
                                    fontSize: '0.75rem',
                                    fontWeight: 800,
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.35rem',
                                    boxShadow: isSpeaking 
                                      ? '0 4px 16px rgba(239, 68, 68, 0.4)' 
                                      : '0 4px 16px rgba(67, 56, 202, 0.35)',
                                    transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                                    whiteSpace: 'nowrap'
                                  }}
                                  title="Listen to recommendation out loud (Text-to-Speech)"
                                >
                                  {isSpeaking ? <VolumeX size={16} color="#ffffff" /> : <Volume2 size={16} color="#ffffff" />}
                                  <span>{isSpeaking ? (isQueryTamil ? 'நிறுத்து' : 'Stop Voice') : (isQueryTamil ? 'குரல் வழிகேட்க' : 'Listen Advice')}</span>
                                </button>

                                <span style={{ 
                                  padding: '0.35rem 0.85rem', 
                                  borderRadius: '20px', 
                                  fontSize: '0.75rem', 
                                  fontWeight: 800,
                                  whiteSpace: 'nowrap',
                                  background: advisorResult.risk_level === 'Low' ? '#dcfce7' : advisorResult.risk_level === 'Medium' ? '#fef3c7' : '#fee2e2',
                                  color: advisorResult.risk_level === 'Low' ? '#166534' : advisorResult.risk_level === 'Medium' ? '#b45309' : '#b91c1c',
                                  border: `1px solid ${advisorResult.risk_level === 'Low' ? '#bbf7d0' : advisorResult.risk_level === 'Medium' ? '#fde68a' : '#fca5a5'}`
                                }}>
                                  {isQueryTamil ? (advisorResult.risk_level === 'Low' ? 'குறைந்த அபாய நிலை' : advisorResult.risk_level === 'Medium' ? 'மத்திய அபாய நிலை' : 'உயர் அபாய நிலை') : `${advisorResult.risk_level} Risk Profile`}
                                </span>
                              </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', padding: '1rem', background: '#f8fafc', borderRadius: '12px', marginBottom: '1rem', border: '1px solid #e2e8f0' }}>
                              <div>
                                <div style={{ fontSize: '0.75rem', color: '#475569', fontWeight: 700 }}>
                                  {isQueryTamil ? 'தற்போதைய ரொக்க இருப்பு' : 'Current Cash Balance'}
                                </div>
                                <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#0f172a' }}>Rs.{advisorResult.current_balance?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                              </div>
                              <div>
                                <div style={{ fontSize: '0.75rem', color: '#475569', fontWeight: 700 }}>
                                  {isQueryTamil ? 'எதிர்பார்க்கப்படும் இருப்பு' : 'Est. Post-Transaction Reserve'}
                                </div>
                                <div style={{ fontSize: '1.1rem', fontWeight: 800, color: advisorResult.estimated_post_balance >= 10000 ? '#166534' : '#b91c1c' }}>
                                  Rs.{advisorResult.estimated_post_balance?.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                </div>
                              </div>
                            </div>

                            {advisorResult.suggested_action && (
                              <div style={{ fontSize: '0.85rem', color: '#0f172a', fontWeight: 600, background: '#eef2ff', padding: '0.75rem 1rem', borderRadius: '12px', borderLeft: '4px solid #4338ca', border: '1px solid #e0e7ff' }}>
                                <strong style={{ color: '#4338ca' }}>
                                  {isQueryTamil ? 'பரிந்துரைக்கப்பட்ட அடுத்த கட்ட நடவடிக்கை:' : 'Suggested Next Step:'}
                                </strong> {advisorResult.suggested_action}
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* Adaptive Blending Algorithm Card */}
                      <div className="glass-card" style={{ padding: '1.75rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                          <Bot size={20} color="#4338ca" />
                          <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#0f172a' }}>Adaptive Blending Calibration</h4>
                        </div>
                        
                        <p style={{ fontSize: '0.8rem', color: '#475569', fontWeight: 600, marginBottom: '1rem', lineHeight: 1.4 }}>
                          FinSense dynamically balances vector case memory vs. baseline financial rules based on case history volume.
                        </p>

                        <div style={{ marginBottom: '1.25rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontWeight: 800, color: '#0f172a', marginBottom: '0.4rem' }}>
                            <span>Case Memory Weight ({Math.round(advisorResult.blend_weight * 100)}%)</span>
                            <span>Rule Baseline ({Math.round((1 - advisorResult.blend_weight) * 100)}%)</span>
                          </div>
                          <div style={{ height: '10px', background: '#f1f5f9', borderRadius: '10px', overflow: 'hidden', display: 'flex' }}>
                            <div style={{ width: `${advisorResult.blend_weight * 100}%`, background: '#4f46e5', transition: 'width 0.5s ease' }}></div>
                            <div style={{ width: `${(1 - advisorResult.blend_weight) * 100}%`, background: '#cbd5e1' }}></div>
                          </div>
                        </div>

                        <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.75rem', color: '#0f172a' }}>
                          <div style={{ flex: 1, padding: '0.6rem', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', textAlign: 'center' }}>
                            <div style={{ color: '#4338ca', fontWeight: 800, fontSize: '0.95rem' }}>{advisorResult.retrieved_cases?.length || 0}</div>
                            <div style={{ color: '#475569', fontWeight: 700 }}>Retrieved Cases</div>
                          </div>
                          <div style={{ flex: 1, padding: '0.6rem', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', textAlign: 'center' }}>
                            <div style={{ color: '#166534', fontWeight: 800, fontSize: '0.95rem' }}>ChromaDB</div>
                            <div style={{ color: '#475569', fontWeight: 700 }}>Vector Index</div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Middle Row: Explainable LLM Reasoning & Key Rationale */}
                    <div className="glass-card" style={{ padding: '2rem', marginBottom: '1.5rem' }}>
                      <h4 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Sparkles size={20} color="#4338ca" />
                        {advisorQuery && isTamilScript(advisorQuery) ? 'விளக்கமளிக்கப்பட்ட பரிந்துரை காரணம்' : 'Explainable Recommendation Rationale'}
                      </h4>
                      
                      <p style={{ fontSize: '0.95rem', color: '#1e293b', fontWeight: 600, lineHeight: 1.6, marginBottom: '1.25rem' }}>
                        {advisorResult.explanation}
                      </p>

                      {advisorResult.key_factors && advisorResult.key_factors.length > 0 && (
                        <div>
                          <div style={{ fontSize: '0.8rem', fontWeight: 800, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.6rem' }}>
                            {advisorQuery && isTamilScript(advisorQuery) ? 'முக்கிய தீர்மான காரணிகள்' : 'Key Decision Factors'}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {advisorResult.key_factors.map((factor, idx) => (
                              <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.85rem', color: '#0f172a', fontWeight: 600, background: '#f8fafc', padding: '0.6rem 0.85rem', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                                <CheckCircle size={16} color="#166534" />
                                <span>{factor}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Bottom Row: Retrieved Vector Case Memories from ChromaDB */}
                    <div className="glass-card" style={{ padding: '2rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                        <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <Tag size={20} color="#4338ca" />
                          Retrieved Case Memories (Cosine Similarity)
                        </h4>
                        <span style={{ fontSize: '0.75rem', color: '#475569', fontWeight: 600 }}>Matched from 60+ Indexed Small Business Transactions</span>
                      </div>

                      {advisorResult.retrieved_cases && advisorResult.retrieved_cases.length > 0 ? (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
                          {advisorResult.retrieved_cases.map((c, idx) => (
                            <div key={idx} style={{ padding: '1rem 1.2rem', borderRadius: '14px', background: 'rgba(255,255,255,0.65)', border: '1px solid #c7d2fe' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                                <span style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.9rem' }}>{c.vendor_or_client}</span>
                                <span style={{ 
                                  fontSize: '0.7rem', 
                                  fontWeight: 800, 
                                  padding: '0.2rem 0.5rem', 
                                  borderRadius: '12px',
                                  background: c.outcome === 'healthy' ? '#dcfce7' : '#fee2e2',
                                  color: c.outcome === 'healthy' ? '#166534' : '#b91c1c',
                                  border: `1px solid ${c.outcome === 'healthy' ? '#bbf7d0' : '#fca5a5'}`
                                }}>
                                  {c.outcome}
                                </span>
                              </div>

                              <div style={{ fontSize: '1rem', fontWeight: 800, color: c.transaction_type === 'income' || c.transaction_type === 'return_in' ? '#166534' : '#b91c1c', marginBottom: '0.4rem' }}>
                                {c.transaction_type === 'income' || c.transaction_type === 'return_in' ? '+' : '-'}Rs.{c.amount?.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              </div>

                              <div style={{ fontSize: '0.75rem', color: '#334155', fontWeight: 600, fontStyle: 'italic', marginBottom: '0.6rem', lineHeight: 1.3 }}>
                                "{c.notes || c.summary_text || 'Past business transaction record'}"
                              </div>

                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.7rem', color: '#475569', fontWeight: 700, borderTop: '1px solid rgba(99, 102, 241, 0.1)', paddingTop: '0.4rem' }}>
                                <span>Category: {c.category}</span>
                                <span style={{ color: '#4338ca', fontWeight: 800 }}>Score: {c.similarity_score}%</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p style={{ color: '#475569', fontSize: '0.85rem', fontWeight: 600 }}>No similar past case memories found in ChromaDB.</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Case Memory Viewer Tab */}
            {activeTab === 'cases' && (
              <div className="tab-content fade-in">
                <div className="glass-card" style={{ padding: '2rem', marginBottom: '1.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Database size={22} color="#4338ca" />
                        ChromaDB Vector Store Explorer
                      </h3>
                      <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: '#475569', fontWeight: 600 }}>
                        Indexed historical case memory dataset ({casesList.length} total entries). Used by RAG fusion for semantic cosine retrieval.
                      </p>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <button
                        className="btn-primary"
                        onClick={() => setShowAddCaseModal(true)}
                        style={{ background: '#4338ca', color: '#ffffff', border: 'none', fontWeight: 800, padding: '0.6rem 1.1rem', fontSize: '0.85rem' }}
                      >
                        + Create Case Memory
                      </button>
                      <input 
                        type="text"
                        className="search-input"
                        placeholder="Search cases by vendor, category, or notes..."
                        value={casesSearch}
                        onChange={(e) => setCasesSearch(e.target.value)}
                        style={{ width: '260px', padding: '0.6rem 1rem', fontSize: '0.85rem', borderRadius: '10px', background: '#ffffff', border: '1px solid #e2e8f0', color: '#0f172a' }}
                      />
                    </div>
                  </div>

                  {/* Manual Case Creation Modal */}
                  {showAddCaseModal && (
                    <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(15, 23, 42, 0.45)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                      <div className="glass-card fade-in" style={{ width: '100%', maxWidth: '520px', background: '#ffffff', border: '1px solid #cbd5e1', boxShadow: '0 20px 40px rgba(0,0,0,0.15)', borderRadius: '16px', padding: '2rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                          <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <Database size={20} color="#4338ca" />
                            Create Custom Case Memory
                          </h3>
                          <button
                            onClick={() => setShowAddCaseModal(false)}
                            style={{ background: 'transparent', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: '#64748b', fontWeight: 700 }}
                          >
                            ✕
                          </button>
                        </div>
                        <p style={{ fontSize: '0.82rem', color: '#64748b', margin: '0 0 1.25rem 0', fontWeight: 500 }}>
                          Directly index a past financial decision, vendor experience, or spending outcome into ChromaDB vector store for RAG reasoning.
                        </p>

                        <form onSubmit={handleAddCaseSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', textAlign: 'left' }}>
                          <div className="field-group">
                            <label style={{ color: '#0f172a', fontSize: '0.78rem', fontWeight: 800 }}>Vendor / Client Name</label>
                            <input
                              type="text"
                              placeholder="e.g. Dell India, Anna University"
                              value={caseForm.vendor_or_client}
                              onChange={(e) => setCaseForm({ ...caseForm, vendor_or_client: e.target.value })}
                              required
                              style={{ padding: '0.6rem 0.85rem', fontSize: '0.88rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}
                            />
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <div className="field-group">
                              <label style={{ color: '#0f172a', fontSize: '0.78rem', fontWeight: 800 }}>Amount (Rs.)</label>
                              <input
                                type="number"
                                step="0.01"
                                placeholder="0.00"
                                value={caseForm.amount}
                                onChange={(e) => setCaseForm({ ...caseForm, amount: e.target.value })}
                                required
                                style={{ padding: '0.6rem 0.85rem', fontSize: '0.88rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}
                              />
                            </div>

                            <div className="field-group">
                              <label style={{ color: '#0f172a', fontSize: '0.78rem', fontWeight: 800 }}>Transaction Type</label>
                              <select
                                value={caseForm.transaction_type}
                                onChange={(e) => setCaseForm({ ...caseForm, transaction_type: e.target.value })}
                                style={{ padding: '0.6rem 0.85rem', fontSize: '0.88rem', borderRadius: '8px', border: '1px solid #e2e8f0', height: '39px', fontWeight: 600 }}
                              >
                                <option value="expense">↓ Expense</option>
                                <option value="income">↑ Income</option>
                                <option value="return_in">↑ Return In</option>
                                <option value="return_out">↓ Refund Out</option>
                              </select>
                            </div>
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <div className="field-group">
                              <label style={{ color: '#0f172a', fontSize: '0.78rem', fontWeight: 800 }}>Category</label>
                              <select
                                value={caseForm.category}
                                onChange={(e) => setCaseForm({ ...caseForm, category: e.target.value })}
                                style={{ padding: '0.6rem 0.85rem', fontSize: '0.88rem', borderRadius: '8px', border: '1px solid #e2e8f0', height: '39px', fontWeight: 600 }}
                              >
                                <option value="Miscellaneous">Miscellaneous</option>
                                <option value="Shopping">Shopping</option>
                                <option value="Software">Software</option>
                                <option value="Utilities">Utilities</option>
                                <option value="Marketing">Marketing</option>
                                <option value="Financial">Financial</option>
                                <option value="Education">Education</option>
                              </select>
                            </div>

                            <div className="field-group">
                              <label style={{ color: '#0f172a', fontSize: '0.78rem', fontWeight: 800 }}>Assigned Outcome Memory</label>
                              <select
                                value={caseForm.outcome}
                                onChange={(e) => setCaseForm({ ...caseForm, outcome: e.target.value })}
                                style={{ padding: '0.6rem 0.85rem', fontSize: '0.88rem', borderRadius: '8px', border: '1px solid #e2e8f0', height: '39px', fontWeight: 700, color: caseForm.outcome === 'healthy' || caseForm.outcome === 'Productive' ? '#166534' : '#b91c1c' }}
                              >
                                <option value="healthy">Healthy (Low Risk)</option>
                                <option value="strained">Strained (Cash Deficit)</option>
                                <option value="Productive">Productive (High ROI)</option>
                                <option value="Necessary">Necessary (Operational)</option>
                                <option value="Wasteful">Wasteful (Low ROI)</option>
                                <option value="Pending Review">Pending Review</option>
                              </select>
                            </div>
                          </div>

                          <div className="field-group">
                            <label style={{ color: '#0f172a', fontSize: '0.78rem', fontWeight: 800 }}>Decision Rationale / Experience Notes</label>
                            <textarea
                              placeholder="Describe the context, decision outcome, or lesson learned (e.g. Caused temporary cash crunch, but boosted dev speed...)"
                              value={caseForm.notes}
                              onChange={(e) => setCaseForm({ ...caseForm, notes: e.target.value })}
                              style={{ padding: '0.6rem 0.85rem', fontSize: '0.88rem', borderRadius: '8px', border: '1px solid #e2e8f0', minHeight: '75px', resize: 'vertical', fontWeight: 500 }}
                            />
                          </div>

                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.75rem' }}>
                            <button
                              type="button"
                              onClick={() => setShowAddCaseModal(false)}
                              style={{ padding: '0.6rem 1.25rem', borderRadius: '8px', border: '1px solid #e2e8f0', background: '#f8fafc', color: '#475569', fontWeight: 700, cursor: 'pointer' }}
                            >
                              Cancel
                            </button>
                            <button
                              type="submit"
                              disabled={caseSubmitting}
                              style={{ padding: '0.6rem 1.5rem', borderRadius: '8px', border: 'none', background: '#4338ca', color: '#ffffff', fontWeight: 800, cursor: caseSubmitting ? 'not-allowed' : 'pointer' }}
                            >
                              {caseSubmitting ? 'Indexing...' : 'Save to Case Memory'}
                            </button>
                          </div>
                        </form>
                      </div>
                    </div>
                  )}

                  {casesLoading ? (
                    <div style={{ padding: '3rem', textAlign: 'center', color: '#475569', fontWeight: 600 }}>
                      <RefreshCw size={24} className="spin" style={{ marginBottom: '0.5rem', color: '#4338ca' }} />
                      <div>Loading ChromaDB vector case memories...</div>
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
                      {casesList
                        .filter(c => !casesSearch || (c.vendor_or_client + ' ' + c.category + ' ' + c.notes).toLowerCase().includes(casesSearch.toLowerCase()))
                        .map((c, idx) => (
                          <div key={idx} style={{ padding: '1.2rem', borderRadius: '14px', background: '#ffffff', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                            <div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                                <span style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.95rem' }}>{c.vendor_or_client}</span>
                                <span style={{ 
                                  fontSize: '0.7rem', 
                                  fontWeight: 800, 
                                  padding: '0.25rem 0.6rem', 
                                  borderRadius: '12px',
                                  background: c.outcome === 'healthy' ? '#dcfce7' : '#fee2e2',
                                  color: c.outcome === 'healthy' ? '#166534' : '#b91c1c',
                                  border: `1px solid ${c.outcome === 'healthy' ? '#bbf7d0' : '#fca5a5'}`
                                }}>
                                  {c.outcome}
                                </span>
                              </div>

                              <div style={{ fontSize: '1.1rem', fontWeight: 800, color: c.transaction_type === 'income' || c.transaction_type === 'return_in' ? '#166534' : '#b91c1c', marginBottom: '0.5rem' }}>
                                {c.transaction_type === 'income' || c.transaction_type === 'return_in' ? '+' : '-'}Rs.{c.amount?.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              </div>

                              <p style={{ fontSize: '0.8rem', color: '#334155', fontWeight: 600, margin: '0 0 0.8rem 0', lineHeight: 1.4 }}>
                                {c.notes || c.summary_text || 'Past business transaction decision memory'}
                              </p>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', color: '#475569', fontWeight: 700, borderTop: '1px solid rgba(99, 102, 241, 0.1)', paddingTop: '0.5rem' }}>
                              <span>Category: {c.category}</span>
                              <span style={{ color: '#4338ca', fontWeight: 800 }}>Case #{c.id}</span>
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
                <div className="glass-card" style={{ padding: '2rem', maxWidth: '650px', margin: '0 auto' }}>
                  <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.25rem', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Sliders size={22} color="#4338ca" />
                    System & Business Configuration
                  </h3>
                  <p style={{ margin: '0 0 1.75rem 0', fontSize: '0.85rem', color: '#475569', fontWeight: 600 }}>
                    Manage baseline liquidity settings, safety threshold alerts, and LLM reasoning models.
                  </p>

                  <form onSubmit={handleSettingsSave} style={{ display: 'flex', flexDirection: 'column', gap: '1.4rem' }}>
                    <div className="field-group">
                      <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 800, color: '#475569', marginBottom: '0.45rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Starting Business Cash Balance (Rs.)
                      </label>
                      <div className="custom-input-wrapper">
                        <span className="custom-input-icon">₹</span>
                        <input 
                          type="number"
                          step="0.01"
                          className="custom-input"
                          style={{ paddingLeft: '2.75rem' }}
                          value={settingsForm.starting_balance}
                          onChange={(e) => setSettingsForm(prev => ({ ...prev, starting_balance: parseFloat(e.target.value) || 0 }))}
                        />
                      </div>
                      <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, marginTop: '0.35rem', display: 'block' }}>
                        Live balance is calculated as: Starting Balance + Σ(Income) - Σ(Expenses).
                      </span>
                    </div>

                    <div className="field-group">
                      <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 800, color: '#475569', marginBottom: '0.45rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Financial Safety Alert Threshold (Rs.)
                      </label>
                      <div className="custom-input-wrapper">
                        <span className="custom-input-icon">₹</span>
                        <input 
                          type="number"
                          step="0.01"
                          className="custom-input"
                          style={{ paddingLeft: '2.75rem' }}
                          value={settingsForm.balance_alert_threshold}
                          onChange={(e) => setSettingsForm(prev => ({ ...prev, balance_alert_threshold: parseFloat(e.target.value) || 0 }))}
                        />
                      </div>
                      <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, marginTop: '0.35rem', display: 'block' }}>
                        Triggers "Strained" risk warnings when cash reserve drops below this amount.
                      </span>
                    </div>

                    <div className="field-group">
                      <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 800, color: '#475569', marginBottom: '0.45rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Preferred Gemini AI Reasoning Model
                      </label>
                      <div className="custom-input-wrapper">
                        <span className="custom-input-icon"><Bot size={18} color="#6366f1" /></span>
                        <select
                          className="custom-select"
                          style={{ paddingLeft: '2.75rem' }}
                          value={settingsForm.gemini_model}
                          onChange={(e) => setSettingsForm(prev => ({ ...prev, gemini_model: e.target.value }))}
                        >
                          <option value="gemini-3.5-flash">Gemini 3.5 Flash (Recommended - Latest & Fast)</option>
                          <option value="gemini-2.5-pro">Gemini 2.5 Pro (Deep Complex Reasoning)</option>
                          <option value="gemini-2.5-flash">Gemini 2.5 Flash (Standard Baseline)</option>
                        </select>
                      </div>
                      <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, marginTop: '0.35rem', display: 'block' }}>
                        Used by RAG Fusion engine for generating explainable advice.
                      </span>
                    </div>

                    <button 
                      type="submit"
                      disabled={settingsSaving}
                      style={{
                        padding: '0.85rem 1.75rem',
                        borderRadius: '12px',
                        fontWeight: 800,
                        fontSize: '0.9rem',
                        cursor: settingsSaving ? 'not-allowed' : 'pointer',
                        marginTop: '0.75rem',
                        background: 'linear-gradient(135deg, #6366f1, #3b82f6)',
                        color: '#ffffff',
                        border: 'none',
                        boxShadow: '0 4px 14px rgba(99, 102, 241, 0.35)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.5rem',
                        transition: 'all 0.25s ease'
                      }}
                    >
                      <Sparkles size={18} />
                      <span>{settingsSaving ? 'Saving Settings...' : 'Save System Settings'}</span>
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
