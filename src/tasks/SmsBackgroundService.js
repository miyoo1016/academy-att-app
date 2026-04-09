import BackgroundService from 'react-native-background-actions';
import { Platform } from 'react-native';
import { collection, query, where, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { buildCheckinMessage, buildCheckoutMessage, sendAttendanceSMS } from '../utils/smsUtils';
import { formatDateForDB } from '../utils/timeUtils';

const sleep = (time) => new Promise((resolve) => setTimeout(() => resolve(), time));

const processedIds = new Set();
let unsubscribeSnapshot = null;
let isStarted = false; // 중복 초기화 방지

const backgroundTask = async (taskDataArguments) => {
  const { delay } = taskDataArguments;

  // 네이티브 모듈 및 브릿지 초기화 대기
  await sleep(1000);

  const attRef = collection(db, 'attendance');
  const q = query(attRef, where('processed', '==', false));

  // 기존 구독이 있다면 먼저 종료 (안전장치)
  if (unsubscribeSnapshot) {
    unsubscribeSnapshot();
  }

  unsubscribeSnapshot = onSnapshot(q, (snapshot) => {
    snapshot.docChanges().forEach(async (change) => {
      // 신규 추가(added) 또는 기존 문서의 상태 변경(modified - 미처리가 되었을 경우) 대응
      if (change.type === 'added' || change.type === 'modified') {
        const data = { id: change.doc.id, ...change.doc.data() };
        
        // 미처리고 처음 보는 id인 경우만 발송 시도
        if (!data.processed && !processedIds.has(data.id)) {
          processedIds.add(data.id);
          
          const phones = data.parentPhones || [];
          if (phones.length > 0) {
            const msg = data.type === 'checkin'
              ? buildCheckinMessage(data.studentName, data.time)
              : buildCheckoutMessage(data.studentName, data.time);
            
            const sent = await sendAttendanceSMS(phones, msg);
            if (sent) {
              try {
                await updateDoc(doc(db, 'attendance', data.id), { processed: true });
              } catch (e) {
                console.error('[Background] processed 업데이트 오류:', e);
              }
            }
          } else {
             // 폰 번호가 없을 땐 바로 처리 플래그만 켬
             try {
                await updateDoc(doc(db, 'attendance', data.id), { processed: true });
             } catch (e) {}
          }
        }
      }
    });
  });

  // 백그라운드 태스크가 앱 종료 등에 의해 멈출 때까지 무한 대기
  await new Promise(async (resolve) => {
    for (let i = 0; BackgroundService.isRunning(); i++) {
        await sleep(delay);
    }
    // 루프가 끝나면(정지 요청 시) 구독 해제
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
