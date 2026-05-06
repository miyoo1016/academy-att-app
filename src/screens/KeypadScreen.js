import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, StatusBar,
  SafeAreaView, Vibration, Modal, FlatList, Alert, Platform, useWindowDimensions
} from 'react-native';
import {
  collection, addDoc, query, where, getDocs, orderBy,
  serverTimestamp, doc, getDoc, onSnapshot, updateDoc
} from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { db } from '../config/firebase';
import { formatTimeForSMS, formatDateForDB, formatClockDisplay, formatDateKorean } from '../utils/timeUtils';
import { buildCheckinMessage, buildCheckoutMessage, sendAttendanceSMS } from '../utils/smsUtils';

const BLUE = '#1565C0';

const PAD_KEYS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['C', '0', 'OK'],
];

export default function KeypadScreen() {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height && width > 768; // 태블릿 가로 모드 기준

  const [input, setInput] = useState('');
  const [currentTime, setCurrentTime] = useState(new Date());
  const [statusMsg, setStatusMsg] = useState({ text: '', type: '' }); // type: 'success' | 'error'
  const [isProcessing, setIsProcessing] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [todayLog, setTodayLog] = useState([]);
  const [allStudents, setAllStudents] = useState([]); // 로컬 학생 캐시
  const lastEntryRef = useRef({ pin: '', time: 0 });
  const isProcessingRef = useRef(false);
  const statusTimer = useRef(null);
  const logTimer = useRef(null);

  // 0. 학생 명단 실시간 동기화 (반응 속도 및 최신화 유지)
  useEffect(() => {
    const studentsRef = collection(db, 'students');
    const q = query(studentsRef, where('isActive', '==', true));
    
    // onSnapshot을 사용하여 학생 명단이 변경될 때마다 자동으로 로컬 캐시 갱신
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = [];
      snapshot.forEach(doc => {
        list.push({ id: doc.id, ...doc.data() });
      });
      setAllStudents(list);
      console.log(`Updated local cache: ${list.length} students.`);
    }, (error) => {
      console.error('학생 명단 실시간 동기화 실패:', error);
      Alert.alert('통신 오류', '서버와 연결이 원활하지 않습니다. 인터넷 상태를 확인해 주세요.');
    });

    return () => unsubscribe();
  }, []);







  // 1. 시계 타이머
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // 2. 웹 브라우저 화면 꺼짐 방지 (Wake Lock)
  useEffect(() => {
    let wakeLock = null;

    const requestWakeLock = async () => {
      if (Platform.OS === 'web' && 'wakeLock' in navigator) {
        try {
          wakeLock = await navigator.wakeLock.request('screen');
          console.log('Wake Lock is active');
        } catch (err) {
          console.error(`Wake Lock Error: ${err.name}, ${err.message}`);
        }
      }
    };

    requestWakeLock();

    const handleVisibilityChange = () => {
      if (wakeLock !== null && document.visibilityState === 'visible') {
        requestWakeLock();
      }
    };

    if (Platform.OS === 'web') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      if (wakeLock !== null) {
        wakeLock.release().then(() => { wakeLock = null; });
      }
      if (Platform.OS === 'web') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, []);

  const showStatus = (text, type = 'success') => {
    if (statusTimer.current) clearTimeout(statusTimer.current);
    setStatusMsg({ text, type });
    statusTimer.current = setTimeout(() => setStatusMsg({ text: '', type: '' }), 3500);
  };

  const handlePress = (key) => {
    if (isProcessingRef.current || isProcessing) return;
    if (key === 'C') {
      setInput('');
    } else if (key === 'OK') {
      if (input.length === 4) handleSubmit();
    } else {
      if (input.length < 4) setInput(prev => prev + key);
    }
  };

  const handleSubmit = async () => {
    if (isProcessingRef.current || isProcessing || input.length !== 4) return;

    // 10초 이내 동일 번호 입력 방지
    const now = Date.now();
    if (input === lastEntryRef.current.pin && (now - lastEntryRef.current.time) < 10000) {
      showStatus('이미 처리되었습니다. (10초 대기)', 'error');
      setInput('');
      return;
    }

    // 즉각적인 중복 실행 및 동일 번호 입력 방지 (서버 통신 대기시간 이전)
    isProcessingRef.current = true;
    lastEntryRef.current = { pin: input, time: now };
    setIsProcessing(true);

    try {
    // 1. 로컬 캐시에서 학생 즉시 찾기 (네트워크 지연 제거)
    console.log(`[Keypad] 검색 시작... 입력 PIN: ${input}, 전체 학생 수: ${allStudents.length}명`);
    
    if (allStudents.length === 0) {
      showStatus('학생 명단을 불러오는 중입니다. 잠시 후 다시 시도해 주세요.', 'error');
      setIsProcessing(false);
      isProcessingRef.current = false;
      return;
    }

    const student = allStudents.find(s => s.pin === input);

      if (!student) {
        showStatus('등록되지 않은 번호입니다.', 'error');
        Vibration.vibrate(500);
        setInput('');
        setIsProcessing(false);
        isProcessingRef.current = false;
        lastEntryRef.current = { pin: '', time: 0 }; 
        return;
      }

      // 학생 이름 즉시 노출 (사용자 체감 속도 극대화)
      showStatus(`${student.name} 원생 처리 중...`, 'success');
      const currentInput = input; // 입력값 백업
      setInput(''); 

      // 2. 출결 기록 확인 및 저장 (배경 처리)
      const today = formatDateForDB();
      const attRef = collection(db, 'attendance');
      const attQuery = query(attRef, where('studentId', '==', student.id), where('date', '==', today));
      const attSnapshot = await getDocs(attQuery);

      let lastRecord = null;
      attSnapshot.forEach(d => {
        const data = d.data();
        if (!lastRecord || (data.timestamp && lastRecord.timestamp && data.timestamp.seconds > lastRecord.timestamp.seconds)) {
          lastRecord = data;
        }
      });

      const type = !lastRecord || lastRecord.type === 'checkout' ? 'checkin' : 'checkout';
      const now = new Date();
      const timeStr = formatTimeForSMS(now);
      
      let studyDuration = '';
      if (type === 'checkout' && lastRecord && lastRecord.type === 'checkin' && lastRecord.timestamp) {
        const checkinTime = lastRecord.timestamp.toDate ? lastRecord.timestamp.toDate() : new Date(lastRecord.timestamp.seconds * 1000);
        const diffMs = now - checkinTime;
        const diffMin = Math.floor(diffMs / (1000 * 60));
        const hours = Math.floor(diffMin / 60);
        const mins = diffMin % 60;
        
        if (hours > 0) studyDuration += `${hours}시간 `;
        studyDuration += `${mins}분`;
      }

      const recordRef = await addDoc(collection(db, 'attendance'), {
        studentId: student.id,
        studentName: student.name,
        parentPhones: student.parents ? student.parents.map(p => p.phone).filter(Boolean) : [],
        type,
        date: today,
        time: timeStr,
        timestamp: serverTimestamp(),
        processed: false,
        studyDuration: studyDuration || null, // 귀가 시에만 값이 존재
      });

      const typeLabel = type === 'checkin' ? '등원' : '귀가';
      let displayMsg = `${student.name} 원생\n${typeLabel} 완료 ✓`;

      if (studyDuration) {
        displayMsg = `${student.name} 귀가 완료 ✓\n(학습시간: ${studyDuration})`;
      }

      showStatus(displayMsg, 'success');

      // 3. 문자 발송은 백그라운드 서비스에서 전용으로 처리하도록 변경
      // (중복 발송 방지 및 서비스 안정성 확보)
      console.log(`[Keypad] 기록 저장됨: ${student.name}. (문자 발송은 백그라운드 서비스가 처리합니다)`);

    } catch (error) {
      console.error('출결 처리 오류:', error);
      showStatus('오류가 발생했습니다. 다시 시도해주세요.', 'error');
      setInput('');
      lastEntryRef.current = { pin: '', time: 0 }; // 에러 시 바로 재시도 가능하게 초기화
    }

    setIsProcessing(false);
    isProcessingRef.current = false;
  };


  const loadTodayLog = async () => {
    try {
      const today = formatDateForDB();
      const attRef = collection(db, 'attendance');
      const q = query(attRef, where('date', '==', today));
      const snapshot = await getDocs(q);
      const records = [];
      snapshot.forEach(d => records.push({ id: d.id, ...d.data() }));
      records.sort((a, b) => {
        if (!a.timestamp || !b.timestamp) return 0;
        return b.timestamp.seconds - a.timestamp.seconds;
      });
      setTodayLog(records);
    } catch (e) {
      console.error(e);
    }
  };

  const handleSwitchToAdmin = async () => {
    if (Platform.OS === 'web') {
      window.location.href = '/?mode=admin';
    } else {
      await AsyncStorage.setItem('appMode', 'admin');
      Alert.alert('모드 변경', '관리자 모드를 위해 앱을 다시 켜주세요.', [{ text: '확인' }]);
    }
  };

  const resetMode = () => {
    Alert.alert('초기화', '학생/관리자 다시 선택 화면으로 가시겠습니까?', [
      { text: '취소', style: 'cancel' },
      { text: '초기화', style: 'destructive', onPress: async () => {
        await AsyncStorage.removeItem('appMode');
        Alert.alert('완료', '앱을 재시작해 주세요.');
      }},
    ]);
  };

  const openLog = () => {
    loadTodayLog();
    setShowLog(true);
    
    // 이전 타이머가 있다면 확실히 제거
    if (logTimer.current) {
      clearTimeout(logTimer.current);
    }
    
    // 모달을 열 때 10초 타이머 세팅
    logTimer.current = setTimeout(() => {
      closeLog();
    }, 10000);
  };

  const closeLog = () => {
    setShowLog(false);
    if (logTimer.current) {
      clearTimeout(logTimer.current);
      logTimer.current = null;
    }
  };





  return (
    <SafeAreaView style={styles.container}>
      <StatusBar backgroundColor={BLUE} barStyle="light-content" />

      {/* 헤더 (항상 상단) */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => Alert.alert('미래학원', '학생 출결 관리 시스템입니다.')}>
          <Text style={styles.headerSide}>☰</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>미래학원</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity onPress={handleSwitchToAdmin} style={{ marginRight: 15 }}>
            <Text style={{ color: '#fff', fontSize: 15, textDecorationLine: 'underline' }}>관리자</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={resetMode}>
            <Text style={styles.headerSide}>⚙</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={[styles.contentWrapper, isLandscape && styles.landscapeContent]}>
        
        {/* 가로 모드일 때 좌측, 세로일 때 상단 섹션 */}
        <View style={[isLandscape ? styles.leftSection : styles.topSection]}>
          <View style={styles.timeRow}>
            <Text style={styles.dateText}>{formatDateKorean(currentTime)}</Text>
            <Text style={styles.timeText}>{formatClockDisplay(currentTime)}</Text>
          </View>

          <View style={styles.inputBox}>
            {[0, 1, 2, 3].map(i => (
              <View
                key={i}
                style={[styles.dot, { backgroundColor: i < input.length ? '#222' : 'transparent', borderColor: '#bbb', borderWidth: i < input.length ? 0 : 1.5 }]}
              />
            ))}
          </View>

          <View style={styles.statusArea}>
            {statusMsg.text ? (
              <View style={[styles.statusCard, statusMsg.type === 'error' ? styles.errorCard : styles.normalCard]}>
                <Text style={styles.statusText}>
                  {statusMsg.text}
                </Text>
              </View>
            ) : (
              <TouchableOpacity onPress={openLog} style={styles.logLinkWrapper}>
                <Text style={styles.logLink}>최근 출결 확인</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* 가로 모드일 때 우측, 세로일 때 하단 섹션 (키패드) */}
        <View style={[isLandscape ? styles.rightSection : styles.bottomSection]}>
          <View style={styles.padWrapper}>
            {PAD_KEYS.map((row, ri) => (
              <View key={ri} style={styles.padRow}>
                {row.map(key => (
                  <TouchableOpacity
                    key={key}
                    style={[
                      styles.key,
                      key === 'OK' && styles.okKey,
                      key === 'OK' && input.length < 4 && styles.okKeyDisabled,
                    ]}
                    onPress={() => handlePress(key)}
                    activeOpacity={0.6}
                    disabled={isProcessing}
                  >
                    <Text style={[
                      styles.keyText,
                      key === 'C' && styles.clearText,
                      key === 'OK' && styles.okText,
                    ]}>
                      {key}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            ))}
          </View>
        </View>
      </View>

      <Modal visible={showLog} animationType="slide" onRequestClose={closeLog}>
        <SafeAreaView style={styles.logModal}>
          <View style={styles.logHeader}>
            <Text style={styles.logHeaderTitle}>오늘 출결 목록</Text>
            <TouchableOpacity onPress={closeLog}>
              <Text style={styles.logClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={todayLog}
            keyExtractor={item => item.id}
            renderItem={({ item }) => (
              <View style={styles.logItem}>
                <Text style={styles.logName}>{item.studentName}</Text>
                <Text style={[styles.logType, item.type === 'checkin' ? styles.checkinColor : styles.checkoutColor]}>
                  {item.type === 'checkin' ? '등원' : '귀가'}
                </Text>
                <Text style={styles.logTime}>{item.time}</Text>
              </View>
            )}
            ListEmptyComponent={<Text style={styles.emptyText}>오늘 출결 기록이 없습니다.</Text>}
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BLUE,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    zIndex: 10,
  },
  headerSide: { color: '#fff', fontSize: 26 },
  headerTitle: { color: '#fff', fontSize: 22, fontWeight: 'bold' },
  
  contentWrapper: {
    flex: 1,
    width: '100%',
    alignSelf: 'center',
  },
  landscapeContent: {
    flexDirection: 'row',
    maxWidth: 1000,
    paddingHorizontal: 20,
  },

  // 구역 나누기 (가로 모드용)
  leftSection: {
    flex: 1,
    justifyContent: 'center',
    paddingRight: 20,
  },
  rightSection: {
    flex: 1.2,
    justifyContent: 'center',
  },

  // 구역 나누기 (세로 모드용)
  topSection: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  bottomSection: {
    flex: 1,
  },

  timeRow: {
    alignItems: 'center',
    marginBottom: 20,
  },
  dateText: { color: '#fff', fontSize: 18, marginBottom: 5 },
  timeText: { color: '#fff', fontSize: 56, fontWeight: 'bold' },

  inputBox: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 30,
    gap: 25,
    marginHorizontal: Platform.OS === 'web' ? 0 : 20,
    ...Platform.select({
      web: { boxShadow: '0 4px 15px rgba(0,0,0,0.25)' },
    }),
  },
  dot: { width: 24, height: 24, borderRadius: 12 },

  statusArea: {
    minHeight: 120,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 15,
    paddingHorizontal: 10,
  },
  statusCard: {
    width: '100%',
    paddingVertical: 20,
    paddingHorizontal: 25,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  normalCard: { 
    backgroundColor: '#fff', 
    borderColor: '#eee',
    elevation: 4,
    ...Platform.select({
      web: { boxShadow: '0 4px 15px rgba(0,0,0,0.1)' },
    }),
  },
  errorCard: { 
    backgroundColor: '#FFF9C4', 
    borderColor: '#FBC02D',
    elevation: 8,
    ...Platform.select({
      web: { boxShadow: '0 8px 25px rgba(0,0,0,0.2)' },
    }),
  },
  
  statusText: { 
    textAlign: 'center', 
    fontSize: 48, 
    fontWeight: 'bold', 
    color: '#1a1a1a',
    lineHeight: 58,
  },
  
  logLinkWrapper: { 
    marginTop: 10, 
    backgroundColor: 'rgba(0,0,0,0.2)', 
    paddingHorizontal: 20, 
    paddingVertical: 10, 
    borderRadius: 20 
  },
  logLink: { color: '#fff', fontSize: 18, textDecorationLine: 'underline' },

  padWrapper: {
    flex: 1,
    backgroundColor: '#EFEFEF',
    margin: 10,
    borderRadius: 20,
    padding: 10,
    ...Platform.select({
      web: { boxShadow: '0 10px 30px rgba(0,0,0,0.3)' },
    }),
  },
  padRow: {
    flex: 1,
    flexDirection: 'row',
  },
  key: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    margin: 6,
    borderRadius: 15,
    backgroundColor: '#fff',
    ...Platform.select({
      web: { boxShadow: '0 2px 5px rgba(0,0,0,0.1)' },
    }),
  },
  keyText: { fontSize: 42, fontWeight: '300', color: '#222' },
  clearText: { color: '#FF9800', fontWeight: '600', fontSize: 36 },
  okKey: {
    backgroundColor: BLUE,
  },
  okKeyDisabled: { backgroundColor: '#BDBDBD' },
  okText: { color: '#fff', fontWeight: '700', fontSize: 32 },

  logModal: { flex: 1, backgroundColor: '#fff' },
  logHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: BLUE,
  },
  logHeaderTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  logClose: { color: '#fff', fontSize: 24 },
  logItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  logName: { flex: 1, fontSize: 18, fontWeight: 'bold', color: '#222' },
  logType: { fontSize: 16, fontWeight: '600', marginRight: 12 },
  checkinColor: { color: '#1565C0' },
  checkoutColor: { color: '#C62828' },
  logTime: { fontSize: 15, color: '#666' },
  emptyText: { textAlign: 'center', marginTop: 40, color: '#999', fontSize: 16 },
});
