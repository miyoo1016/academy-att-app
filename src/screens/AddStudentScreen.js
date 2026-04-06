import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, StatusBar,
  SafeAreaView, ScrollView, Alert, KeyboardAvoidingView, Platform
} from 'react-native';
import {
  collection, addDoc, updateDoc, doc, query, where, getDocs
} from 'firebase/firestore';
import { db } from '../config/firebase';

const RED = '#C62828';

export default function AddStudentScreen({ route, navigation }) {
  const existing = route.params?.student || null;

  const [name, setName] = useState(existing?.name || '');
  const [pin, setPin] = useState(existing?.pin || '');
  const [parents, setParents] = useState(
    existing?.parents || [{ name: '', phone: '' }]
  );
  const [saving, setSaving] = useState(false);

  const addParent = () => {
    if (parents.length < 3) setParents(prev => [...prev, { name: '', phone: '' }]);
  };

  const removeParent = (idx) => {
    if (parents.length <= 1) return;
    setParents(prev => prev.filter((_, i) => i !== idx));
  };

  const updateParent = (idx, field, value) => {
    setParents(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
  };

  const validate = async () => {
    if (!name.trim()) { Alert.alert('오류', '이름을 입력해주세요.'); return false; }
    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      Alert.alert('오류', 'PIN은 숫자 4자리여야 합니다.'); return false;
    }

    const hasPhone = parents.some(p => p.phone.trim().length > 0);
    if (!hasPhone) { Alert.alert('오류', '학부모 전화번호를 최소 1개 입력해주세요.'); return false; }

    // PIN 중복 확인
    const q = query(collection(db, 'students'), where('pin', '==', pin));
    const snapshot = await getDocs(q);
    const duplicate = snapshot.docs.find(d => d.id !== existing?.id);
    if (duplicate) {
      Alert.alert('오류', `PIN ${pin}은(는) 이미 사용 중입니다.`); return false;
    }

    return true;
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);

    try {
      const ok = await validate();
      if (!ok) { setSaving(false); return; }

      const data = {
        name: name.trim(),
        pin,
        isActive: existing ? existing.isActive : true,
        parents: parents.filter(p => p.phone.trim().length > 0).map(p => ({
          name: p.name.trim(),
          phone: p.phone.trim(),
        })),
      };

      if (existing) {
        await updateDoc(doc(db, 'students', existing.id), data);
        Alert.alert('완료', '학생 정보가 수정되었습니다.', [
          { text: '확인', onPress: () => navigation.goBack() }
        ]);
      } else {
        await addDoc(collection(db, 'students'), { ...data, createdAt: new Date().toISOString() });
        Alert.alert('완료', `${name} 원생이 등록되었습니다.`, [
          { text: '확인', onPress: () => navigation.goBack() }
        ]);
      }
    } catch (e) {
      console.error(e);
      Alert.alert('오류', '저장 중 오류가 발생했습니다.');
    }

    setSaving(false);
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar backgroundColor={RED} barStyle="light-content" />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backBtn}>← 취소</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{existing ? '학생 수정' : '학생 추가'}</Text>
        <TouchableOpacity onPress={save} disabled={saving}>
          <Text style={[styles.saveBtn, saving && styles.saveBtnDisabled]}>저장</Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.form}>

          {/* 이름 */}
          <Text style={styles.label}>학생 이름</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="예: 홍길동"
            placeholderTextColor="#bbb"
          />

          {/* PIN */}
          <Text style={styles.label}>PIN 번호 (4자리 숫자)</Text>
          <TextInput
            style={styles.input}
            value={pin}
            onChangeText={t => setPin(t.replace(/\D/g, '').slice(0, 4))}
            placeholder="0000"
            placeholderTextColor="#bbb"
            keyboardType="number-pad"
            maxLength={4}
          />
          <Text style={styles.hint}>학생이 태블릿에서 입력할 고유 번호입니다.</Text>

          {/* 학부모 연락처 */}
          <Text style={styles.label}>학부모 연락처</Text>
          {parents.map((parent, idx) => (
            <View key={idx} style={styles.parentRow}>
              <View style={styles.parentFields}>
                <TextInput
                  style={[styles.input, styles.parentNameInput]}
                  value={parent.name}
                  onChangeText={t => updateParent(idx, 'name', t)}
                  placeholder="관계 (예: 어머니)"
                  placeholderTextColor="#bbb"
                />
                <TextInput
                  style={[styles.input, styles.parentPhoneInput]}
                  value={parent.phone}
                  onChangeText={t => updateParent(idx, 'phone', t)}
                  placeholder="010-0000-0000"
                  placeholderTextColor="#bbb"
                  keyboardType="phone-pad"
                />
              </View>
              {parents.length > 1 && (
                <TouchableOpacity onPress={() => removeParent(idx)} style={styles.removeBtn}>
                  <Text style={styles.removeBtnText}>✕</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}

          {parents.length < 3 && (
            <TouchableOpacity style={styles.addParentBtn} onPress={addParent}>
              <Text style={styles.addParentText}>+ 학부모 추가 (최대 3명)</Text>
            </TouchableOpacity>
          )}

          {/* 저장 버튼 */}
          <TouchableOpacity
            style={[styles.submitBtn, saving && styles.submitBtnDisabled]}
            onPress={save}
            disabled={saving}
          >
            <Text style={styles.submitBtnText}>{saving ? '저장 중...' : (existing ? '수정 완료' : '학생 등록')}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
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
  saveBtn: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  saveBtnDisabled: { opacity: 0.5 },
  form: { padding: 16 },
  label: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 16,
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: '#222',
  },
  hint: { fontSize: 12, color: '#999', marginTop: 4 },
  parentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  parentFields: { flex: 1, gap: 6 },
  parentNameInput: {},
  parentPhoneInput: {},
  removeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#ffcdd2',
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
  },
  removeBtnText: { color: RED, fontWeight: 'bold', fontSize: 14 },
  addParentBtn: {
    borderWidth: 1,
    borderColor: '#1565C0',
    borderStyle: 'dashed',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  addParentText: { color: '#1565C0', fontSize: 15 },
  submitBtn: {
    backgroundColor: RED,
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
    marginTop: 32,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
});
