import React, { useState, useEffect, useRef } from 'react';
import BackgroundService from 'react-native-background-actions';
import {
  View, Text, TouchableOpacity, StyleSheet, StatusBar,
  SafeAreaView, FlatList, Alert, Platform
} from 'react-native';
import {
  collection, query, where, onSnapshot, doc, updateDoc, getDoc, getDocs, setDoc, serverTimestamp
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { buildCheckinMessage, buildCheckoutMessage, buildBirthdayMessage, sendAttendanceSMS } from '../utils/smsUtils';
import { formatDateForDB } from '../utils/timeUtils';
import { startSmsBackgroundService } from '../tasks/SmsBackgroundService';

import AsyncStorage from '@react-native-async-storage/async-storage';

const RED = '#C62828';

export default function DashboardScreen({ navigation }) {
  const [todayRecords, setTodayRecords] = useState([]);
  const [isServiceRunning, setIsServiceRunning] = useState(false);
  const [serviceInfo, setServiceInfo] = useState({ lastActive: null, status: 'unknown' });
  const [refreshTrigger, setRefreshTrigger] = useState(0); // 화면 강제 갱신용
  const processedIds = useRef(new Set());
  const today = formatDateForDB();
  const sessionStart = useRef(Date.now());

  const showAlert = (title, msg) => {
    if (Platform.OS === 'web') {
      alert(`${title}: ${msg}`);
    } else {
      Alert.alert(title, msg);
    }
  };

  useEffect(() => {
    // 자동 발송 백그라운드 태스크 시작
    startSmsBackgroundService();

    // 1. 출결 데이터 리스너
    const attRef = collection(db, 'attendance');
    const q = query(attRef, where('date', '==', today));

    const unsubscribeAtt = onSnapshot(q, snapshot => {
      snapshot.docChanges().forEach(change => {
        if (change.type === 'added') {
          const record = { id: change.doc.id, ...change.doc.data() };
          // 미처리된 데이터인 경우 문자 발송 시도
          if (!record.processed) {
            processSMS(record);
          }
        }
      });

      const all = [];
      snapshot.forEach(d => all.push({ id: d.id, ...d.data() }));
      all.sort((a, b) => {
        if (!a.timestamp || !b.timestamp) return 0;
        return b.timestamp.seconds - a.timestamp.seconds;
      });
      setTodayRecords(all);
    });

    // 2. 서비스 하트비트 상태 리스너
    const statusRef = doc(db, 'service_status', 'main_terminal');
    const unsubscribeStatus = onSnapshot(statusRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setServiceInfo({
          lastActive: data.lastActive?.toDate() || null,
          status: data.status || 'unknown'
        });
      }
    });

    checkBirthdays();

    const serviceCheckInterval = setInterval(() => {
      setIsServiceRunning(BackgroundService.isRunning());
      setRefreshTrigger(prev => prev + 1); // 1초마다 화면 숫자 갱신 강제 발생
    }, 1000);

    return () => {
      unsubscribeAtt();
      unsubscribeStatus();
      clearInterval(serviceCheckInterval);
    };
  }, []);

  // 시간차 계산 함수
  const getTimeDiffText = (date) => {
    if (!date) return '기록 없음';
    const diff = Math.floor((new Date() - date) / 1000);
    if (diff < 60) return `${diff}초 전`;
    if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
    return `${Math.floor(diff / 3600)}시간 전`;
  };

  const checkBirthdays = async () => {
    const now = new Date();
    // 오전 8시 이후부터 작동
    if (now.getHours() < 8) return;

    const todayStr = formatDateForDB();
    const month = now.getMonth() + 1;
    const day = now.getDate();

    try {
      // 오늘 이미 발송했는지 체크
      const logRef = doc(db, 'birthday_logs', todayStr);
      const logSnap = await getDoc(logRef);
      if (logSnap.exists()) return;

      // 생일자 조회
      const studentsRef = collection(db, 'students');
      const q = query(studentsRef, where('birthMonth', '==', month), where('birthDay', '==', day), where('isActive', '==', true));
      const snapshot = await getDocs(q);

      if (snapshot.empty) {
        await setDoc(logRef, { checked: true, sentCount: 0 });
        return;
      }

      let sentCount = 0;
      for (const studentDoc of snapshot.docs) {
        const student = studentDoc.data();
        const msg = buildBirthdayMessage(student.name);
        
        const phones = [];
        if (student.phone) phones.push(student.phone);
        if (student.parents) {
          student.parents.forEach(p => { if (p.phone) phones.push(p.phone); });
        }

        if (phones.length > 0) {
          await sendAttendanceSMS(phones, msg);
          sentCount++;
        }
      }

      await setDoc(logRef, { checked: true, sentCount, timestamp: serverTimestamp() });
      if (sentCount > 0) {
        showAlert('생일 자동 발송', `오늘 생일인 ${sentCount}명의 학생 및 학부모님께 축하 메시지를 보냈습니다.`);
      }
    } catch (e) {
      console.error('생일 체크 오류:', e);
    }
  };

  const processSMS = async (record) => {
    if (processedIds.current.has(record.id)) return;
    processedIds.current.add(record.id);

    const phones = record.parentPhones || [];
    if (phones.length === 0) {
      await markProcessed(record.id);
      return;
    }

    const msg = record.type === 'checkin'
      ? buildCheckinMessage(record.studentName, record.time)
      : buildCheckoutMessage(record.studentName, record.time);

    const sent = await sendAttendanceSMS(phones, msg);
    if (sent) {
      await markProcessed(record.id);
    }
  };

  const markProcessed = async (recordId) => {
    try {
      await updateDoc(doc(db, 'attendance', recordId), { processed: true });
    } catch (e) {
      console.error('processed 업데이트 오류:', e);
    }
  };

  const resendSMS = (record) => {
    const phones = record.parentPhones || [];
    if (phones.length === 0) {
      showAlert('오류', '등록된 학부모 연락처가 없습니다.');
      return;
    }
    const msg = record.type === 'checkin'
      ? buildCheckinMessage(record.studentName, record.time)
      : buildCheckoutMessage(record.studentName, record.time);
    processedIds.current.delete(record.id);
    processSMS({ ...record });
  };

  const handleSwitchToKeypad = async () => {
    if (Platform.OS === 'web') {
      window.location.href = '/?mode=student';
    } else {
      await AsyncStorage.setItem('appMode', 'student');
      Alert.alert(
        '모드 변경',
        '입력패드 모드로 돌아가려면 앱을 재시작해주세요.',
        [{ text: '확인' }]
      );
    }
  };

  const checkinCount = todayRecords.filter(r => r.type === 'checkin').length;
  const checkoutCount = todayRecords.filter(r => r.type === 'checkout').length;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar backgroundColor={RED} barStyle="light-content" />

      {/* 헤더 */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>미래학원 출결 현황</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity onPress={handleSwitchToKeypad} style={{ marginRight: 15 }}>
            <Text style={styles.headerBtn}>입력패드</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('Students')}>
            <Text style={styles.headerBtn}>학생관리</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 오늘 통계 */}
      <View style={styles.statsRow}>
        <View style={[styles.statCard, { backgroundColor: '#1565C0' }]}>
          <Text style={styles.statNum}>{checkinCount}</Text>
          <Text style={styles.statLabel}>등원</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: '#C62828' }]}>
          <Text style={styles.statNum}>{checkoutCount}</Text>
          <Text style={styles.statLabel}>귀가</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: '#388E3C' }]}>
          <Text style={styles.statNum}>{checkinCount - checkoutCount > 0 ? checkinCount - checkoutCount : 0}</Text>
          <Text style={styles.statLabel}>학원내</Text>
        </View>
      </View>

      {/* 서비스 상태 바 (하트비트 연동) */}
      <View style={[styles.statusBanner, isServiceRunning ? styles.statusActive : styles.statusInactive]}>
        <View style={[styles.statusDot, { backgroundColor: isServiceRunning ? '#4CAF50' : '#F44336' }]} />
        <View style={{ flex: 1 }}>
          <Text style={styles.statusText}>
            {isServiceRunning ? '실시간 출결 감시 서비스 가동 중' : '감시 서비스 중지됨 (앱 재시작 필요)'}
          </Text>
          {isServiceRunning && (
            <Text style={{ fontSize: 11, color: '#666' }}>
              상태 체크: {getTimeDiffText(serviceInfo.lastActive)} (네트워크 세션 유지 중)
            </Text>
          )}
        </View>
      </View>


      {/* 배터리 최적화 안내 (안드로이드 전용) */}
      {Platform.OS === 'android' && (
        <View style={styles.batteryNotice}>
          <Text style={styles.batteryNoticeTitle}>⚠️ 안정적인 백그라운드 작동을 위한 설정</Text>
          <Text style={styles.batteryNoticeDesc}>
            시스템 설정에서 이 앱의 [배터리 최적화]를 "제한 없음"으로 설정해야 26시간 이상 끊김 없이 문자가 발송됩니다.
          </Text>
        </View>
      )}

      {/* 오늘 출결 목록 */}
      <Text style={styles.sectionTitle}>오늘 출결 기록</Text>
      <FlatList
        data={todayRecords}
        keyExtractor={item => item.id}
        contentContainerStyle={{ paddingBottom: 20 }}
        renderItem={({ item }) => (
          <View style={styles.recordCard}>
            <View style={styles.recordLeft}>
              <View style={[styles.typeBadge, item.type === 'checkin' ? styles.checkinBadge : styles.checkoutBadge]}>
                <Text style={styles.typeBadgeText}>{item.type === 'checkin' ? '등원' : '귀가'}</Text>
              </View>
            </View>
            <View style={styles.recordCenter}>
              <Text style={styles.recordName}>{item.studentName}</Text>
              <Text style={styles.recordTime}>{item.time}</Text>
            </View>
            <View style={styles.recordRight}>
              <View style={[styles.smsBadge, item.processed ? styles.smsSent : styles.smsPending]}>
                <Text style={styles.smsBadgeText}>{item.processed ? '발송됨' : '미발송'}</Text>
              </View>
              <TouchableOpacity onPress={() => resendSMS(item)} style={styles.resendBtn}>
                <Text style={styles.resendBtnText}>재발송</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.emptyText}>오늘 출결 기록이 없습니다.</Text>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: RED,
    padding: 16,
  },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  headerBtn: { color: '#fff', fontSize: 15, textDecorationLine: 'underline' },
  statsRow: {
    flexDirection: 'row',
    padding: 12,
    gap: 8,
  },
  statCard: {
    flex: 1,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  statNum: { color: '#fff', fontSize: 36, fontWeight: 'bold' },
  statLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 14, marginTop: 2 },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  recordCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 14,
    marginHorizontal: 12,
    marginTop: 8,
    borderRadius: 10,
    elevation: 1,
  },
  recordLeft: { marginRight: 12 },
  typeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  checkinBadge: { backgroundColor: '#1565C0' },
  checkoutBadge: { backgroundColor: '#C62828' },
  typeBadgeText: { color: '#fff', fontWeight: 'bold', fontSize: 13 },
  recordCenter: { flex: 1 },
  recordName: { fontSize: 18, fontWeight: 'bold', color: '#222' },
  recordTime: { fontSize: 14, color: '#666', marginTop: 2 },
  recordRight: { alignItems: 'flex-end', gap: 4 },
  smsBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  smsSent: { backgroundColor: '#E8F5E9' },
  smsPending: { backgroundColor: '#FFF3E0' },
  smsBadgeText: { fontSize: 11, color: '#555' },
  resendBtn: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#1565C0',
  },
  resendBtnText: { fontSize: 11, color: '#1565C0' },
  emptyText: { textAlign: 'center', color: '#999', fontSize: 16, marginTop: 40 },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
    marginTop: 4,
    padding: 10,
    borderRadius: 8,
    gap: 8,
  },
  statusActive: { backgroundColor: '#E8F5E9' },
  statusInactive: { backgroundColor: '#FFEBEE' },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#4CAF50' },
  statusText: { fontSize: 13, fontWeight: 'bold', color: '#2E7D32' },
  statusInactiveText: { color: '#C62828' },
  batteryNotice: {
    marginHorizontal: 12,
    marginTop: 10,
    padding: 12,
    backgroundColor: '#FFF9C4',
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#FBC02D',
  },
  batteryNoticeTitle: { fontSize: 14, fontWeight: 'bold', color: '#827717', marginBottom: 2 },
  batteryNoticeDesc: { fontSize: 12, color: '#9E9D24', lineHeight: 18 },
});
