export type Difficulty = 'low' | 'medium' | 'high';

export interface Word {
  word: string;
  chinese: string;
  pos: string; // Part of speech
  grade: number; // 3, 4, 5, 6
}

export interface Student {
  id?: string;
  name: string;
  lastActive: string;
  totalSessions: number;
  averageAccuracy: number;
}

export interface Session {
  id?: string;
  studentId: string;
  studentName: string;
  timestamp: string;
  difficulty: Difficulty;
  grade: string;
  score: number;
  totalWords: number;
  accuracy: number;
  mistakes: string[];
}

export interface WordStat {
  word: string;
  mistakeCount: number;
  attemptCount: number;
}
