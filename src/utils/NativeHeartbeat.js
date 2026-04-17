/**
 * NativeHeartbeat.js
 * JS → Android SharedPreferences 하트비트 브릿지
 *
 * SmsBackgroundService 루프에서 3초마다 ping()을 호출하면
 * Kotlin SmsWatchdogService가 SharedPreferences를 읽어
 * JS 서비스가 실제로 살아있는지 확인한다.
 *
 * 왜 필요한가:
 * RNBackgroundActionsTask 서비스는 실행 중이지만
 * 내부 Firebase 리스너가 죽은 "좀비 상태"를 Watchdog이
 * 기존엔 감지하지 못했다. 이 하트비트로 감지 가능해진다.
 */
import { NativeModules, Platform } from 'react-native';

const { HeartbeatModule } = NativeModules;

/**
 * JS 서비스가 살아있음을 네이티브에 알린다.
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
