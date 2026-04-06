// =====================================================
// Firebase 설정 파일
// Firebase 콘솔(https://console.firebase.google.com)에서
// 프로젝트 설정 > 일반 > 내 앱 에서 SDK 구성을 복사해 붙여넣으세요.
// =====================================================

import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
