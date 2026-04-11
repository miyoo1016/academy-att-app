import { sendDirectSms } from './NativeSms';
import { Platform, Alert } from 'react-native';
import * as SMS from 'expo-sms';

// 등원 문자 메시지 생성
export const buildCheckinMessage = (name, time) =>
  `[미래학원] ${time} ${name} 원생이 등원하였습니다. 최선을 다해 지도하겠습니다.`;

// 귀가 문자 메시지 생성
export const buildCheckoutMessage = (name, time) => {
  return `[미래학원] ${time} ${name} 원생이 공부를 마치고 귀가할 예정입니다.`;
};

// 생일 문자 메시지 생성
export const buildBirthdayMessage = (name) => {
  return `${name} 원생의 생일을 진심으로 축하합니다. 행복한 하루 되세요. 미래학원`;
};

/**
 * 터치 개입 없는 완전 자동 배경 문자 발송 (안드로이드)
 * iOS이거나 안드로이드 네이티브 모듈 로드 실패 시 기존 UI 방식(expo-sms)으로 폴백
 */
export const sendAttendanceSMS = async (phones, message) => {
  if (!phones || phones.length === 0) return false;

  if (Platform.OS === 'android') {
    try {
      const results = await Promise.all(
        phones.map(phone => sendDirectSms(phone, message))
      );
      console.log('[NativeSms] 모든 발송 결과:', results);
      return results.every(res => res === true);
    } catch (error) {
      console.error('Android 네이티브 SMS 발송 실패:', error);
      if (error === 'NATIVE_MODULE_MISSING') {
        // 이 메시지가 뜨면 네이티브 모듈 합치기(Build)가 잘못된 것임
        Alert.alert('시스템 오류', '자동 문자 발송 모듈이 앱에 포함되지 않았습니다.');
      } else {
        Alert.alert('발송 실패', `원인: ${error.message || error}`);
      }
    }
  }

  // 시뮬레이션 모드 (개발 중 웹 브라우저나 기기에서 실제 발송 대신 알림 띄우기)
  if (__DEV__) {
    console.log('--- [SMS 시뮬레이션] ---');
    console.log('수신:', phones.join(', '));
    console.log('내용:', message);
    console.log('----------------------');
    Alert.alert('SMS 발송 시뮬레이션', `[전송 대상: ${phones.length}명]\n\n${message}`);
    return true; // 테스트를 위해 성공으로 반환
  }

  // iOS 또는 안드로이드 네이티브 실패 시 기존 방식(반자동) 수행
  try {
    // 웹 브라우저의 경우 isAvailableAsync가 false를 반환하므로 체크를 우회합니다.
    if (Platform.OS === 'web') {
      console.log('[SMS] 웹 브라우저 발송 시도');
    } else {
      const isAvailable = await SMS.isAvailableAsync();
      if (!isAvailable) {
        console.warn('이 기기에서 SMS 기능을 사용할 수 없습니다.');
        Alert.alert('알림', '이 기기에서는 직접 문자 발송을 지원하지 않습니다. 안드로이드 앱을 사용하거나 별도의 문자 서버 기기를 구성해 주세요.');
        return false;
      }
    }

    const { result } = await SMS.sendSMSAsync(phones, message);
    return result === 'sent' || result === 'unknown'; 
  } catch (error) {
    console.error('SMS 폴백 발송 오류:', error);
    return false;
  }
};

