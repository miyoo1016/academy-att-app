import BackgroundService from 'react-native-background-actions';
import { Platform } from 'react-native';
import { collection, query, where, onSnapshot, doc, updateDoc, getDocs } from 'firebase/firestore';
import { db } from '../config/firebase';
import { buildCheckinMessage, buildCheckoutMessage, sendAttendanceSMS } from '../utils/smsUtils';
import { formatDateForDB } from '../utils/timeUtils';

const sleep = (time) => new Promise((resolve) => setTimeout(() => resolve(), time));

const processedIds = new Set();
let unsubscribeSnapshot = null;
let isStarted = false; // 중복 초기화 방지

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
        // 발송 실패 시 다음에 다시 시도할 수 있도록 Set에서 제거
        processedIds.add(data.id); // 일단 추가된 상태 유지 (중복 발송 방지 우선)
        // 실제로는 실패 시 재시도 로직이 필요할 수 있으나, 여기서는 안전을 위해 Set 유지
      }
    } else {
      // 폰 번호가 없을 땐 바로 처리 플래그만 켬
      try {
        await updateDoc(doc(db, 'attendance', data.id), { processed: true });
      } catch (e) {}
    }
  }
};

const backgroundTask = async (taskDataArguments) => {
  const { delay } = taskDataArguments;

  // 네이티브 모듈 및 브릿지 초기화 대기
  await sleep(1500);

  const attRef = collection(db, 'attendance');
  const q = query(attRef, where('processed', '==', false));

  // 1. 실시간 리스너 설정
  if (unsubscribeSnapshot) {
    unsubscribeSnapshot();
  }

  unsubscribeSnapshot = onSnapshot(q, (snapshot) => {
    snapshot.docChanges().forEach(async (change) => {
      if (change.type === 'added' || change.type === 'modified') {
        await processRecord({ id: change.doc.id, ...change.doc.data() });
      }
    });
  });

  // 2. 무한 루프 (주기적 폴링 폴백 포함)
  await new Promise(async (resolve) => {
    for (let i = 0; BackgroundService.isRunning(); i++) {
        // 약 30초마다(i%10, delay=3000) 강제 데이터 조회 실행
        // onSnapshot이 잠들었을 경우를 대비한 안전장치
        if (i > 0 && i % 10 === 0) {
          try {
            console.log(`[Background] Polling Fallback Check (#${i})`);
            const snapshot = await getDocs(q);
            for (const d of snapshot.docs) {
              await processRecord({ id: d.id, ...d.data() });
            }
          } catch (e) {
            console.error('[Background] Polling error:', e);
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
  taskName: 'AcademySmsTask',
  taskTitle: '[미래학원] 출결 문자 자동발송',
  taskDesc: '백그라운드에서 실시간 출결 현황을 감시 중입니다.',
  taskIcon: {
    name: 'ic_launcher', // 확실히 존재하는 아이콘명으로 원복
    type: 'mipmap',
  },
  color: '#C62828',
  linkingURI: 'com.mirae.academyatt://', // 알림 터치 시 앱으로 복귀
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
