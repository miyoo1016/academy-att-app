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
export const sendAttendanceSMS = async (phones, message, isBackground = false) => {
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
      // 백그라운드 발송 시 화면을 깨울 수 있으므로 Alert.alert 호출을 모두 제거합니다.
      // 실패 시 다음 로직(expo-sms 폴백 등)으로 자연스럽게 넘어갑니다.
    }
  }

  // 시뮬레이션 모드 제거: 개발 모드(__DEV__)에서도 실제 발송을 테스트할 수 있도록 Alert.alert를 완전히 제거했습니다.
  // 이 부분이 백그라운드에서 실행될 때 앱 화면을 강제로 깨우는 원인이었습니다.

  // [중요] 백그라운드 태스크에서 실행 중일 때는 화면 전환(expo-sms)을 막기 위해 여기서 중단합니다.
  if (isBackground) {
    console.log('[SMS] 백그라운드에서는 expo-sms 팝업 띄우기를 방지합니다.');
    return false;
  }

  // iOS 또는 안드로이드 네이티브 실패 시 기존 방식(반자동) 수행 (수동 발송 시에만 실행됨)
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

