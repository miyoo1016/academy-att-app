import React, { useState, useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet, Platform, BackHandler, ToastAndroid, PermissionsAndroid, AppState } from 'react-native';
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
import BackgroundService from 'react-native-background-actions';
import { setupFcmToken, subscribeToTokenRefresh } from './src/utils/FcmSetup';

const Stack = createStackNavigator();

export default function App() {
  const [appMode, setAppMode] = useState(null); // null=로딩, 'student', 'admin', 'unset'
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const handleBackPress = () => {
      if (Platform.OS === 'android') {
        ToastAndroid.show('앱은 종료되지만 출결 감시 서비스는 유지됩니다.', ToastAndroid.SHORT);
      }
      return false;
    };

    BackHandler.addEventListener('hardwareBackPress', handleBackPress);

    const initApp = async () => {
      if (Platform.OS === 'android') {
        try {
          if (Platform.Version >= 33) {
            const granted = await PermissionsAndroid.request(
              PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
            );
            if (granted === PermissionsAndroid.RESULTS.GRANTED) {
              console.log('[App] 알림 권한 허용됨');
            } else {
              console.warn('[App] 알림 권한 거부됨');
            }
          }

          // JS 백그라운드 서비스 즉시 시작
          startSmsBackgroundService();

          // FCM 설정 (주 단말기 토큰 등록)
          await setupFcmToken();
          subscribeToTokenRefresh();
        } catch (e) {
          console.error('[App] 서비스 시작 오류:', e);
        }
      }

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

    // ─────────────────────────────────────────────────────────────────
    // AppState 감시: 앱이 background → active로 복귀할 때
    // SmsAlarmReceiver(Kotlin)가 startActivity로 앱을 깨우면
    // 이 핸들러가 실행되어 JS 서비스가 멈춰있으면 재시작
    // ─────────────────────────────────────────────────────────────────
    let prevAppState = AppState.currentState;
    const appStateSubscription = AppState.addEventListener('change', async (nextState) => {
      console.log(`[App] AppState: ${prevAppState} → ${nextState}`);

      if (prevAppState.match(/inactive|background/) && nextState === 'active') {
        console.log('[App] 앱 포그라운드 복귀 감지 → JS 서비스 상태 확인');

        if (Platform.OS === 'android') {
          try {
            // 서비스가 멈춰있으면 재시작
            if (!BackgroundService.isRunning()) {
              console.log('[App] ⚠️ JS 서비스 중단 감지 → 즉시 재시작');
              await startSmsBackgroundService();
            } else {
              console.log('[App] ✅ JS 서비스 정상 실행 중');
            }
          } catch (e) {
            console.error('[App] 서비스 상태 확인 오류:', e);
          }
        }
      }

      prevAppState = nextState;
    });

    return () => {
      BackHandler.removeEventListener('hardwareBackPress', handleBackPress);
      appStateSubscription?.remove();
    };
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
