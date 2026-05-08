/**
 * NativeHeartbeat.js
 * JS → Android SharedPreferences 하트비트 브릿지
 *
 * 예전 JS 백그라운드 서비스에서 사용하던 하트비트 헬퍼입니다.
 * 현재 백그라운드 감시는 Kotlin SmsWatchdogService가 직접 담당합니다.
 *
 * 왜 필요한가:
 * 수동 진단이나 이전 코드 호환용으로만 남겨둡니다.
 */
import { NativeModules, Platform } from 'react-native';

const { HeartbeatModule } = NativeModules;

/**
 * JS가 살아있음을 네이티브에 알린다.
 * Android 전용. 에러는 조용히 무시한다.
 */
export const pingHeartbeat = () => {
  if (Platform.OS !== 'android') return;
  try {
    HeartbeatModule?.ping();
  } catch (_) {
    // 네이티브 모듈 없을 경우 조용히 무시
  }
};
