import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, StatusBar,
  SafeAreaView, FlatList, Alert, ScrollView, Platform
} from 'react-native';
import {
  collection, getDocs, doc, updateDoc, deleteDoc, query, orderBy
} from 'firebase/firestore';
import { useFocusEffect } from '@react-navigation/native';
import { db } from '../config/firebase';

const RED = '#C62828';

export default function StudentsScreen({ navigation }) {
  const [students, setStudents] = useState([]);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const loadStudents = async () => {
    try {
      const snapshot = await getDocs(collection(db, 'students'));
      const list = [];
      snapshot.forEach(d => list.push({ id: d.id, ...d.data() }));
      list.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
      setStudents(list);
    } catch (e) {
      console.error(e);
    }
  };

  useFocusEffect(useCallback(() => { loadStudents(); }, []));

  const toggleActive = async (student) => {
    const newStatus = !student.isActive;
    await updateDoc(doc(db, 'students', student.id), { isActive: newStatus });
    setStudents(prev => prev.map(s => s.id === student.id ? { ...s, isActive: newStatus } : s));
  };

  const handleTapDelete = (student) => {
    if (confirmDeleteId === student.id) {
      // 두 번째 탭: 실제 삭제 수행
      handleDelete(student);
      setConfirmDeleteId(null);
    } else {
      // 첫 번째 탭: 확인 상태로 변경
      setConfirmDeleteId(student.id);
      // 3초 후 초기화
      setTimeout(() => {
        setConfirmDeleteId(null);
      }, 3000);
    }
  };

  const handleDelete = async (student) => {
    try {
      await deleteDoc(doc(db, 'students', student.id));
      setStudents(prev => prev.filter(s => s.id !== student.id));
    } catch (e) {
      console.error('삭제 오류:', e);
      if (Platform.OS === 'web') {
        alert('삭제 중 오류가 발생했습니다.');
      }
    }
  };

  // 개별 카드 렌더링 함수
  const renderStudentCard = (item) => (
    <View key={item.id} style={[styles.card, !item.isActive && styles.cardInactive]}>
      <View style={styles.cardInfo}>
        <Text style={[styles.studentName, !item.isActive && styles.inactiveText]}>
          {item.name}
        </Text>
        <Text style={styles.pinText}>PIN: {item.pin}</Text>
        {item.parents && item.parents.length > 0 && (
          <Text style={styles.parentText}>
            {item.parents.filter(p => p.phone).map(p => p.phone).join(', ')}
          </Text>
        )}
      </View>
      <View style={styles.cardActions}>
        <TouchableOpacity
          style={[styles.actionBtn, item.isActive ? styles.activeBtn : styles.inactiveBtn]}
          onPress={() => toggleActive(item)}
        >
          <Text style={styles.actionBtnText}>{item.isActive ? '재원' : '휴원'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, styles.editBtn]}
          onPress={() => navigation.navigate('AddStudent', { student: item })}
        >
          <Text style={styles.actionBtnText}>수정</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.actionBtn, 
            confirmDeleteId === item.id ? styles.confirmBtn : styles.deleteBtn
          ]}
          onPress={() => handleTapDelete(item)}
        >
          <Text style={styles.actionBtnText}>
            {confirmDeleteId === item.id ? '정말 삭제?' : '삭제'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const MainContainer = Platform.OS === 'web' ? View : SafeAreaView;

  return (
    <MainContainer style={styles.container}>
      <StatusBar backgroundColor={RED} barStyle="light-content" />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backBtn}>← 대시보드</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>학생 관리</Text>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => navigation.navigate('AddStudent', { student: null })}
        >
          <Text style={styles.addBtnText}>+ 추가</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.listWrapper}>
        {Platform.OS === 'web' ? (
          <ScrollView
            style={styles.webScrollView}
            contentContainerStyle={styles.listContent}
          >
            {students.length > 0 ? (
              students.map(item => renderStudentCard(item))
            ) : (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyText}>등록된 학생이 없습니다.</Text>
                <TouchableOpacity
                  style={styles.addFirstBtn}
                  onPress={() => navigation.navigate('AddStudent', { student: null })}
                >
                  <Text style={styles.addFirstText}>첫 번째 학생 추가하기</Text>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        ) : (
          <FlatList
            data={students}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => renderStudentCard(item)}
            ListEmptyComponent={
              <View style={styles.emptyBox}>
                <Text style={styles.emptyText}>등록된 학생이 없습니다.</Text>
                <TouchableOpacity
                  style={styles.addFirstBtn}
                  onPress={() => navigation.navigate('AddStudent', { student: null })}
                >
                  <Text style={styles.addFirstText}>첫 번째 학생 추가하기</Text>
                </TouchableOpacity>
              </View>
            }
          />
        )}
      </View>
    </MainContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
    ...Platform.select({
      web: {
        height: '100vh',
        width: '100%',
        position: 'fixed', // 웹에서 전체 배경 고정
        top: 0,
        left: 0,
      },
    }),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: RED,
    padding: 16,
    zIndex: 100,
  },
  backBtn: { color: '#fff', fontSize: 15 },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  addBtn: {
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  addBtnText: { color: RED, fontWeight: 'bold', fontSize: 15 },
  listWrapper: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  webScrollView: {
    flex: 1,
  },
  listContent: {
    padding: 12,
    paddingBottom: 100, // 모바일/웹 모두 하단 여백 충분히
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    elevation: 1,
    // 웹에서의 그림자 효과
    ...Platform.select({
      web: {
        boxShadow: '0 2px 5px rgba(0,0,0,0.1)',
      },
    }),
  },
  cardInactive: { opacity: 0.55 },
  cardInfo: { marginBottom: 10 },
  studentName: { fontSize: 20, fontWeight: 'bold', color: '#222' },
  inactiveText: { color: '#999' },
  pinText: { fontSize: 15, color: '#555', marginTop: 2 },
  parentText: { fontSize: 13, color: '#888', marginTop: 2 },
  cardActions: { flexDirection: 'row', gap: 8 },
  actionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  activeBtn: { backgroundColor: '#1565C0' },
  inactiveBtn: { backgroundColor: '#9E9E9E' },
  editBtn: { backgroundColor: '#FF9800' },
  deleteBtn: { backgroundColor: '#C62828' },
  confirmBtn: { backgroundColor: '#D32F2F', borderWidth: 2, borderColor: '#fff' },
  actionBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 13 },
  emptyBox: { alignItems: 'center', marginTop: 60 },
  emptyText: { color: '#999', fontSize: 16, marginBottom: 16 },
  addFirstBtn: {
    backgroundColor: RED,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
  },
  addFirstText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
});
