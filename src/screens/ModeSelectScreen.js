import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal,
  TextInput, Alert, SafeAreaView, StatusBar
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// TODO: 운영 안정화 후 관리자 비밀번호를 원격 설정/보안 저장소로 분리하세요.
const ADMIN_PASSWORD = '0000'; // 관리자 비밀번호 (기본값: 0000)

export default function ModeSelectScreen({ onModeSelect }) {
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [password, setPassword] = useState('');

  const selectStudentMode = async () => {
    await AsyncStorage.setItem('appMode', 'student');
    onModeSelect('student');
  };

  const tryAdminMode = () => {
    setPassword('');
    setShowPasswordModal(true);
  };

  const confirmAdminMode = async () => {
    if (password === ADMIN_PASSWORD) {
      await AsyncStorage.setItem('appMode', 'admin');
      setShowPasswordModal(false);
      onModeSelect('admin');
    } else {
      Alert.alert('오류', '비밀번호가 틀렸습니다.');
      setPassword('');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar backgroundColor="#1565C0" barStyle="light-content" />
      <Text style={styles.title}>미래학원 출결 시스템</Text>
      <Text style={styles.subtitle}>사용할 모드를 선택하세요</Text>

      <TouchableOpacity style={styles.studentBtn} onPress={selectStudentMode}>
        <Text style={styles.btnIcon}>⌨️</Text>
        <Text style={styles.btnTitle}>학생 입력 단말기</Text>
        <Text style={styles.btnDesc}>태블릿 / 학생 PIN 입력용</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.adminBtn} onPress={tryAdminMode}>
        <Text style={styles.btnIcon}>👨‍🏫</Text>
        <Text style={styles.btnTitle}>관리자 (선생님)</Text>
        <Text style={styles.btnDesc}>폰 / 문자 발송 및 학생 관리용</Text>
      </TouchableOpacity>

      <Modal
        visible={showPasswordModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPasswordModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>관리자 비밀번호</Text>
            <TextInput
              style={styles.passwordInput}
              value={password}
              onChangeText={setPassword}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={4}
              placeholder="비밀번호 4자리"
              placeholderTextColor="#999"
              autoFocus
            />
            <View style={styles.modalBtns}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setShowPasswordModal(false)}
              >
                <Text style={styles.cancelBtnText}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmBtn} onPress={confirmAdminMode}>
                <Text style={styles.confirmBtnText}>확인</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1565C0',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    color: '#fff',
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 16,
    marginBottom: 48,
  },
  studentBtn: {
    backgroundColor: '#fff',
    borderRadius: 16,
    width: '100%',
    padding: 24,
    alignItems: 'center',
    marginBottom: 20,
    elevation: 4,
  },
  adminBtn: {
    backgroundColor: '#C62828',
    borderRadius: 16,
    width: '100%',
    padding: 24,
    alignItems: 'center',
    elevation: 4,
  },
  btnIcon: {
    fontSize: 40,
    marginBottom: 8,
  },
  btnTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#222',
    marginBottom: 4,
  },
  btnDesc: {
    fontSize: 14,
    color: '#666',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalBox: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    width: '80%',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
    color: '#222',
  },
  passwordInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    width: '100%',
    fontSize: 24,
    textAlign: 'center',
    letterSpacing: 8,
    marginBottom: 16,
    color: '#222',
  },
  modalBtns: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  cancelBtn: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 16,
    color: '#666',
  },
  confirmBtn: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#1565C0',
    alignItems: 'center',
  },
  confirmBtnText: {
    fontSize: 16,
    color: '#fff',
    fontWeight: 'bold',
  },
});
