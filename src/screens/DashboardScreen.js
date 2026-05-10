import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, StatusBar,
  SafeAreaView, FlatList, Alert, Platform, AppState, NativeModules
} from 'react-native';
import {
  collection, query, where, onSnapshot, doc, updateDoc, getDoc, getDocs, setDoc, serverTimestamp, addDoc
} from 'firebase/firestore';
import { db } from '../config/firebase';
import initialStudents from '../config/initial_students.json';
import { buildCheckinMessage, buildCheckoutMessage, buildBirthdayMessage, sendAttendanceSMS } from '../utils/smsUtils';
import { formatDateForDB } from '../utils/timeUtils';

import AsyncStorage from '@react-native-async-storage/async-storage';

const RED = '#C62828';
const { HeartbeatModule } = NativeModules;

export default function DashboardScreen({ navigation }) {
  const [todayRecords, setTodayRecords] = useState([]);
  const [serviceInfo, setServiceInfo] = useState({ lastActive: null, status: 'unknown' });
  const [pendingRecords, setPendingRecords] = useState([]);
  const [permissionInfo, setPermissionInfo] = useState({
    battery: null,
    sms: null,
    notifications: null,
  });
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
    // 1. 출결 데이터 리스너
    const attRef = collection(db, 'attendance');
    const q = query(attRef, where('date', '==', today));

    const unsubscribeAtt = onSnapshot(q, snapshot => {
      // 대시보드에서는 목록만 갱신하고 자동 발송은 하지 않습니다. 
      // (백그라운드 서비스가 담당)
      
      const all = [];
      snapshot.forEach(d => all.push({ id: d.id, ...d.data() }));
      all.sort((a, b) => {
        if (!a.timestamp || !b.timestamp) return 0;
        return b.timestamp.seconds - a.timestamp.seconds;
      });
      setTodayRecords(all);
    });

    const pendingQuery = query(attRef, where('processed', '==', false));
    const unsubscribePending = onSnapshot(pendingQuery, snapshot => {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 2);
      const cutoffStr = formatDateForDB(cutoff);
      const pending = [];
      snapshot.forEach(d => {
        const data = { id: d.id, ...d.data() };
        if (!data.date || data.date >= cutoffStr) pending.push(data);
      });
      setPendingRecords(pending);
    });

    // 2. 서비스 하트비트 상태 리스너
    const statusRef = doc(db, 'service_status', 'main_terminal');
    const unsubscribeStatus = onSnapshot(statusRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        const rawLastActive = data.lastActive;
        const lastActive = rawLastActive?.toDate
          ? rawLastActive.toDate()
          : rawLastActive
            ? new Date(rawLastActive)
            : null;
        setServiceInfo({
          lastActive: Number.isNaN(lastActive?.getTime()) ? null : lastActive,
          status: data.status || 'unknown',
          watchdogLastRun: parseFirestoreDate(data.watchdogLastRun),
          lastSmsSuccessAt: parseFirestoreDate(data.lastSmsSuccessAt),
          lastError: data.lastError || '',
          pendingCount: data.pendingCount ?? null,
          lastRunSource: data.lastRunSource || '',
        });
      }
    });

    let serviceCheckInterval = null;
    const updateInterval = () => {
      if (AppState.currentState === 'active') {
        if (!serviceCheckInterval) {
          serviceCheckInterval = setInterval(() => {
            setRefreshTrigger(prev => prev + 1);
          }, 30000);
        }
      } else {
        if (serviceCheckInterval) {
          clearInterval(serviceCheckInterval);
          serviceCheckInterval = null;
        }
      }
    };

    const appStateSub = AppState.addEventListener('change', updateInterval);
    updateInterval(); // 초기 실행
    refreshPermissions();

    const checkAndAutoImportStudents = async () => {
      try {
        const isImported = await AsyncStorage.getItem('hasImportedInitialList_v1');
        if (isImported === 'true') return;

        console.log('[AutoImport] 최초 1회 명단 동기화 시작...');
        
        for (const s of initialStudents) {
          const q = query(collection(db, 'students'), where('pin', '==', s.pin));
          const snap = await getDocs(q);
          
          if (snap.empty) {
            const data = {
              name: s.name.trim(),
              pin: s.pin,
              phone: '',
              memo: s.memo,
              isActive: true,
              parents: [{ name: '학부모', phone: s.parentPhone.trim() }],
              createdAt: new Date().toISOString()
            };
            await addDoc(collection(db, 'students'), data);
          }
        }

        await AsyncStorage.setItem('hasImportedInitialList_v1', 'true');
        console.log('[AutoImport] 명단 동기화 완료!');
      } catch (e) {
        console.error('[AutoImport] 오류:', e);
      }
    };

    checkAndAutoImportStudents();

    return () => {
      unsubscribeAtt();
      unsubscribePending();
      unsubscribeStatus();
      if (serviceCheckInterval) clearInterval(serviceCheckInterval);
      appStateSub.remove();
    };
  }, []);

  const parseFirestoreDate = (value) => {
    if (!value) return null;
    const date = value?.toDate ? value.toDate() : new Date(value);
    return Number.isNaN(date?.getTime()) ? null : date;
  };

  const refreshPermissions = async () => {
    if (Platform.OS !== 'android') return;
    try {
      const [battery, sms, notifications] = await Promise.all([
        HeartbeatModule?.isIgnoringBatteryOptimizations?.(),
        HeartbeatModule?.hasSmsPermission?.(),
        HeartbeatModule?.hasNotificationPermission?.(),
      ]);
      setPermissionInfo({ battery: !!battery, sms: !!sms, notifications: !!notifications });
    } catch (e) {
      console.error('권한 상태 확인 오류:', e);
    }
  };

  const openBatterySettings = async () => {
    try {
      await HeartbeatModule?.requestIgnoreBatteryOptimizations?.();
      setTimeout(refreshPermissions, 1000);
    } catch (e) {
      showAlert('오류', '배터리 최적화 설정 화면을 열지 못했습니다.');
    }
  };

  // 시간차 계산 함수
  const getTimeDiffText = (date) => {
    if (!date) return '기록 없음';
    const diff = Math.floor((new Date() - date) / 1000);
    if (diff < 60) return `${diff}초 전`;
    if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
    return `${Math.floor(diff / 3600)}시간 전`;
  };

  const sendManualSMS = async (record) => {
    const phones = record.parentPhones || [];
    if (phones.length === 0) {
      await markProcessed(record.id);
      return;
    }

    const msg = record.type === 'checkin'
      ? buildCheckinMessage(record.studentName, record.time)
      : buildCheckoutMessage(record.studentName, record.time);

    console.log(`[Dashboard] Manual Resend for ${record.studentName}`);
    const sent = await sendAttendanceSMS(phones, msg);
    if (sent) {
      await markProcessed(record.id);
      showAlert('성공', '문자가 성공적으로 발송되었습니다.');
    } else {
      await markFailed(record.id, '수동 재발송 실패');
    }
  };

  const markProcessed = async (recordId) => {
    try {
      await updateDoc(doc(db, 'attendance', recordId), {
        processed: true,
        sending: false,
        sentAt: serverTimestamp(),
        sentByDevice: 'manual_admin',
        sendSource: 'manual',
        lastError: null,
      });
    } catch (e) {
      console.error('processed 업데이트 오류:', e);
    }
  };

  const markFailed = async (recordId, error) => {
    try {
      const recordRef = doc(db, 'attendance', recordId);
      const snap = await getDoc(recordRef);
      const currentRetry = snap.exists() ? (snap.data().retryCount || 0) : 0;
      await updateDoc(recordRef, {
        processed: false,
        sending: false,
        retryCount: currentRetry + 1,
        lastError: error,
        lastAttemptAt: serverTimestamp(),
      });
    } catch (e) {
      console.error('실패 기록 업데이트 오류:', e);
    }
  };

  const resendSMS = (record) => {
    const phones = record.parentPhones || [];
    if (phones.length === 0) {
      showAlert('오류', '등록된 학부모 연락처가 없습니다.');
      return;
    }
    sendManualSMS(record);
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
  const isServiceRunning = serviceInfo.lastActive
    ? Date.now() - serviceInfo.lastActive.getTime() < 20 * 60 * 1000
    : false;
  const failedRetryCount = pendingRecords.filter(r => (r.retryCount || 0) > 0 || r.lastError).length;
  const hasRiskySettings = Platform.OS === 'android'
    && (permissionInfo.battery === false || permissionInfo.sms === false || permissionInfo.notifications === false);
  void refreshTrigger;

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
          <Text style={[styles.statusText, !isServiceRunning && styles.statusInactiveText]}>
            {isServiceRunning ? '실시간 출결 감시 서비스 가동 중' : '감시 서비스 확인 필요'}
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
          <Text style={styles.batteryNoticeTitle}>
            {hasRiskySettings ? '설정 필요 / 장기 방치 시 위험' : '백그라운드 설정 상태'}
          </Text>
          <Text style={styles.batteryNoticeDesc}>
            삼성 Deep Sleep, App Standby, 배터리 제한이 켜지면 앱 코드만으로 100% 즉시 발송을 보장할 수 없습니다.
          </Text>
          <View style={styles.diagnosticGrid}>
            <Text style={styles.diagnosticText}>미발송: {pendingRecords.length}건</Text>
            <Text style={styles.diagnosticText}>실패/재시도: {failedRetryCount}건</Text>
            <Text style={styles.diagnosticText}>Watchdog: {getTimeDiffText(serviceInfo.watchdogLastRun)}</Text>
            <Text style={styles.diagnosticText}>최근 성공: {getTimeDiffText(serviceInfo.lastSmsSuccessAt)}</Text>
            <Text style={styles.diagnosticText}>SMS 권한: {permissionInfo.sms ? '허용' : '확인 필요'}</Text>
            <Text style={styles.diagnosticText}>알림 권한: {permissionInfo.notifications ? '허용' : '확인 필요'}</Text>
            <Text style={styles.diagnosticText}>배터리 제한: {permissionInfo.battery ? '제외됨' : '설정 필요'}</Text>
            <Text style={styles.diagnosticText}>마지막 오류: {serviceInfo.lastError || '없음'}</Text>
          </View>
          <TouchableOpacity style={styles.settingsBtn} onPress={openBatterySettings}>
            <Text style={styles.settingsBtnText}>배터리 최적화 제외 설정 열기</Text>
          </TouchableOpacity>
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
  diagnosticGrid: {
    marginTop: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  diagnosticText: {
    width: '48%',
    fontSize: 12,
    color: '#5D5A12',
    lineHeight: 18,
  },
  settingsBtn: {
    marginTop: 10,
    alignSelf: 'flex-start',
    backgroundColor: '#1565C0',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
  },
  settingsBtnText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
});
