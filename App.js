import React, { useState, useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet, Platform, BackHandler, ToastAndroid, PermissionsAndroid, AppState, NativeModules } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import ModeSelectScreen from './src/screens/ModeSelectScreen';
import KeypadScreen from './src/screens/KeypadScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import StudentsScreen from './src/screens/StudentsScreen';
import AddStudentScreen from './src/screens/AddStudentScreen';
import { setupFcmToken, subscribeToTokenRefresh } from './src/utils/FcmSetup';

const Stack = createStackNavigator();
const { HeartbeatModule } = NativeModules;

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
                await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
              }
            }

          // FCM 설정 (주 단말기 토큰 등록)
          HeartbeatModule?.startWatchdog?.();
          HeartbeatModule?.scheduleDailyRescue?.();
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

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (Platform.OS === 'android' && state === 'active') {
        HeartbeatModule?.startWatchdog?.();
        HeartbeatModule?.scheduleDailyRescue?.();
      }
    });

    return () => {
      BackHandler.removeEventListener('hardwareBackPress', handleBackPress);
      appStateSub.remove();
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
