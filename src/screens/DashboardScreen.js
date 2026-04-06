import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, StatusBar,
  SafeAreaView, FlatList, Alert
} from 'react-native';
import {
  collection, query, where, onSnapshot, doc, updateDoc
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { buildCheckinMessage, buildCheckoutMessage, sendAttendanceSMS } from '../utils/smsUtils';
import { formatDateForDB } from '../utils/timeUtils';

const RED = '#C62828';

export default function DashboardScreen({ navigation }) {
  const [todayRecords, setTodayRecords] = useState([]);
  const processedIds = useRef(new Set());
  const sessionStart = useRef(Date.now());

  const today = formatDateForDB();

  useEffect(() => {
    const attRef = collection(db, 'attendance');
    const q = query(attRef, where('date', '==', today));

    const unsubscribe = onSnapshot(q, snapshot => {
      const records = [];

      snapshot.docChanges().forEach(change => {
        if (change.type === 'added') {
          const data = { id: change.doc.id, ...change.doc.data() };
          // 새 기록이면서 아직 처리 안 된 건 문자 발송
          if (!data.processed && !processedIds.current.has(data.id)) {
            const tsMs = data.timestamp ? data.timestamp.seconds * 1000 : 0;
            if (tsMs >= sessionStart.current - 30000) {
              // 앱 실행 후 30초 이전까지의 미처리 건도 발송
              processSMS(data);
            }
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

    return () => unsubscribe();
  }, []);

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
      Alert.alert('오류', '등록된 학부모 연락처가 없습니다.');
      return;
    }
    const msg = record.type === 'checkin'
      ? buildCheckinMessage(record.studentName, record.time)
      : buildCheckoutMessage(record.studentName, record.time);
    processedIds.current.delete(record.id);
    processSMS({ ...record });
  };

  const checkinCount = todayRecords.filter(r => r.type === 'checkin').length;
  const checkoutCount = todayRecords.filter(r => r.type === 'checkout').length;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar backgroundColor={RED} barStyle="light-content" />

      {/* 헤더 */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>미래학원 출결 현황</Text>
        <TouchableOpacity onPress={() => navigation.navigate('Students')}>
          <Text style={styles.headerBtn}>학생관리</Text>
        </TouchableOpacity>
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
});
