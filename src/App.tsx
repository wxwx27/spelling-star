/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  BookOpen, 
  Settings, 
  LayoutDashboard, 
  Play, 
  Volume2, 
  SkipForward, 
  HelpCircle, 
  CheckCircle2, 
  XCircle,
  ArrowLeft,
  Trophy,
  GraduationCap,
  BarChart3,
  Users,
  AlertCircle,
  LogIn
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import ReactMarkdown from 'react-markdown';
import { GoogleGenAI } from "@google/genai";
import { 
  collection, 
  addDoc, 
  getDocs, 
  query, 
  where, 
  orderBy, 
  limit, 
  doc, 
  setDoc, 
  getDoc, 
  updateDoc, 
  increment,
  onSnapshot,
  Timestamp
} from 'firebase/firestore';
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from 'firebase/auth';
import { db, auth } from './firebase';
import { MOE_WORDS } from './data/words';
import { Word, Difficulty, Student, Session, WordStat } from './types';

// Firestore Error Handling
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// AI Initialization
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });


export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [student, setStudent] = useState<Student | null>(null);
  const [view, setView] = useState<'home' | 'practice' | 'result' | 'dashboard'>('home');
  const [practiceMode, setPracticeMode] = useState<'random' | 'mistakes'>('random');
  const [studentName, setStudentName] = useState('');
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [sessionWords, setSessionWords] = useState<Word[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [userInput, setUserInput] = useState('');
  const [mistakes, setMistakes] = useState<string[]>([]);
  const [correctCount, setCorrectCount] = useState(0);
  const [aiSuggestion, setAiSuggestion] = useState('');
  const [isLoadingAi, setIsLoadingAi] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | null>(null);
  const [timer, setTimer] = useState(0);
  const [startTime, setStartTime] = useState<number | null>(null);

  // Dashboard state
  const [allSessions, setAllSessions] = useState<Session[]>([]);
  const [allStudents, setAllStudents] = useState<Student[]>([]);
  const [wordStats, setWordStats] = useState<WordStat[]>([]);
  const [dashboardTimePeriod, setDashboardTimePeriod] = useState<'year' | '6months' | '1month' | 'all'>('year');
  const [selectedStudentFilter, setSelectedStudentFilter] = useState<string>('all');

  const inputRef = useRef<HTMLInputElement>(null);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) {
        fetchStudentData(u.uid);
      }
    });
    return () => unsubscribe();
  }, []);

  // Dashboard Data Listener
  useEffect(() => {
    if (view === 'dashboard') {
      const qSessions = query(collection(db, 'sessions'), orderBy('timestamp', 'desc'), limit(2000));
      const unsubscribeSessions = onSnapshot(qSessions, (snapshot) => {
        setAllSessions(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Session)));
      });

      const qStudents = query(collection(db, 'students'), orderBy('lastActive', 'desc'));
      const unsubscribeStudents = onSnapshot(qStudents, (snapshot) => {
        setAllStudents(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Student)));
      });

      const qWordStats = query(collection(db, 'wordStats'), orderBy('mistakeCount', 'desc'), limit(10));
      const unsubscribeWordStats = onSnapshot(qWordStats, (snapshot) => {
        setWordStats(snapshot.docs.map(d => d.data() as WordStat));
      });

      return () => {
        unsubscribeSessions();
        unsubscribeStudents();
        unsubscribeWordStats();
      };
    }
  }, [view]);

  // Timer Effect
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (view === 'practice' && startTime) {
      interval = setInterval(() => {
        setTimer(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [view, startTime]);

  // Auto-focus input
  useEffect(() => {
    if (view === 'practice' && inputRef.current) {
      inputRef.current.focus();
    }
  }, [view, currentIndex]);

  const fetchStudentData = async (uid: string) => {
    const docRef = doc(db, 'students', uid);
    try {
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        setStudent(docSnap.data() as Student);
        setStudentName(docSnap.data().name);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `students/${uid}`);
    }
  };

  const handleLogin = async () => {
    setIsLoggingIn(true);
    setErrorMessage(null);
    const provider = new GoogleAuthProvider();
    try {
      const result = await signInWithPopup(auth, provider);
      setUser(result.user);
      await fetchStudentData(result.user.uid);
    } catch (error: any) {
      console.error("Login failed", error);
      if (error.code === 'auth/popup-blocked') {
        setErrorMessage("登入視窗被瀏覽器封鎖了，請允許彈出視窗後再試一次。");
      } else if (error.code === 'auth/unauthorized-domain') {
        setErrorMessage("此網域尚未在 Firebase 中獲得授權。請將您的 GitHub Pages 網址 (例如 username.github.io) 加入 Firebase 控制台的「授權網域」清單中。");
      } else {
        setErrorMessage("登入失敗：" + (error.message || "未知錯誤"));
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const startPractice = async () => {
    if (!studentName.trim()) {
      setErrorMessage("請輸入姓名以開始練習！");
      return;
    }

    // Update or create student profile
    if (user) {
      const studentData: Student = {
        name: studentName,
        lastActive: new Date().toISOString(),
        totalSessions: (student?.totalSessions || 0),
        averageAccuracy: (student?.averageAccuracy || 0)
      };
      try {
        await setDoc(doc(db, 'students', user.uid), studentData, { merge: true });
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `students/${user.uid}`);
      }
      setStudent(studentData);
    }

    let selected: Word[] = [];

    if (practiceMode === 'mistakes') {
      if (!user) {
        setErrorMessage("請先登入以練習錯題！");
        return;
      }
      // Fetch previous mistakes
      try {
        const q = query(collection(db, 'sessions'), where('studentId', '==', user.uid));
        const querySnapshot = await getDocs(q);
        const allMistakeWords = new Set<string>();
        querySnapshot.forEach((doc) => {
          const data = doc.data() as Session;
          data.mistakes.forEach(m => allMistakeWords.add(m.toLowerCase()));
        });

        if (allMistakeWords.size === 0) {
          setErrorMessage("目前沒有錯題紀錄，請先進行隨機練習！");
          return;
        }

        selected = MOE_WORDS.filter(w => allMistakeWords.has(w.word.toLowerCase()));
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, 'sessions');
        return;
      }
    } else {
      // Filter words based on difficulty
      let filtered = MOE_WORDS;
      
      if (difficulty === 'low') filtered = filtered.filter(w => w.word.length <= 4);
      else if (difficulty === 'medium') filtered = filtered.filter(w => w.word.length >= 5 && w.word.length <= 7);
      else filtered = filtered.filter(w => w.word.length >= 8);

      selected = [...filtered];
    }

    // Randomly pick 100 (or all if less than 100)
    const shuffled = [...selected].sort(() => 0.5 - Math.random());
    const finalSelection = shuffled.slice(0, 100);

    if (finalSelection.length === 0) {
      setErrorMessage("找不到符合條件的單字，請調整設定！");
      return;
    }

    setSessionWords(finalSelection);
    setCurrentIndex(0);
    setMistakes([]);
    setCorrectCount(0);
    setAiSuggestion('');
    setTimer(0);
    setStartTime(Date.now());
    setView('practice');
    setUserInput('');
  };

  const speak = (text: string) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    window.speechSynthesis.speak(utterance);
  };

  const handleNext = async (isCorrect: boolean) => {
    if (feedback) return; // Prevent double submission during animation
    
    const currentWord = sessionWords[currentIndex];
    
    // Update word stats in Firestore
    const wordId = currentWord.word.toLowerCase();
    const wordRef = doc(db, 'wordStats', wordId);
    try {
      await setDoc(wordRef, {
        word: currentWord.word,
        mistakeCount: increment(isCorrect ? 0 : 1),
        attemptCount: increment(1)
      }, { merge: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `wordStats/${wordId}`);
    }

    if (isCorrect) {
      setCorrectCount(prev => prev + 1);
      setFeedback('correct');
    } else {
      setMistakes(prev => [...prev, currentWord.word]);
      setFeedback('wrong');
    }

    setTimeout(() => {
      setFeedback(null);
      setShowHint(false);
      setUserInput('');
      if (currentIndex < sessionWords.length - 1) {
        setCurrentIndex(prev => prev + 1);
      } else {
        finishSession();
      }
    }, 800);
  };

  const finishSession = async () => {
    const accuracy = (correctCount / sessionWords.length) * 100;
    const sessionData: Session = {
      studentId: user?.uid || 'anonymous',
      studentName: studentName,
      timestamp: new Date().toISOString(),
      difficulty,
      grade: 'all',
      score: correctCount,
      totalWords: sessionWords.length,
      accuracy,
      mistakes
    };

    try {
      await addDoc(collection(db, 'sessions'), sessionData);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'sessions');
    }

    // Update student stats
    if (user) {
      const newTotal = (student?.totalSessions || 0) + 1;
      const newAvgAcc = ((student?.averageAccuracy || 0) * (student?.totalSessions || 0) + accuracy) / newTotal;
      try {
        await updateDoc(doc(db, 'students', user.uid), {
          totalSessions: newTotal,
          averageAccuracy: newAvgAcc,
          lastActive: new Date().toISOString()
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `students/${user.uid}`);
      }
    }

    setView('result');
    generateAiSuggestion(sessionData);
  };

  const generateAiSuggestion = async (session: Session) => {
    setIsLoadingAi(true);
    try {
      const prompt = `
        學生姓名：${session.studentName}
        練習難度：${session.difficulty}
        正確率：${session.accuracy.toFixed(1)}%
        錯題列表：${session.mistakes.join(', ')}
        
        請根據以上拼字練習結果，提供一段大約 200 字的繁體中文學習建議。
        語氣要親切、鼓勵，並針對錯題給予具體的記憶技巧或發音建議。
      `;
      const result = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt
      });
      setAiSuggestion(result.text || "暫時無法生成建議，請繼續加油！");
    } catch (error) {
      console.error("AI Error", error);
      setAiSuggestion("暫時無法生成建議，請繼續加油！");
    } finally {
      setIsLoadingAi(false);
    }
  };

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (view === 'practice') {
        if (e.key === 'F10') {
          e.preventDefault();
          speak(sessionWords[currentIndex].word);
        }
        if (e.key === 'Enter') {
          // Case-insensitive and trimmed check
          const targetWord = sessionWords[currentIndex].word.toLowerCase().trim();
          const currentInput = userInput.toLowerCase().trim();
          
          if (currentInput === targetWord) {
            handleNext(true);
          } else {
            handleNext(false);
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [view, currentIndex, userInput, sessionWords]);

  // Render components
  const renderHome = () => (
    <div className="min-h-screen flex flex-col items-start justify-center px-8 md:px-24 max-w-4xl">
      <motion.div 
        initial={{ x: -50, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        className="space-y-2 mb-8"
      >
        <h1 className="text-7xl md:text-9xl font-black tracking-tighter leading-none text-black">
          SPELL
        </h1>
        <h1 className="text-7xl md:text-9xl font-black tracking-tighter leading-none text-[#ff4757]">
          LIKE A
        </h1>
        <div className="flex items-center gap-4">
          <h1 className="text-7xl md:text-9xl font-black tracking-tighter leading-none text-black">
            STAR!
          </h1>
          <span className="text-6xl md:text-8xl float">⭐</span>
        </div>
      </motion.div>

      <motion.p 
        initial={{ x: -50, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="text-xl md:text-2xl font-medium text-gray-700 max-w-2xl mb-12 leading-relaxed"
      >
        Practice spelling 100 random A1 words with audio, pictures, and fun hints. 
        Track your progress and become a spelling champion!
      </motion.p>

      {!user ? (
        <div className="flex flex-col gap-4">
          <button 
            onClick={handleLogin}
            disabled={isLoggingIn}
            className={`brutalist-btn btn-red ${isLoggingIn ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <LogIn size={24} /> {isLoggingIn ? '正在開啟登入視窗...' : 'Login with Google'}
          </button>
          {errorMessage && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-red-100 border-2 border-red-500 p-4 rounded-xl text-red-700 font-bold flex items-center gap-2"
            >
              <AlertCircle size={20} />
              {errorMessage}
            </motion.div>
          )}
          <p className="text-sm text-gray-500 font-bold">
            * 如果登入視窗未跳出，請檢查瀏覽器是否封鎖了彈出視窗。
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6 w-full max-w-md">
          {errorMessage && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-yellow-100 border-2 border-yellow-500 p-4 rounded-xl text-yellow-800 font-bold flex items-center justify-between gap-2"
            >
              <div className="flex items-center gap-2">
                <AlertCircle size={20} />
                {errorMessage}
              </div>
              <button onClick={() => setErrorMessage(null)} className="text-xl">&times;</button>
            </motion.div>
          )}
          {/* Student Name Input */}
          <div className="flex flex-col gap-2 mb-2">
            <label className="font-black text-lg">Your Name:</label>
            <input 
              type="text" 
              value={studentName}
              onChange={(e) => setStudentName(e.target.value)}
              placeholder="Enter your name..."
              className="w-full p-3 rounded-xl border-4 border-black text-xl font-bold focus:outline-none focus:ring-4 focus:ring-[#ff4757]"
            />
          </div>

          <div className="flex flex-col gap-4 mb-4 bg-white/50 p-4 rounded-2xl border-2 border-black/10">
            <div className="flex items-center justify-between">
              <span className="font-black text-lg">Difficulty:</span>
              <div className="flex gap-2">
                {(['low', 'medium', 'high'] as Difficulty[]).map(d => (
                  <button 
                    key={d}
                    onClick={() => setDifficulty(d)}
                    className={`px-4 py-1 rounded-lg border-2 border-black font-bold transition-colors ${difficulty === d ? 'bg-black text-white' : 'bg-white text-black'}`}
                  >
                    {d === 'low' ? 'Easy' : d === 'medium' ? 'Med' : 'Hard'}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-black text-lg">Mode:</span>
              <div className="flex gap-2">
                <button 
                  onClick={() => setPracticeMode('random')}
                  className={`px-4 py-1 rounded-lg border-2 border-black font-bold transition-colors ${practiceMode === 'random' ? 'bg-black text-white' : 'bg-white text-black'}`}
                >
                  Random
                </button>
                <button 
                  onClick={() => setPracticeMode('mistakes')}
                  className={`px-4 py-1 rounded-lg border-2 border-black font-bold transition-colors ${practiceMode === 'mistakes' ? 'bg-black text-white' : 'bg-white text-black'}`}
                >
                  Mistakes
                </button>
              </div>
            </div>
          </div>

          <button 
            onClick={startPractice}
            className="brutalist-btn btn-red w-full md:w-fit"
          >
            <BookOpen size={24} /> Start Practice!
          </button>
          
          <button 
            onClick={() => setView('dashboard')}
            className="brutalist-btn btn-yellow w-full md:w-fit"
          >
            <Trophy size={24} /> My Scores
          </button>

          <button 
            onClick={() => setView('dashboard')}
            className="brutalist-btn btn-purple w-full md:w-fit"
          >
            <GraduationCap size={24} /> Teacher Dashboard
          </button>
        </div>
      )}

      {/* Background Shapes */}
      <div className="memphis-shape triangle float" />
      <div className="memphis-shape square float" />
      <div className="memphis-shape dot-circle" />
      <div className="memphis-shape circle" />
    </div>
  );

  const renderPractice = () => {
    const currentWord = sessionWords[currentIndex];
    if (!currentWord) return null;

    const progress = ((currentIndex + 1) / sessionWords.length) * 100;

    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="flex justify-between items-center mb-4">
          <button onClick={() => setView('home')} className="flex items-center gap-1 font-bold bg-white px-4 py-2 rounded-xl border-2 border-[#2d3436]">
            <ArrowLeft size={18} /> 返回
          </button>
          <div className="flex gap-4 items-center">
            <div className="flex flex-col items-end">
              <span className="font-black text-xl text-[#2d3436]">
                {Math.floor(timer / 60)}:{(timer % 60).toString().padStart(2, '0')}
              </span>
              <span className="text-xs font-bold text-gray-500">作答時間</span>
            </div>
            <div className="flex gap-2">
              <span className="bg-[#81ecec] px-4 py-1 rounded-full border-2 border-[#2d3436] font-bold">
                {currentWord.grade}年級
              </span>
              <span className="bg-[#ffeaa7] px-4 py-1 rounded-full border-2 border-[#2d3436] font-bold">
                {currentIndex + 1} / {sessionWords.length}
              </span>
            </div>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="w-full h-6 bg-white border-4 border-[#2d3436] rounded-full mb-8 overflow-hidden">
          <motion.div 
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            className="h-full bg-[#55efc4]"
          />
        </div>

        <motion.div 
          key={currentIndex}
          initial={{ x: 50, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          className="bg-white p-10 rounded-3xl shadow-[12px_12px_0px_0px_#2d3436] border-4 border-[#2d3436] text-center relative overflow-hidden"
          onClick={() => inputRef.current?.focus()}
        >
          {feedback && (
            <motion.div 
              initial={{ scale: 0 }}
              animate={{ scale: 1.5 }}
              className={`absolute inset-0 flex items-center justify-center z-10 bg-white/80`}
            >
              {feedback === 'correct' ? (
                <CheckCircle2 size={120} className="text-[#00b894]" />
              ) : (
                <XCircle size={120} className="text-[#d63031]" />
              )}
            </motion.div>
          )}

          <div className="mb-6">
            <span className="text-sm font-black uppercase tracking-widest text-[#a29bfe] bg-[#a29bfe]/10 px-3 py-1 rounded-lg">
              {currentWord.pos}
            </span>
            <h2 className="text-5xl font-black mt-4 text-[#2d3436]">
              {currentWord.chinese}
            </h2>
          </div>

          <div className="flex flex-wrap justify-center gap-2 mb-8">
            {currentWord.word.split('').map((char, idx) => (
              <div 
                key={idx}
                className={`w-12 h-16 border-4 border-[#2d3436] rounded-xl flex items-center justify-center text-3xl font-black transition-all
                  ${userInput.length > idx ? 'bg-[#81ecec]' : 'bg-gray-50'}
                  ${showHint && idx === userInput.length ? 'border-[#fdcb6e] bg-[#ffeaa7]' : ''}
                  ${char === ' ' ? 'border-dashed opacity-50' : ''}
                `}
              >
                {userInput[idx] || (showHint && idx === userInput.length ? char : '')}
              </div>
            ))}
          </div>

          <input 
            ref={inputRef}
            autoFocus
            type="text"
            value={userInput}
            onChange={(e) => {
              const val = e.target.value; // Allow all characters including spaces and case
              if (val.length <= currentWord.word.length) setUserInput(val);
            }}
            className="absolute opacity-0"
            onBlur={() => {
              // Keep focus
              setTimeout(() => inputRef.current?.focus(), 10);
            }}
          />

          <div className="flex justify-center gap-4">
            <button 
              onClick={() => speak(currentWord.word)}
              className="p-4 bg-[#fab1a0] rounded-2xl border-4 border-[#2d3436] hover:bg-[#ff7675] transition-colors"
              title="播放音檔 (F10)"
            >
              <Volume2 size={32} />
            </button>
            <button 
              onClick={() => setShowHint(true)}
              className="p-4 bg-[#ffeaa7] rounded-2xl border-4 border-[#2d3436] hover:bg-[#fdcb6e] transition-colors"
              title="提示"
            >
              <HelpCircle size={32} />
            </button>
            <button 
              onClick={() => {
                const targetWord = currentWord.word.toLowerCase().trim();
                const currentInput = userInput.toLowerCase().trim();
                if (currentInput === targetWord) {
                  handleNext(true);
                } else {
                  handleNext(false);
                }
              }}
              className="p-4 bg-[#55efc4] rounded-2xl border-4 border-[#2d3436] hover:bg-[#00b894] transition-colors flex items-center gap-2 font-black"
              title="檢查答案"
            >
              <CheckCircle2 size={32} />
              <span className="hidden md:inline">檢查答案</span>
            </button>
            <button 
              onClick={() => handleNext(false)}
              className="p-4 bg-white rounded-2xl border-4 border-[#2d3436] hover:bg-gray-100 transition-colors"
              title="跳過"
            >
              <SkipForward size={32} />
            </button>
          </div>
        </motion.div>

        <div className="mt-8 bg-[#2d3436] text-white p-4 rounded-2xl font-bold flex justify-between">
          <span>正確: {correctCount}</span>
          <span>錯誤: {mistakes.length}</span>
          <span>準確率: {currentIndex === 0 ? 0 : ((correctCount / currentIndex) * 100).toFixed(1)}%</span>
        </div>
      </div>
    );
  };

  const renderResult = () => (
    <div className="max-w-4xl mx-auto px-4 py-12">
      <motion.div 
        initial={{ y: 50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="bg-white p-10 rounded-3xl shadow-[12px_12px_0px_0px_#2d3436] border-4 border-[#2d3436]"
      >
        <div className="text-center mb-10">
          <Trophy size={80} className="mx-auto text-[#fdcb6e] mb-4" />
          <h2 className="text-4xl font-black mb-2">練習完成！</h2>
          <p className="text-xl text-gray-600">太棒了，{studentName}！你完成了本次訓練。</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
          <div className="bg-[#81ecec] p-6 rounded-2xl border-4 border-[#2d3436] text-center">
            <p className="font-bold text-gray-700">正確題數</p>
            <p className="text-4xl font-black">{correctCount} / {sessionWords.length}</p>
          </div>
          <div className="bg-[#55efc4] p-6 rounded-2xl border-4 border-[#2d3436] text-center">
            <p className="font-bold text-gray-700">準確率</p>
            <p className="text-4xl font-black">{((correctCount / sessionWords.length) * 100).toFixed(1)}%</p>
          </div>
          <div className="bg-[#fab1a0] p-6 rounded-2xl border-4 border-[#2d3436] text-center">
            <p className="font-bold text-gray-700">錯誤單字</p>
            <p className="text-4xl font-black">{mistakes.length}</p>
          </div>
        </div>

        {mistakes.length > 0 && (
          <div className="mb-10">
            <h3 className="font-black text-xl mb-4 flex items-center gap-2">
              <AlertCircle size={20} /> 錯題回顧
            </h3>
            <div className="flex flex-wrap gap-2">
              {mistakes.map((m, i) => (
                <span key={i} className="bg-red-50 text-red-600 border-2 border-red-200 px-3 py-1 rounded-lg font-bold">
                  {m}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="bg-[#a29bfe]/10 p-8 rounded-2xl border-4 border-[#a29bfe] mb-10">
          <h3 className="font-black text-xl mb-4 flex items-center gap-2 text-[#6c5ce7]">
            <CheckCircle2 size={20} /> AI 學習建議
          </h3>
          {isLoadingAi ? (
            <div className="flex items-center gap-3 text-[#6c5ce7] font-bold">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-[#6c5ce7]"></div>
              正在生成個性化建議...
            </div>
          ) : (
            <div className="prose prose-slate max-w-none font-medium text-gray-800">
              <ReactMarkdown>{aiSuggestion}</ReactMarkdown>
            </div>
          )}
        </div>

        <div className="flex justify-center gap-4">
          <button 
            onClick={() => setView('home')}
            className="bg-[#2d3436] text-white font-black py-4 px-10 rounded-2xl border-4 border-[#2d3436] text-xl hover:bg-black transition-all"
          >
            返回首頁
          </button>
          <button 
            onClick={startPractice}
            className="bg-[#55efc4] text-[#2d3436] font-black py-4 px-10 rounded-2xl border-4 border-[#2d3436] text-xl hover:bg-[#00b894] transition-all"
          >
            再練一次
          </button>
        </div>
      </motion.div>
    </div>
  );

  const renderDashboard = () => {
    // 1. Dynamic filtering of sessions based on selected timeframe & student
    const filteredSessions = allSessions.filter(s => {
      // Filter by Student
      if (selectedStudentFilter !== 'all' && s.studentId !== selectedStudentFilter && s.studentName !== selectedStudentFilter) {
        return false;
      }
      
      // Filter by Timeframe
      if (dashboardTimePeriod === 'all') return true;
      
      const sessionDate = new Date(s.timestamp);
      if (isNaN(sessionDate.getTime())) return false;
      
      const now = new Date();
      if (dashboardTimePeriod === 'year') {
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(now.getFullYear() - 1);
        return sessionDate >= oneYearAgo;
      }
      if (dashboardTimePeriod === '6months') {
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(now.getMonth() - 6);
        return sessionDate >= sixMonthsAgo;
      }
      if (dashboardTimePeriod === '1month') {
        const oneMonthAgo = new Date();
        oneMonthAgo.setMonth(now.getMonth() - 1);
        return sessionDate >= oneMonthAgo;
      }
      return true;
    });

    // 2. Generate monthly progress trend data
    const monthlyTrendData = (() => {
      const groups: { [key: string]: { sumAccuracy: number; count: number } } = {};
      
      filteredSessions.forEach(s => {
        const date = new Date(s.timestamp);
        if (isNaN(date.getTime())) return;
        // Group by Year-Month (e.g., 2026-06)
        const monthKey = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
        if (!groups[monthKey]) {
          groups[monthKey] = { sumAccuracy: 0, count: 0 };
        }
        groups[monthKey].sumAccuracy += s.accuracy;
        groups[monthKey].count += 1;
      });
      
      return Object.keys(groups)
        .sort()
        .map(month => ({
          month,
          accuracy: parseFloat((groups[month].sumAccuracy / groups[month].count).toFixed(1)),
          count: groups[month].count
        }));
    })();

    // 3. Calculate mistakes dedicated to the filtered sessions
    const mistakeData = (() => {
      const counts: { [key: string]: number } = {};
      filteredSessions.forEach(s => {
        if (s.mistakes && Array.isArray(s.mistakes)) {
          s.mistakes.forEach(word => {
            if (word) {
              const w = word.toLowerCase();
              counts[w] = (counts[w] || 0) + 1;
            }
          });
        }
      });
      return Object.keys(counts)
        .map(word => ({ word, mistakeCount: counts[word] }))
        .sort((a, b) => b.mistakeCount - a.mistakeCount)
        .slice(0, 10);
    })();

    // 4. Generate dynamic progress evaluation report
    const progressReportMarkdown = (() => {
      if (monthlyTrendData.length < 2) {
        return "📊 **自動學習分析報告中...**\n\n目前累積的數據較少。需要累積至少兩個不同月份的練習紀錄，系統才能為您自動生成月度進步狀態的深度對比與學習成長趨勢。建議督促學生維持每天固定的單字練習頻率。";
      }
      
      const currentMonthData = monthlyTrendData[monthlyTrendData.length - 1];
      const prevMonthData = monthlyTrendData[monthlyTrendData.length - 2];
      const accuracyDiff = currentMonthData.accuracy - prevMonthData.accuracy;
      const countDiff = currentMonthData.count - prevMonthData.count;
      
      let text = `📅 **月度進步對比與成長分析報告**（期間：${prevMonthData.month} ➡️ ${currentMonthData.month}）：\n\n`;
      
      if (accuracyDiff > 0) {
        text += `📈 **拼字正確率大突破**：平均答題正確率由 **${prevMonthData.accuracy}%** 提升至 **${currentMonthData.accuracy}%**（顯著成長 **+${accuracyDiff.toFixed(1)}%**），這代表學生在近期單字拼寫與自然發音的連結上，取得了卓越的成效！\n\n`;
      } else if (accuracyDiff < 0) {
        text += `📉 **答題正確率微幅波動**：平均正確率由 **${prevMonthData.accuracy}%** 調整為 **${currentMonthData.accuracy}%**（波動 **${accuracyDiff.toFixed(1)}%**）。這可能是受新增的進階國中必學單字影響。調整心態後，建議與學生一同檢視下方「常錯單字排行」進行二次複習。\n\n`;
      } else {
        text += `➖ **答題成果表現平穩**：正確率穩定維持在 **${currentMonthData.accuracy}%**，拼字基底紮實，本月表現令人放心。建議可挑戰更高難度（Hard）或加快答題速度！\n\n`;
      }
      
      if (countDiff > 0) {
        text += `🔥 **學習主動性大幅攀升**：本月練習次數由之前的 **${prevMonthData.count}** 次大幅增長至 **${currentMonthData.count}** 次（增加 **+${countDiff}** 次），自主練習的熱情極高，進步值得熱烈表揚！\n\n`;
      } else if (countDiff < 0) {
        text += `💤 **練習頻率有所放緩**：本期月度練習量從之前的 **${prevMonthData.count}** 次下滑至 **${currentMonthData.count}** 次（減少 **${Math.abs(countDiff)}** 次），建議家長或導師安排更規律的練習時間，再次點燃學生的練習耐力。`;
      } else {
        text += `✨ **練習頻率維持滿格**：本期月度練習次數穩定維持在 **${currentMonthData.count}** 次，展現了極佳的毅力與定力。`;
      }
      
      return text;
    })();

    // 5. Calculate statistics for display cards
    const totalSessionsCount = filteredSessions.length;
    const averageAccuracy = totalSessionsCount > 0
      ? parseFloat((filteredSessions.reduce((acc, s) => acc + s.accuracy, 0) / totalSessionsCount).toFixed(1))
      : 0;

    return (
      <div className="max-w-6xl mx-auto px-4 py-12">
        {/* Header section with back btn */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h2 className="text-4xl font-black flex items-center gap-3">
              <LayoutDashboard size={40} className="text-[#a29bfe]" /> 教師學生追蹤後台
            </h2>
            <p className="text-gray-500 font-bold mt-1">紀錄大於一年的長效統計資訊，隨時觀測並分析學生學力與進度變化</p>
          </div>
          <button onClick={() => setView('home')} className="bg-white px-6 py-2 rounded-xl border-4 border-[#2d3436] font-black hover:bg-gray-50 transition-colors self-start md:self-auto">
            返回首頁
          </button>
        </div>

        {/* Filters Controls block */}
        <div className="bg-white p-6 rounded-3xl border-4 border-[#2d3436] shadow-[8px_8px_0px_0px_#2d3436] mb-8 flex flex-wrap gap-6 items-center">
          <div className="flex items-center gap-2">
            <span className="font-black text-lg text-[#2d3436]">時間範圍:</span>
            <select 
              value={dashboardTimePeriod}
              onChange={(e) => setDashboardTimePeriod(e.target.value as any)}
              className="p-2 border-2 border-[#2d3436] rounded-xl font-bold focus:outline-none bg-[#ffeaa7]"
            >
              <option value="year">📅 過去一年</option>
              <option value="6months">📅 過去半年</option>
              <option value="1month">📅 過去一個月</option>
              <option value="all">🌐 全部歷史紀錄</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-black text-lg text-[#2d3436]">選擇學員:</span>
            <select 
              value={selectedStudentFilter}
              onChange={(e) => setSelectedStudentFilter(e.target.value)}
              className="p-2 border-2 border-[#2d3436] rounded-xl font-bold focus:outline-none bg-[#81ecec]"
            >
              <option value="all">👥 所有學生 (統計總覽)</option>
              {allStudents.map(s => (
                <option key={s.id || s.name} value={s.id || s.name}>👤 {s.name}</option>
              ))}
            </select>
          </div>

          {selectedStudentFilter !== 'all' && (
            <button 
              onClick={() => setSelectedStudentFilter('all')}
              className="px-3 py-1 bg-gray-100 font-bold border-2 border-[#2d3436] rounded-lg text-sm hover:bg-gray-200 transition-colors"
            >
              清除學員篩選
            </button>
          )}
        </div>

        {/* Highlight statistics cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-10">
          <div className="bg-white p-6 rounded-2xl border-4 border-[#2d3436] shadow-[8px_8px_0px_0px_#2d3436]">
            <Users className="mb-2 text-[#a29bfe]" size={28} />
            <p className="text-gray-500 font-bold">總註冊學生</p>
            <p className="text-3xl font-black">{allStudents.length} 人</p>
          </div>
          <div className="bg-white p-6 rounded-2xl border-4 border-[#2d3436] shadow-[8px_8px_0px_0px_#2d3436]">
            <BarChart3 className="mb-2 text-[#55efc4]" size={28} />
            <p className="text-gray-500 font-bold">篩選區間練習量</p>
            <p className="text-3xl font-black">{totalSessionsCount} 次</p>
          </div>
          <div className="bg-white p-6 rounded-2xl border-4 border-[#2d3436] shadow-[8px_8px_0px_0px_#2d3436]">
            <CheckCircle2 className="mb-2 text-[#81ecec]" size={28} />
            <p className="text-gray-500 font-bold">篩選區間平均正確率</p>
            <p className="text-3xl font-black">{averageAccuracy}%</p>
          </div>
          <div className="bg-white p-6 rounded-2xl border-4 border-[#2d3436] shadow-[8px_8px_0px_0px_#2d3436]">
            <AlertCircle className="mb-2 text-[#fab1a0]" size={28} />
            <p className="text-gray-500 font-bold">當前高頻常錯單字</p>
            <p className="text-3xl font-black">{mistakeData.length} 個</p>
          </div>
        </div>

        {/* Double charts section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 mb-10">
          <div className="bg-white p-8 rounded-3xl border-4 border-[#2d3436] shadow-[12px_12px_0px_0px_#2d3436]">
            <h3 className="font-black text-xl mb-6 flex items-center gap-2">
              📈 月度答題正確率進步曲線 ({selectedStudentFilter === 'all' ? '全體學生' : '個人趨勢'})
            </h3>
            <div className="h-80">
              {monthlyTrendData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={monthlyTrendData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis domain={[0, 100]} />
                    <Tooltip formatter={(value) => [`${value}%`, '平均正確率']} />
                    <Line type="monotone" dataKey="accuracy" stroke="#a29bfe" strokeWidth={5} dot={{ r: 6, fill: '#ff4757' }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center font-bold text-gray-400">
                  此篩選區間暫無練習數據
                </div>
              )}
            </div>
          </div>

          <div className="bg-white p-8 rounded-3xl border-4 border-[#2d3436] shadow-[12px_12px_0px_0px_#2d3436]">
            <h3 className="font-black text-xl mb-6 flex items-center gap-2">
              📊 月度練習次數趨勢統計 ({selectedStudentFilter === 'all' ? '全體學生' : '個人練習量'})
            </h3>
            <div className="h-80">
              {monthlyTrendData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyTrendData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis />
                    <Tooltip formatter={(value) => [`${value} 次`, '練習次數']} />
                    <Bar dataKey="count" fill="#55efc4" radius={[6, 6, 0, 0]} border-2 border-black />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center font-bold text-gray-400">
                  此篩選區間暫無練習數據
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Dynamic Analytics report */}
        <div className="bg-amber-50 p-8 rounded-3xl border-4 border-[#2d3436] shadow-[8px_8px_0px_0px_#2d3436] mb-10">
          <h3 className="font-black text-2xl mb-4 text-[#d63031] flex items-center gap-2">
            💡 系統智能學習進步分析精簡報告
          </h3>
          <div className="prose prose-slate max-w-none text-gray-800 font-medium">
            <ReactMarkdown>{progressReportMarkdown}</ReactMarkdown>
          </div>
        </div>

        {/* Detailed Mistake ranking */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
          <div className="lg:col-span-1 bg-white p-8 rounded-3xl border-4 border-[#2d3436] shadow-[12px_12px_0px_0px_#2d3436]">
            <h3 className="font-black text-xl mb-6 text-[#ff4757]">⚠️ 拼字待加強高頻單字</h3>
            <div className="space-y-4">
              {mistakeData.length > 0 ? (
                mistakeData.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3 bg-red-50/50 rounded-xl border-2 border-[#2d3436] font-bold">
                    <span className="text-[#2d3436] font-black text-lg">{idx + 1}. {item.word}</span>
                    <span className="bg-[#ff4757] text-white px-2.5 py-0.5 rounded-full text-sm">錯 {item.mistakeCount} 次</span>
                  </div>
                ))
              ) : (
                <p className="text-gray-400 font-bold text-center py-10">此篩選區間學生拼字正確率近乎完美，無高頻錯字紀錄！</p>
              )}
            </div>
          </div>

          <div className="lg:col-span-2 bg-white p-8 rounded-3xl border-4 border-[#2d3436] shadow-[12px_12px_0px_0px_#2d3436]">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <h3 className="font-black text-xl">👥 學生進度總覽資訊</h3>
              <p className="text-sm font-bold text-gray-500">*點擊學生欄位，可以直接開啟該學員的個人分析報告與進步曲線!</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b-4 border-[#2d3436]">
                    <th className="pb-4 font-black text-[#2d3436]">姓名</th>
                    <th className="pb-4 font-black text-[#2d3436]">最後活躍日期</th>
                    <th className="pb-4 font-black text-[#2d3436]">累積練習量</th>
                    <th className="pb-4 font-black text-[#2d3436]">平均正确率</th>
                  </tr>
                </thead>
                <tbody>
                  {allStudents.map((s, i) => (
                    <tr 
                      key={i} 
                      onClick={() => setSelectedStudentFilter(s.id || s.name)}
                      className={`border-b-2 border-gray-100 hover:bg-[#ffeaa7]/30 cursor-pointer transition-colors ${selectedStudentFilter === (s.id || s.name) ? 'bg-[#ffeaa7]/50' : ''}`}
                    >
                      <td className="py-4 font-black text-[#2d3436] flex items-center gap-1.5">
                        👤 {s.name}
                        {selectedStudentFilter === (s.id || s.name) && <span className="text-xs text-[#ff4757]">● 觀測中</span>}
                      </td>
                      <td className="py-4 text-gray-600 font-bold">{new Date(s.lastActive).toLocaleDateString()}</td>
                      <td className="py-4 font-black text-[#2d3436]">{s.totalSessions} 次</td>
                      <td className="py-4">
                        <span className={`px-3 py-1 rounded-full font-black border-2 border-[#2d3436] ${s.averageAccuracy >= 85 ? 'bg-green-100 text-green-700' : s.averageAccuracy >= 65 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
                          {s.averageAccuracy.toFixed(1)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                  {allStudents.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-gray-400 font-bold">
                        目前尚無註冊學生數據
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen font-sans">
      <AnimatePresence mode="wait">
        {view === 'home' && renderHome()}
        {view === 'practice' && renderPractice()}
        {view === 'result' && renderResult()}
        {view === 'dashboard' && renderDashboard()}
      </AnimatePresence>
    </div>
  );
}

