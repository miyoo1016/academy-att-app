import BackgroundService from 'react-native-background-actions';
import { Platform } from 'react-native';
import { 
  collection, query, where, onSnapshot, doc, updateDoc, 
  getDocs, setDoc, serverTimestamp, getDoc 
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { buildCheckinMessage, buildCheckoutMessage, sendAttendanceSMS } from '../utils/smsUtils';

const sleep = (time) => new Promise((resolve) => setTimeout(() => resolve(), time));

/**
 * 프로젝트의 절대적인 기동성을 위해 
 * Firebase 요청에 타임아웃을 거는 래퍼 함수 (15초 제한)
 */
const withTimeout = (promise, ms = 15000) => {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('TIMEOUT')), ms)
  );
  return Promise.race([promise, timeout]);
};

const processedIds = new Set();
let unsubscribeSnapshot = null;
let lastHeartbeatTime = 0;
let lastResetTime = Date.now();
const HEARTBEAT_INTERVAL = 5 * 60 * 1000;  // 5분으로 단축 (더 잦은 활성 유지)
const RESET_INTERVAL = 60 * 60 * 1000;    // 1시간

const sendHeartbeat = async () => {
  try {
    console.log('[Background] Attempting heartbeat...');
    const statusRef = doc(db, 'service_status', 'main_terminal');
    await withTimeout(setDoc(statusRef, {
      lastActive: serverTimestamp(),
      platform: Platform.OS,
      updatedAt: new Date().toISOString(),
      status: 'running',
      loopCount: global.loopCount || 0
    }, { merge: true }));
    lastHeartbeatTime = Date.now();
    console.log('[Background] Heartbeat sent successfully.');
  } catch (e) {
    console.error('[Background] Heartbeat error:', e.message);
    // 타임아웃이나 에러 시에도 루프가 멈추지 않도록 다음엔 그냥 넘어감
  }
};

const initSnapshotListener = (q) => {
  if (unsubscribeSnapshot) {
    unsubscribeSnapshot();
  }

  console.log('[Background] Initializing Firestore Snapshot Listener...');
  unsubscribeSnapshot = onSnapshot(q, (snapshot) => {
    snapshot.docChanges().forEach(async (change) => {
      if (change.type === 'added' || change.type === 'modified') {
        await processRecord({ id: change.doc.id, ...change.doc.data() });
      }
    });
  }, (err) => {
    console.error('[Background] Snapshot listener error:', err);
  });
};

const processRecord = async (data) => {
  // 미처리고 처음 보는 id인 경우만 발송 시도
  if (!data.processed && !processedIds.has(data.id)) {
    processedIds.add(data.id);
    
    const phones = data.parentPhones || [];
    if (phones.length > 0) {
      const msg = data.type === 'checkin'
        ? buildCheckinMessage(data.studentName, data.time)
        : buildCheckoutMessage(data.studentName, data.time);
      
      console.log(`[Background] Sending SMS for ${data.studentName}...`);
      const sent = await sendAttendanceSMS(phones, msg);
      if (sent) {
        try {
          await updateDoc(doc(db, 'attendance', data.id), { processed: true });
        } catch (e) {
          console.error('[Background] processed 업데이트 오류:', e);
        }
      } else {
        // 발송 실패 시 나중에 다시 시도할 수 있도록 Set에서 한시적 보관 후 제거하는 등의 로직 가능
        // 현재는 중복 발송 방지를 위해 유지
      }
    } else {
      try {
        await updateDoc(doc(db, 'attendance', data.id), { processed: true });
      } catch (e) {}
    }
  }
};

const backgroundTask = async (taskDataArguments) => {
  const { delay } = taskDataArguments;
  global.loopCount = 0;

  // 초기 지연 (시스템 안정화 대기)
  await sleep(2000);

  const attRef = collection(db, 'attendance');
  const q = query(attRef, where('processed', '==', false));

  // 1. 초기 하트비트 및 리스너 설정
  await sendHeartbeat();
  initSnapshotListener(q);

  // 2. 무한 루프 (주기적 폴링 및 유지관리)
  await new Promise(async (resolve) => {
    for (let i = 0; BackgroundService.isRunning(); i++) {
        global.loopCount = i;
        const now = Date.now();

        // [기능 1] 하트비트 (15분마다)
        if (now - lastHeartbeatTime > HEARTBEAT_INTERVAL) {
          await sendHeartbeat();
        }

        // [기능 2] 리스너 재설정 (1시간마다) 
        if (now - lastResetTime > RESET_INTERVAL) {
          console.log('[Background] Periodic Reset: Re-initializing listeners...');
          initSnapshotListener(q);
          lastResetTime = now;
          
          const hours = new Date().getHours();
          if (hours === 4) {
            console.log('[Background] Daily Cleanup: Clearing processed cache');
            processedIds.clear();
          }
        }

        // [기능 3] 폴링 폴백 (약 30초마다) - 타임아웃 추가로 무한대기 방지
        if (i > 0 && i % 10 === 0) {
          try {
            console.log(`[Background] Polling Fallback Check (#${i})`);
            const snapshot = await withTimeout(getDocs(q));
            for (const d of snapshot.docs) {
              await processRecord({ id: d.id, ...d.data() });
            }
          } catch (e) {
            console.error('[Background] Polling/Process error:', e.message);
          }
        }

        await sleep(delay);
    }
    
    if (unsubscribeSnapshot) {
      unsubscribeSnapshot();
      unsubscribeSnapshot = null;
    }
    resolve();
  });
};


const options = {
  taskName: 'AcademySmsTaskV2',
  taskTitle: '[미래학원] 상시 출결 감시 중',
  taskDesc: '실시간으로 출결을 감시하며 SMS를 발송하고 있습니다.',
  taskIcon: {
    name: 'ic_launcher',
    type: 'mipmap',
  },
  color: '#C62828',
  linkingURI: 'com.mirae.academyatt://',
  parameters: {
    delay: 3000,
  },
};

export const startSmsBackgroundService = async () => {
  if (Platform.OS !== 'android') return;
  try {
    if (!BackgroundService.isRunning()) {
      await BackgroundService.start(backgroundTask, options);
      console.log('Background SMS service started successfully.');
    } else {
      console.log('Background service is already running.');
    }
  } catch (e) {
    console.error('Error starting bg service', e);
  }
};

export const stopSmsBackgroundService = async () => {
  if (Platform.OS !== 'android') return;
  try {
    if (BackgroundService.isRunning()) {
      if (unsubscribeSnapshot) {
        unsubscribeSnapshot();
        unsubscribeSnapshot = null;
      }
      await BackgroundService.stop();
      console.log('Background SMS service stopped.');
    }
  } catch (e) {
    console.error('Error stopping bg service', e);
  }
};

