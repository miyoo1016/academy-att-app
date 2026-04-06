import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, StatusBar,
  SafeAreaView, Vibration, Modal, FlatList, Alert
} from 'react-native';
import {
  collection, addDoc, query, where, getDocs, orderBy,
  serverTimestamp, doc, getDoc
} from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { db } from '../config/firebase';
import { formatTimeForSMS, formatDateForDB, formatClockDisplay, formatDateKorean } from '../utils/timeUtils';
import { DevSettings } from 'react-native'; // 앱 재시작용

const BLUE = '#1565C0';

const PAD_KEYS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['C', '0', 'OK'],
];

export default function KeypadScreen() {
  const [input, setInput] = useState('');
  const [currentTime, setCurrentTime] = useState(new Date());
  const [statusMsg, setStatusMsg] = useState({ text: '', type: '' }); // type: 'success' | 'error'
  const [isProcessing, setIsProcessing] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [todayLog, setTodayLog] = useState([]);
  const statusTimer = useRef(null);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const showStatus = (text, type = 'success') => {
    if (statusTimer.current) clearTimeout(statusTimer.current);
    setStatusMsg({ text, type });
    statusTimer.current = setTimeout(() => setStatusMsg({ text: '', type: '' }), 3500);
  };

  const handlePress = (key) => {
    if (isProcessing) return;
    if (key === 'C') {
      setInput('');
    } else if (key === 'OK') {
      if (input.length === 4) handleSubmit();
    } else {
      if (input.length < 4) setInput(prev => prev + key);
    }
  };

  const handleSubmit = async () => {
    if (isProcessing || input.length !== 4) return;
    setIsProcessing(true);

    try {
      // PIN으로 학생 조회
      const studentsRef = collection(db, 'students');
      const q = query(studentsRef, where('pin', '==', input), where('isActive', '==', true));
      const snapshot = await getDocs(q);

      if (snapshot.empty) {
        showStatus('등록되지 않은 번호입니다.', 'error');
        Vibration.vibrate(500);
        setInput('');
        setIsProcessing(false);
        return;
      }

      const studentDoc = snapshot.docs[0];
      const student = { id: studentDoc.id, ...studentDoc.data() };

      // 오늘 마지막 출결 확인
      const today = formatDateForDB();
      const attRef = collection(db, 'attendance');
      const attQuery = query(attRef, where('studentId', '==', student.id), where('date', '==', today));
      const attSnapshot = await getDocs(attQuery);

      // 마지막 기록 찾기 (타임스탬프 정렬 - 클라이언트)
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

      // 출결 기록 저장 (학부모 전화번호 비정규화해서 같이 저장)
      await addDoc(collection(db, 'attendance'), {
        studentId: student.id,
        studentName: student.name,
        parentPhones: student.parents ? student.parents.map(p => p.phone).filter(Boolean) : [],
        type,
        date: today,
        time: timeStr,
        timestamp: serverTimestamp(),
        processed: false,
      });

      const typeLabel = type === 'checkin' ? '등원' : '귀가';
      showStatus(`${student.name} 원생 ${typeLabel} ✓`, 'success');
      setInput('');
    } catch (error) {
      console.error('출결 처리 오류:', error);
      showStatus('오류가 발생했습니다. 다시 시도해주세요.', 'error');
      setInput('');
    }

    setIsProcessing(false);
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

  const resetMode = () => {
    Alert.alert(
      '모드 설정 초기화',
      '초기 화면으로 돌아가시겠습니까?\n(학생/관리자 다시 선택)',
      [
        { text: '취소', style: 'cancel' },
        { 
          text: '초기화', 
          style: 'destructive',
          onPress: async () => {
            await AsyncStorage.removeItem('appMode');
            // 앱을 재시동하거나 상태를 업데이트하기 위해 강제 재기동 유도 (또는 RN 환경에 따라 적절히 처리)
            DevSettings.reload();
          }
        },
      ]
    );
  };

  const openLog = () => {
    loadTodayLog();
    setShowLog(true);
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar backgroundColor={BLUE} barStyle="light-content" />

      {/* 헤더 */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => Alert.alert('미래학원', '학생 출결 관리 시스템입니다.')}>
          <Text style={styles.headerSide}>☰</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>미래학원</Text>
        <TouchableOpacity onPress={resetMode}>
          <Text style={styles.headerSide}>⚙</Text>
        </TouchableOpacity>
      </View>

      {/* 시간 표시 */}
      <View style={styles.timeRow}>
        <Text style={styles.dateText}>{formatDateKorean(currentTime)}</Text>
        <Text style={styles.timeText}>{formatClockDisplay(currentTime)}</Text>
      </View>

      {/* PIN 입력 표시 (점) */}
      <View style={styles.inputBox}>
        {[0, 1, 2, 3].map(i => (
          <View
            key={i}
            style={[styles.dot, { backgroundColor: i < input.length ? '#222' : 'transparent', borderColor: '#bbb', borderWidth: i < input.length ? 0 : 1.5 }]}
          />
        ))}
      </View>

      {/* 상태 메시지 / 출첵 목록 링크 */}
      {statusMsg.text ? (
        <Text style={[styles.statusText, statusMsg.type === 'error' ? styles.errorText : styles.successText]}>
          {statusMsg.text}
        </Text>
      ) : (
        <TouchableOpacity onPress={openLog} style={styles.logLinkWrapper}>
          <Text style={styles.logLink}>출첵 목록 열기</Text>
        </TouchableOpacity>
      )}

      {/* 숫자 패드 */}
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

      {/* 오늘 출결 목록 모달 */}
      <Modal visible={showLog} animationType="slide" onRequestClose={() => setShowLog(false)}>
        <SafeAreaView style={styles.logModal}>
          <View style={styles.logHeader}>
            <Text style={styles.logHeaderTitle}>오늘 출결 목록</Text>
            <TouchableOpacity onPress={() => setShowLog(false)}>
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
  container: { flex: 1, backgroundColor: BLUE },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  headerSide: { color: '#fff', fontSize: 26 },
  headerTitle: { color: '#fff', fontSize: 22, fontWeight: 'bold' },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 8,
    paddingBottom: 12,
  },
  dateText: { color: '#fff', fontSize: 16 },
  timeText: { color: '#fff', fontSize: 44, fontWeight: 'bold' },
  inputBox: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
    marginHorizontal: 16,
    borderRadius: 10,
    paddingVertical: 22,
    gap: 24,
  },
  dot: { width: 22, height: 22, borderRadius: 11 },
  statusText: { textAlign: 'center', fontSize: 15, fontWeight: 'bold', marginTop: 8 },
  successText: { color: '#A5D6A7' },
  errorText: { color: '#FFCDD2' },
  logLinkWrapper: { alignItems: 'flex-end', paddingRight: 20, marginTop: 8 },
  logLink: { color: '#fff', fontSize: 14 },
  padWrapper: {
    flex: 1,
    backgroundColor: '#EFEFEF',
    margin: 12,
    borderRadius: 16,
    paddingVertical: 4,
  },
  padRow: {
    flex: 1,
    flexDirection: 'row',
  },
  key: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    margin: 4,
    borderRadius: 10,
  },
  keyText: { fontSize: 36, fontWeight: '300', color: '#222' },
  clearText: { color: '#FF9800', fontWeight: '600', fontSize: 32 },
  okKey: {
    backgroundColor: BLUE,
    margin: 8,
    borderRadius: 14,
  },
  okKeyDisabled: { backgroundColor: '#BDBDBD' },
  okText: { color: '#fff', fontWeight: '700', fontSize: 28 },
  // 모달 스타일
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
