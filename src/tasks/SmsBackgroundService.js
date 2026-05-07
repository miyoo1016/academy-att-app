import BackgroundService from 'react-native-background-actions';
import { Platform } from 'react-native';
import {
  collection, query, where, doc, updateDoc,
  getDocs, setDoc, serverTimestamp, getDoc,
  enableNetwork, disableNetwork, getDocsFromServer
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { buildCheckinMessage, buildCheckoutMessage, buildBirthdayMessage, sendAttendanceSMS } from '../utils/smsUtils';
import { pingHeartbeat } from '../utils/NativeHeartbeat';

const sleep = (time) => new Promise((resolve) => setTimeout(resolve, time));

/**
 * Firebase 요청에 타임아웃을 거는 래퍼
 */
const withTimeout = (promise, ms = 15000) => {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('TIMEOUT')), ms)
  );
  return Promise.race([promise, timeout]);
};

// ─────────────────────────────────────────────────────────────────
// 전역 상태
// ─────────────────────────────────────────────────────────────────
const processedIds = new Set();
let lastHeartbeatTime    = 0;
let lastResetTime        = Date.now();
let lastBirthdayCheckDate = '';

// ── 핵심 타이머 설정 (FCM 도입으로 대폭 완화했으나, 안정성을 위해 단축) ──────────────────────
const HEARTBEAT_INTERVAL  = 10 * 60 * 1000;   // 10분마다 Firebase 생존 신호
const POLLING_INTERVAL    = 30 * 1000;        // 30초마다 폴링 (FCM 실패 시 빠른 대응)
const RESET_INTERVAL      = 60 * 60 * 1000;   // 1시간마다 리스너/상태 리셋

// ─────────────────────────────────────────────────────────────────
// 하트비트 (Firebase에 생존 신호 + 네이티브 SharedPreferences ping)
// ─────────────────────────────────────────────────────────────────
const sendHeartbeat = async () => {
  try {
    const statusRef = doc(db, 'service_status', 'main_terminal');
    const tokenDoc = await getDoc(doc(db, 'device_tokens', 'main_phone'));
    const tokenData = tokenDoc.exists() ? tokenDoc.data() : {};

    await withTimeout(setDoc(statusRef, {
      lastActive: serverTimestamp(),
      platform: Platform.OS,
      updatedAt: new Date().toISOString(),
      status: 'running_fcm_hybrid',
      fcmTokenSnippet: tokenData.token ? tokenData.token.substring(0, 10) + '...' : 'MISSING',
      tokenUpdatedAt: tokenData.updatedAt || null
    }, { merge: true }));
    lastHeartbeatTime = Date.now();
  } catch (e) {
    console.error('[BgService] Heartbeat error:', e.message);
  }
};

// ─────────────────────────────────────────────────────────────────
// 폴링 폴백 (최종 방어선)
// ─────────────────────────────────────────────────────────────────
const runPollingFallback = async (q) => {
  try {
    console.log('[BgService] 폴링 실행 (FCM 미발송분 체크)...');
    const snapshot = await withTimeout(getDocsFromServer(q), 20000);

    for (const d of snapshot.docs) {
       // FCM이 이미 처리했을 것이므로, 여기서 다시 처리되더라도 processRecord 에서 processed 필드 체크함
       const data = d.data();
       if (!data.processed) {
          // JS에서도 문자를 보낼 수 있게 유지 (이중 안전장치)
          const msg = data.type === 'checkin'
            ? buildCheckinMessage(data.studentName, data.time)
            : buildCheckoutMessage(data.studentName, data.time);
          
          const phones = data.parentPhones || [];
          if (phones.length > 0) {
             const sent = await sendAttendanceSMS(phones, msg, true);
             if (sent) {
                await updateDoc(doc(db, 'attendance', d.id), { processed: true });
             }
          }
       }
    }
  } catch (e) {
    console.error('[BgService] 폴링 실패:', e.message);
  }
};

// ─────────────────────────────────────────────────────────────────
// 생일 체크 (하루 1회)
// ─────────────────────────────────────────────────────────────────
const checkBirthdaysDaily = async () => {
  const now = new Date();
  if (now.getHours() < 9 || now.getHours() > 21) return;

  const todayStr = now.toISOString().split('T')[0];
  if (lastBirthdayCheckDate === todayStr) return;

  try {
    const logRef = doc(db, 'birthday_logs', todayStr);
    const logSnap = await getDoc(logRef);
    if (logSnap.exists()) { lastBirthdayCheckDate = todayStr; return; }

    const month = now.getMonth() + 1;
    const day   = now.getDate();
    const q = query(collection(db, 'students'),
      where('birthMonth', '==', month),
      where('birthDay',   '==', day),
      where('isActive',   '==', true)
    );

    const snapshot = await getDocs(q);
    let sentCount = 0;

    for (const studentDoc of snapshot.docs) {
      const student = studentDoc.data();
      const msg = buildBirthdayMessage(student.name);
      const phones = [];
      if (student.phone) phones.push(student.phone);
      student.parents?.forEach(p => { if (p.phone) phones.push(p.phone); });
      if (phones.length > 0) {
        await sendAttendanceSMS(phones, msg, true);
        sentCount++;
      }
    }

    await setDoc(logRef, { checked: true, sentCount, timestamp: serverTimestamp() });
    lastBirthdayCheckDate = todayStr;
    console.log(`[BgService] 생일 체크 완료: ${sentCount}`);
  } catch (e) {
    console.error('[BgService] 생일 체크 오류:', e.message);
  }
};

// ─────────────────────────────────────────────────────────────────
// 메인 백그라운드 태스크
// ─────────────────────────────────────────────────────────────────
const backgroundTask = async (taskDataArguments) => {
  const { delay } = taskDataArguments;
  const attRef = collection(db, 'attendance');
  const q = query(attRef, where('processed', '==', false));

  await sendHeartbeat();

  for (let i = 0; BackgroundService.isRunning(); i++) {
    const now = Date.now();

    // 1. 네이티브 하트비트 (Watchdog용)
    pingHeartbeat();

    // 2. Firebase 하트비트 (15분)
    if (now - lastHeartbeatTime > HEARTBEAT_INTERVAL) {
      await sendHeartbeat();
    }

    // 3. 폴링 폴백 (시작 즉시 1회 + 10분마다)
    if (i === 0 || (i > 0 && (i * delay) % POLLING_INTERVAL < delay)) {
      await runPollingFallback(q);
      await checkBirthdaysDaily();
    }

    // 4. 상태 초기화 (1시간)
    if (now - lastResetTime > RESET_INTERVAL) {
      processedIds.clear();
      lastResetTime = now;
    }

    await sleep(delay);
  }
};

const options = {
  taskName: 'AcademyFcmHybridV1',
  taskTitle: '[미래학원] SMS 서버 정상 가동 중',
  taskDesc: '24시간 출결 감시 중 (지우지 마세요)',
  taskIcon: { name: 'ic_launcher', type: 'mipmap' },
  color: '#2E7D32',
  parameters: { delay: 10000 },
};

export const startSmsBackgroundService = async () => {
  if (Platform.OS !== 'android') return;
  try {
    if (!BackgroundService.isRunning()) {
      await BackgroundService.start(backgroundTask, options);
      console.log('[BgService] FCM 하이브리드 서비스 시작');
    }
  } catch (e) {
    console.error('[BgService] 서비스 시작 실패:', e);
  }
};

export const stopSmsBackgroundService = async () => {
  if (Platform.OS !== 'android') return;
  try {
    if (BackgroundService.isRunning()) {
      await BackgroundService.stop();
    }
  } catch (e) {
    console.error('[BgService] 서비스 중지 실패:', e);
  }
};
