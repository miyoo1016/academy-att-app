import React, { useState, useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet, Platform, BackHandler, ToastAndroid, PermissionsAndroid } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import ModeSelectScreen from './src/screens/ModeSelectScreen';
import KeypadScreen from './src/screens/KeypadScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import StudentsScreen from './src/screens/StudentsScreen';
import AddStudentScreen from './src/screens/AddStudentScreen';
import { startSmsBackgroundService } from './src/tasks/SmsBackgroundService';

const Stack = createStackNavigator();

export default function App() {
  const [appMode, setAppMode] = useState(null); // null=로딩, 'student', 'admin', 'unset'
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const handleBackPress = () => {
      // 메인 화면들에서 뒤로가기 누를 때 바로 종료되지 않게 처리
      if (Platform.OS === 'android') {
        ToastAndroid.show('앱은 종료되지만 출결 감시 서비스는 유지됩니다.', ToastAndroid.SHORT);
        // 원한다면 여기서 종료를 막고 백그라운드로만 보낼 수도 있지만, 
        // 이미 stopWithTask="false"를 설정했으므로 종료해도 무방합니다.
      }
      return false; // 기본 종료 동작 수행 (단, 토스트 메시지로 상태 안내)
    };

    BackHandler.addEventListener('hardwareBackPress', handleBackPress);

    const initApp = async () => {
      // 1. 안드로이드라면 알림 권한 체크 후 백그라운드 문자 발송 서비스 기동
      if (Platform.OS === 'android') {
        try {
          // 안드로이드 13(SDK 33) 이상에서는 알림 권한이 명시적으로 필요합니다.
          if (Platform.Version >= 33) {
            const granted = await PermissionsAndroid.request(
              PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
            );
            if (granted === PermissionsAndroid.RESULTS.GRANTED) {
              console.log('[App] 알림 권한 허용됨');
            } else {
              console.warn('[App] 알림 권한 거부됨. 백그라운드 서비스가 제한될 수 있습니다.');
            }
          }
          
          // 시스템 안정화를 위해 약간의 지연 후 서비스 시작
          setTimeout(() => {
            startSmsBackgroundService();
          }, 2000);
        } catch (e) {
          console.error('[App] 권한 요청 또는 서비스 시작 오류:', e);
        }
      }

      // 2. 웹 브라우저 테스트용 쿼리 파라미터 체크 (?mode=admin 또는 ?mode=student)
      if (Platform.OS === 'web') {
        const urlParams = new URLSearchParams(window.location.search);
        const forcedMode = urlParams.get('mode');
        if (forcedMode === 'admin' || forcedMode === 'student' || forcedMode === 'unset') {
          setAppMode(forcedMode);
          setLoading(false);
          return;
        }
      }

      const mode = await AsyncStorage.getItem('appMode');
      setAppMode(mode || 'unset');
      setLoading(false);
    };

    initApp();
  }, []);

  const handleModeSelect = (mode) => {
    setAppMode(mode);
  };

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#1565C0" />
      </View>
    );
  }

  if (appMode === 'unset') {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <ModeSelectScreen onModeSelect={handleModeSelect} />
      </GestureHandlerRootView>
    );
  }

  if (appMode === 'student') {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <KeypadScreen />
      </GestureHandlerRootView>
    );
  }

  // 관리자 모드: Stack 네비게이션
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Dashboard" component={DashboardScreen} />
          <Stack.Screen name="Students" component={StudentsScreen} />
          <Stack.Screen name="AddStudent" component={AddStudentScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1565C0',
  },
});
