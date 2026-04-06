import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, StatusBar,
  SafeAreaView, FlatList, Alert
} from 'react-native';
import {
  collection, getDocs, doc, updateDoc, deleteDoc, query, orderBy
} from 'firebase/firestore';
import { useFocusEffect } from '@react-navigation/native';
import { db } from '../config/firebase';

const RED = '#C62828';

export default function StudentsScreen({ navigation }) {
  const [students, setStudents] = useState([]);

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

  const confirmDelete = (student) => {
    Alert.alert(
      '학생 삭제',
      `${student.name} 원생을 삭제하시겠습니까?\n출결 기록은 남습니다.`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제', style: 'destructive',
          onPress: async () => {
            await deleteDoc(doc(db, 'students', student.id));
            setStudents(prev => prev.filter(s => s.id !== student.id));
          }
        }
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
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

      <FlatList
        data={students}
        keyExtractor={item => item.id}
        contentContainerStyle={{ padding: 12 }}
        renderItem={({ item }) => (
          <View style={[styles.card, !item.isActive && styles.cardInactive]}>
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
                style={[styles.actionBtn, styles.deleteBtn]}
                onPress={() => confirmDelete(item)}
              >
                <Text style={styles.actionBtnText}>삭제</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: RED,
    padding: 16,
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
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    elevation: 1,
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
