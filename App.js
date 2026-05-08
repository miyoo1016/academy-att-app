import React, { useState, useEffect } from 'react';
import messaging from '@react-native-firebase/messaging';
import { View, ActivityIndicator, StyleSheet, Platform, BackHandler, ToastAndroid, PermissionsAndroid, AppState, NativeModules, Alert, AppRegistry } from 'react-native';
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

const { HeartbeatModule } = NativeModules;

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
            // 앱이 백그라운드에서 시작된 경우(서비스 등에 의해)
            // UI 관련 권한 요청 등을 건너뜁니다.
            const isBackgroundStart = AppState.currentState !== 'active';
            console.log(`[App] 초기화 시작 (isBackgroundStart: ${isBackgroundStart})`);

            if (!isBackgroundStart) {
              if (Platform.Version >= 33) {
                const granted = await PermissionsAndroid.request(
                  PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
                );
              }
              
              // 배터리 최적화 및 오버레이 권한 확인 (활성 상태일 때만)
              if (HeartbeatModule) {
                // ... 기존 권한 확인 로직 ...
              }
            }

            // JS 백그라운드 서비스 시작 (백그라운드에서도 실행 필요)
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
            // 1. 라이브러리 레벨의 서비스 실행 여부 확인
            const isRunning = BackgroundService.isRunning();
            
            // 2. 실제 하트비트(JS Loop) 생존 여부 확인 (3초마다 ping 해야 함)
            let isStale = false;
            if (HeartbeatModule && typeof HeartbeatModule.getLastPing === 'function') {
              const lastPing = await HeartbeatModule.getLastPing();
              const diff = Date.now() - lastPing;
              if (lastPing > 0 && diff > 5 * 60 * 1000) { // 5분 이상 멈춰있었으면 좀비
                isStale = true;
              }
            }

            if (!isRunning || isStale) {
              console.log(`[App] ⚠️ JS 서비스 상태 이상 (isRunning: ${isRunning}, isStale: ${isStale}) → 강제 재시작`);
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

// ─────────────────────────────────────────────────────────────────
// [핵심] Headless JS 태스크 등록 (UI 없이 백그라운드에서 실행)
// SmsAlarmReceiver(Kotlin)에서 장애 감지 시 이 태스크를 직접 호출함.
// ─────────────────────────────────────────────────────────────────
AppRegistry.registerHeadlessTask('SilentRecoveryTask', () => async () => {
  console.log('[Headless] 🔄 백그라운드 무인 복구 시작');
  try {
    const { startSmsBackgroundService } = require('./src/tasks/SmsBackgroundService');
    await startSmsBackgroundService();
    console.log('[Headless] ✅ 백그라운드 복구 완료');
  } catch (e) {
    console.error('[Headless] ❌ 복구 실패:', e);
  }
});

// ─────────────────────────────────────────────────────────────────
// [핵심] FCM 백그라운드 메시지 핸들러 등록 (무음 처리)
// 원생이 번호를 입력할 때 발송되는 FCM 메시지를 JS가 받게 되면
// 기본적으로 UI를 띄우려는 오작동(특히 Expo 환경)이 발생할 수 있습니다.
// 이 메시지는 이미 네이티브(FcmService.kt)에서 문자로 발송 처리하므로
// JS에서는 아무것도 하지 않고 조용히 넘기도록 설정합니다.
// ─────────────────────────────────────────────────────────────────
messaging().setBackgroundMessageHandler(async remoteMessage => {
  console.log('[Headless] 🤫 FCM 백그라운드 메시지 수신 (무시함)');
  // 네이티브 핸들러가 이미 문자를 보냈으므로 JS는 아무 작업도 하지 않음
});
