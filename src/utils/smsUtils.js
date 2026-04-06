import { sendDirectSms } from './NativeSms';
import { Platform } from 'react-native';
import * as SMS from 'expo-sms';

// 등원 문자 메시지 생성
export const buildCheckinMessage = (name, time) =>
  `[미래학원] ${time} ${name} 원생이 등원하였습니다. 최선을 다해 지도하겠습니다.`;

// 귀가 문자 메시지 생성
export const buildCheckoutMessage = (name, time) =>
  `[미래학원] ${time} ${name} 원생이 공부를 마치고 귀가할 예정입니다.`;

/**
 * 터치 개입 없는 완전 자동 배경 문자 발송 (안드로이드)
 * iOS이거나 안드로이드 네이티브 모듈 로드 실패 시 기존 UI 방식(expo-sms)으로 폴백
 */
export const sendAttendanceSMS = async (phones, message) => {
  if (!phones || phones.length === 0) return false;

  // 안드로이드에서 자동 발송 시도
  if (Platform.OS === 'android') {
    try {
      console.log(`[NativeSms] ${phones.length}명에게 자동 발송 시도...`);
      const results = await Promise.all(
        phones.map(phone => sendDirectSms(phone, message))
      );
      return results.every(res => res === true);
    } catch (error) {
      console.error('Android 네이티브 SMS 발송 실패, 폴백 시도:', error);
    }
  }

  // iOS 또는 안드로이드 네이티브 실패 시 기존 방식(반자동) 수행
  try {
    const isAvailable = await SMS.isAvailableAsync();
    if (!isAvailable) {
      console.warn('이 기기에서 SMS 기능을 사용할 수 없습니다.');
      return false;
    }
    const { result } = await SMS.sendSMSAsync(phones, message);
    return result === 'sent';
  } catch (error) {
    console.error('SMS 폴백 발송 오류:', error);
    return false;
  }
};

