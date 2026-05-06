// =====================================================
// Firebase 설정 파일 (업데이트 완료)
// =====================================================

import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyCFwvKTiJj8EM9u2zp3RqLP4TFq0XtDYCs",
  authDomain: "attmirae.firebaseapp.com",
  projectId: "attmirae",
  storageBucket: "attmirae.firebasestorage.app",
  messagingSenderId: "688051685207",
  appId: "1:688051685207:web:43a9339e99e32f73406012",
  measurementId: "G-N71J3BEKKL"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
