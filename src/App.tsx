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
      const qSessions = query(collection(db, 'sessions'), orderBy('timestamp', 'desc'), limit(100));
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
        setErrorMessage("此網域尚未在 Firebase 中獲得授權，請聯繫管理員。");
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
          // Strict case sensitivity and space check
          if (userInput === sessionWords[currentIndex].word) {
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
    const accuracyData = allSessions.slice(0, 20).reverse().map(s => ({
      name: s.studentName,
      accuracy: s.accuracy,
      date: new Date(s.timestamp).toLocaleDateString()
    }));

    const mistakeData = wordStats.slice(0, 10);

    const difficultyDist = [
      { name: 'Low', value: allSessions.filter(s => s.difficulty === 'low').length },
      { name: 'Medium', value: allSessions.filter(s => s.difficulty === 'medium').length },
      { name: 'High', value: allSessions.filter(s => s.difficulty === 'high').length },
    ];

    const COLORS = ['#81ecec', '#ffeaa7', '#fab1a0'];

    return (
      <div className="max-w-6xl mx-auto px-4 py-12">
        <div className="flex justify-between items-center mb-8">
          <h2 className="text-4xl font-black flex items-center gap-3">
            <LayoutDashboard size={40} /> 教師儀表板
          </h2>
          <button onClick={() => setView('home')} className="bg-white px-6 py-2 rounded-xl border-4 border-[#2d3436] font-black">
            返回
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-10">
          <div className="bg-white p-6 rounded-2xl border-4 border-[#2d3436] shadow-[8px_8px_0px_0px_#2d3436]">
            <Users className="mb-2 text-[#a29bfe]" />
            <p className="text-gray-500 font-bold">總學生數</p>
            <p className="text-3xl font-black">{allStudents.length}</p>
          </div>
          <div className="bg-white p-6 rounded-2xl border-4 border-[#2d3436] shadow-[8px_8px_0px_0px_#2d3436]">
            <BarChart3 className="mb-2 text-[#55efc4]" />
            <p className="text-gray-500 font-bold">總練習次數</p>
            <p className="text-3xl font-black">{allSessions.length}</p>
          </div>
          <div className="bg-white p-6 rounded-2xl border-4 border-[#2d3436] shadow-[8px_8px_0px_0px_#2d3436]">
            <CheckCircle2 className="mb-2 text-[#81ecec]" />
            <p className="text-gray-500 font-bold">平均正確率</p>
            <p className="text-3xl font-black">
              {(allSessions.reduce((acc, s) => acc + s.accuracy, 0) / (allSessions.length || 1)).toFixed(1)}%
            </p>
          </div>
          <div className="bg-white p-6 rounded-2xl border-4 border-[#2d3436] shadow-[8px_8px_0px_0px_#2d3436]">
            <AlertCircle className="mb-2 text-[#fab1a0]" />
            <p className="text-gray-500 font-bold">待加強單字</p>
            <p className="text-3xl font-black">{wordStats.filter(w => w.mistakeCount > 5).length}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 mb-10">
          <div className="bg-white p-8 rounded-3xl border-4 border-[#2d3436] shadow-[12px_12px_0px_0px_#2d3436]">
            <h3 className="font-black text-xl mb-6">近期練習正確率趨勢</h3>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={accuracyData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="accuracy" stroke="#a29bfe" strokeWidth={4} dot={{ r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white p-8 rounded-3xl border-4 border-[#2d3436] shadow-[12px_12px_0px_0px_#2d3436]">
            <h3 className="font-black text-xl mb-6">常錯單字排行</h3>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={mistakeData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="word" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="mistakeCount" fill="#fab1a0" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="bg-white p-8 rounded-3xl border-4 border-[#2d3436] shadow-[12px_12px_0px_0px_#2d3436]">
          <h3 className="font-black text-xl mb-6">學生進度總覽</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b-4 border-[#2d3436]">
                  <th className="pb-4 font-black">姓名</th>
                  <th className="pb-4 font-black">最後活動</th>
                  <th className="pb-4 font-black">練習次數</th>
                  <th className="pb-4 font-black">平均正確率</th>
                </tr>
              </thead>
              <tbody>
                {allStudents.map((s, i) => (
                  <tr key={i} className="border-b-2 border-gray-100 hover:bg-gray-50">
                    <td className="py-4 font-bold">{s.name}</td>
                    <td className="py-4 text-gray-600">{new Date(s.lastActive).toLocaleString()}</td>
                    <td className="py-4 font-black">{s.totalSessions}</td>
                    <td className="py-4">
                      <span className={`px-3 py-1 rounded-full font-bold ${s.averageAccuracy > 80 ? 'bg-green-100 text-green-600' : 'bg-orange-100 text-orange-600'}`}>
                        {s.averageAccuracy.toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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

